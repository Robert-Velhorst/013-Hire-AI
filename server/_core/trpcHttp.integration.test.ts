import express from "express";
import { createServer } from "node:http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { afterEach, describe, expect, it } from "vitest";
import { COOKIE_NAME } from "@shared/const";
import { createHireTrpcClient } from "@/lib/trpcClient";
import { appRouter } from "../routers";
import { registerApiRateLimit } from "./apiRateLimit";
import { registerApplicationBodyParsers } from "./bodyParsers";
import { registerCookieOriginProtection } from "./cookieOriginProtection";
import { applyHttpRuntimePolicy } from "./httpRuntimePolicy";
import { applyTrustedProxyPolicy } from "./proxyPolicy";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.close(() => resolve());
    server.closeAllConnections();
  })));
});

async function startApi() {
  const app = express();
  applyTrustedProxyPolicy(app);
  registerApiRateLimit(app);
  registerCookieOriginProtection(app);
  registerApplicationBodyParsers(app);
  app.use("/api/trpc", createExpressMiddleware({
    router: appRouter,
    createContext: ({ req, res }) => ({ req, res, user: null }),
  }));

  const server = createServer(app);
  applyHttpRuntimePolicy(server);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("The test API did not bind to a TCP port.");
  }
  return `http://127.0.0.1:${address.port}`;
}

describe("frontend tRPC client over the Express API", () => {
  it("uses the production transport for public and protected procedures", async () => {
    const baseUrl = await startApi();
    const credentialModes: RequestCredentials[] = [];
    const client = createHireTrpcClient(`${baseUrl}/api/trpc`, (input, init) => {
      credentialModes.push(init?.credentials ?? "omit");
      return fetch(input, init);
    });

    await expect(client.system.health.query({ timestamp: 1 })).resolves.toEqual({
      ok: true,
    });
    await expect(client.profile.get.query()).rejects.toMatchObject({
      data: { code: "UNAUTHORIZED" },
    });
    expect(credentialModes.length).toBeGreaterThanOrEqual(2);
    expect(credentialModes.every(mode => mode === "include")).toBe(true);
  });

  it("rejects a cross-origin cookie mutation before tRPC dispatch", async () => {
    const baseUrl = await startApi();
    const response = await fetch(`${baseUrl}/api/trpc/jobs.saveJob`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${COOKIE_NAME}=invalid-session`,
        origin: "https://attacker.example",
      },
      body: "{}",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "The request origin is not allowed.",
    });
  });
});
