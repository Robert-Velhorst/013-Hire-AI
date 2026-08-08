import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerDevAuthRoutes } from "./devAuth";
import { registerOAuthRoutes } from "./oauth";
import { registerConnectorOAuthRoutes } from "../connectorOAuthRoutes";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { registerStripeWebhook } from "../stripeWebhook";
import { ENV, validateProductionEnv } from "./env";
import { applyHttpSafetyHeaders, getRuntimeReadiness } from "./httpSafety";
import { ensureScraperPlatformCatalog } from "../db";
import { logOperationalFailure } from "../operationalFailureLog";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  validateProductionEnv();
  await ensureScraperPlatformCatalog();

  const app = express();
  const server = createServer(app);
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    applyHttpSafetyHeaders(res, ENV.isProduction);
    next();
  });
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  });
  app.get("/readyz", (_req, res) => {
    const readiness = getRuntimeReadiness({
      isProduction: ENV.isProduction,
      databaseConfigured: Boolean(ENV.databaseUrl),
      requiredProductionConfigPresent: ENV.isProduction,
    });
    res.status(readiness.ready ? 200 : 503).json(readiness);
  });
  // Stripe webhook MUST be registered before express.json() to preserve raw body for signature verification
  registerStripeWebhook(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
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
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  let autonomousScheduler: { start(): void; stop(): Promise<void> } | null = null;
  let jobScrapingScheduler: { start(): void; stop(): void } | null = null;
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

  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => reject(error);
    server.once("error", handleError);
    server.listen(port, () => {
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

    await autonomousScheduler?.stop();
    jobScrapingScheduler?.stop();
    server.close((error) => {
      clearTimeout(forceExit);
      if (error) {
        logOperationalFailure("Server", "Shutdown");
        process.exit(1);
      }
      process.exit(0);
    });
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  console.log(`Server running on http://localhost:${port}/`);
}

startServer().catch(() => {
  logOperationalFailure("Server", "Startup");
  process.exitCode = 1;
});
