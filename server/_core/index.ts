import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerDevAuthRoutes } from "./devAuth";
import { registerOAuthRoutes } from "./oauth";
import { registerConnectorOAuthRoutes } from "../connectorOAuthRoutes";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./static";
import { registerStripeWebhook } from "../stripeWebhook";
import { ENV, validateProductionEnv } from "./env";
import { applyHttpSafetyHeaders, getRuntimeReadiness } from "./httpSafety";
import {
  closeDatabaseConnection,
  ensureScraperPlatformCatalog,
  persistOperationalFailureSignals,
  probeDatabaseConnection,
} from "../db";
import {
  configureOperationalFailurePersistence,
  flushOperationalFailurePersistence,
  logOperationalFailure,
} from "../operationalFailureLog";
import { registerHaiConnectorRoutes } from "../haiConnectorRoutes";
import { displayHost, resolveAvailablePort, resolveBindHost, resolvePreferredPort } from "./network";
import { drainRuntime } from "./gracefulShutdown";
import { createDatabaseReadinessProbe } from "./databaseReadiness";
import { writeStartupFailureStage, type StartupStage } from "./startupDiagnostics";
import { applyHttpRuntimePolicy } from "./httpRuntimePolicy";
import { registerApplicationBodyParsers } from "./bodyParsers";
import { applyTrustedProxyPolicy } from "./proxyPolicy";
import { registerCookieOriginProtection } from "./cookieOriginProtection";
import { registerApiRateLimit } from "./apiRateLimit";

let startupStage: StartupStage = "configuration validation";

async function startServer() {
  validateProductionEnv();
  startupStage = "platform catalog initialization";
  await ensureScraperPlatformCatalog();
  configureOperationalFailurePersistence(persistOperationalFailureSignals);
  startupStage = "application assembly";

  const app = express();
  applyTrustedProxyPolicy(app);
  const server = createServer(app);
  applyHttpRuntimePolicy(server);
  const databaseReadiness = createDatabaseReadinessProbe({ probe: probeDatabaseConnection });
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    applyHttpSafetyHeaders(res, ENV.isProduction);
    next();
  });
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  });
  app.get("/readyz", async (_req, res) => {
    const readiness = getRuntimeReadiness({
      isProduction: ENV.isProduction,
      databaseConfigured: Boolean(ENV.databaseUrl),
      requiredProductionConfigPresent: ENV.isProduction,
    });
    const databaseAvailable = ENV.databaseUrl ? await databaseReadiness.check() : null;
    const ready = readiness.ready && databaseAvailable !== false;
    res.status(ready ? 200 : 503).json({
      ...readiness,
      ready,
      database: databaseAvailable === null
        ? "not_configured"
        : databaseAvailable
          ? "available"
          : "unavailable",
    });
  });
  // Stripe webhook MUST be registered before express.json() to preserve raw body for signature verification
  registerStripeWebhook(app);
  // Stripe owns signature verification and retry semantics. Rate-limit all
  // remaining API boundaries without throttling provider webhook delivery.
  registerApiRateLimit(app);
  // The HAI bridge owns its bounded JSON parser and must be registered before
  // the general application parser can accept a larger request body.
  registerHaiConnectorRoutes(app);
  // Browser session writes must prove that their Origin matches the direct or
  // trusted-proxy request origin. Stripe and HAI use separate earlier routes.
  registerCookieOriginProtection(app);
  // The JSON envelope accommodates the bounded 10 MiB document payload after
  // base64 expansion without reserving a 50 MiB parser budget for every request.
  registerApplicationBodyParsers(app);
  // Development-only authenticated QA routes for protected operating-ledger pages.
  registerDevAuthRoutes(app);
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // External connector callbacks use encrypted grants and a signed, short-lived state.
  registerConnectorOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (!ENV.isProduction) {
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const bindHost = resolveBindHost(process.env.HOST);
  const preferredPort = resolvePreferredPort(process.env.PORT);
  const port = await resolveAvailablePort(preferredPort, bindHost, !ENV.isProduction);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  let autonomousScheduler: { start(): void; stop(): Promise<void> } | null = null;
  let jobScrapingScheduler: { start(): void; stop(): Promise<void> } | null = null;
  if (ENV.autonomousSchedulerEnabled) {
    const { getAutonomousScheduler } = await import("../autonomousScheduler");
    autonomousScheduler = getAutonomousScheduler();
  }
  if (ENV.jobScrapingSchedulerEnabled) {
    const { getScheduler } = await import("../scrapers/scheduler");
    jobScrapingScheduler = getScheduler({
      intervalMinutes: ENV.jobScrapingIntervalMinutes,
      maxJobsPerRun: ENV.jobScrapingMaxJobsPerRun,
      enabledPlatforms: ENV.jobScrapingEnabledPlatforms,
    });
  }

  startupStage = "listener binding";
  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => reject(error);
    server.once("error", handleError);
    server.listen(port, bindHost, () => {
      server.off("error", handleError);
      resolve();
    });
  });

  autonomousScheduler?.start();
  jobScrapingScheduler?.start();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Server] ${signal} received, shutting down`);

    const forceExit = setTimeout(() => {
      console.error("[Server] Graceful shutdown timed out");
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    try {
      await drainRuntime(server, [
        () => autonomousScheduler?.stop(),
        () => jobScrapingScheduler?.stop(),
      ], [closeOperationalResources]);
      clearTimeout(forceExit);
      process.exit(0);
    } catch {
      clearTimeout(forceExit);
      logOperationalFailure("Server", "Shutdown");
      process.exit(1);
    }
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  console.log(`Server running on http://${displayHost(bindHost)}:${port}/ (bound to ${bindHost})`);
}

async function closeOperationalResources() {
  let failed = false;
  try {
    await flushOperationalFailurePersistence();
  } catch {
    failed = true;
  }
  try {
    await closeDatabaseConnection();
  } catch {
    failed = true;
  }
  if (failed) throw new Error("Operational resources could not close cleanly.");
}

startServer().catch(async () => {
  logOperationalFailure("Server", "Startup");
  writeStartupFailureStage(startupStage);
  try {
    await closeOperationalResources();
  } catch {
    logOperationalFailure("Database", "Startup cleanup");
  }
  process.exitCode = 1;
});
