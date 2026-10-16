import type { Express, Request, Response } from "express";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as devSeeds from "../devReviewQueueSeed";
import { ENV } from "./env";
import { registerDevAuthRoutes } from "./devAuth";
import { sdk } from "./sdk";

type RouteHandler = (request: Request, response: Response) => Promise<void>;

const originalQaAuthEnabled = ENV.devQaAuthEnabled;
const originalProduction = ENV.isProduction;
const originalHost = process.env.HOST;

function registerRoutes() {
  const routes = new Map<string, RouteHandler>();
  const app = {
    get: vi.fn(),
    post(path: string, ...handlers: unknown[]) {
      routes.set(path, handlers.at(-1) as RouteHandler);
    },
  };
  registerDevAuthRoutes(app as unknown as Express);
  return { app, routes };
}

function request(
  overrides: {
    method?: string;
    remoteAddress?: string;
    host?: string;
    origin?: string;
    protocol?: string;
    headers?: Record<string, string>;
    query?: Record<string, unknown>;
  } = {}
) {
  const headers = overrides.headers ?? {};
  return {
    method: overrides.method ?? "POST",
    protocol: overrides.protocol ?? "http",
    socket: { remoteAddress: overrides.remoteAddress ?? "127.0.0.1" },
    headers,
    query: overrides.query ?? {},
    get(name: string) {
      if (name.toLowerCase() === "host")
        return overrides.host ?? "localhost:3000";
      if (name.toLowerCase() === "origin")
        return overrides.origin ?? "http://localhost:3000";
      return headers[name.toLowerCase()];
    },
  } as unknown as Request;
}

function response() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    cookie: vi.fn(),
    redirect: vi.fn(),
  };
  return res as unknown as Response & typeof res;
}

async function withLoopbackServer<T>(
  app: Express,
  callback: (origin: string) => Promise<T>
) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("QA test server did not bind a TCP port.");
  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  }
}

describe("development authentication routes", () => {
  afterEach(() => {
    ENV.devQaAuthEnabled = originalQaAuthEnabled;
    ENV.isProduction = originalProduction;
    if (originalHost === undefined) delete process.env.HOST;
    else process.env.HOST = originalHost;
    vi.restoreAllMocks();
  });

  it.each([
    { enabled: false, production: false, host: "127.0.0.1" },
    { enabled: false, production: true, host: "127.0.0.1" },
    { enabled: true, production: true, host: "127.0.0.1" },
    { enabled: true, production: false, host: "0.0.0.0" },
  ])(
    "does not register QA routes unless explicitly enabled on a non-production loopback bind",
    ({ enabled, production, host }) => {
      ENV.devQaAuthEnabled = enabled;
      ENV.isProduction = production;
      process.env.HOST = host;

      const { app, routes } = registerRoutes();

      expect(routes.size).toBe(0);
      expect(app.get).not.toHaveBeenCalled();
    }
  );

  it("registers only POST routes in explicit loopback QA mode", () => {
    ENV.devQaAuthEnabled = true;
    ENV.isProduction = false;
    process.env.HOST = "::1";

    const { app, routes } = registerRoutes();

    expect([...routes.keys()]).toEqual([
      "/api/dev/login",
      "/api/dev/login-suspended",
      "/api/dev/login-review-queue",
      "/api/dev/login-admin",
    ]);
    expect(app.get).not.toHaveBeenCalled();
  });

  it("issues a QA session after a same-origin POST from the loopback peer", async () => {
    ENV.devQaAuthEnabled = true;
    ENV.isProduction = false;
    process.env.HOST = "127.0.0.1";
    const user = { openId: "dev-review-queue-user", name: "Review Queue QA" };
    vi.spyOn(devSeeds, "seedDevReviewQueueUser").mockResolvedValue(
      user as never
    );
    vi.spyOn(sdk, "createSessionToken").mockResolvedValue(
      "qa-session" as never
    );
    const { routes } = registerRoutes();
    const res = response();

    await routes.get("/api/dev/login")!(request(), res);

    expect(devSeeds.seedDevReviewQueueUser).toHaveBeenCalledOnce();
    expect(sdk.createSessionToken).toHaveBeenCalledWith(
      user.openId,
      expect.objectContaining({
        name: user.name,
        expiresInMs: 6 * 60 * 60 * 1000,
      })
    );
    expect(res.cookie).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(302, "/dashboard");
  });

  it.each([
    ["same-origin path", "/jobs?sort=new#today", "/jobs?sort=new#today"],
    ["absolute URL", "https://attacker.example/path", "/dashboard"],
    ["protocol-relative URL", "//attacker.example/path", "/dashboard"],
    ["backslash-normalized URL", "/\\\\attacker.example/path", "/dashboard"],
  ])(
    "uses a same-origin redirect for %s",
    async (_case, redirect, expected) => {
      ENV.devQaAuthEnabled = true;
      ENV.isProduction = false;
      process.env.HOST = "127.0.0.1";
      vi.spyOn(devSeeds, "seedDevReviewQueueUser").mockResolvedValue({
        openId: "dev-review-queue-user",
        name: "Review Queue QA",
      } as never);
      vi.spyOn(sdk, "createSessionToken").mockResolvedValue(
        "qa-session" as never
      );
      const { routes } = registerRoutes();
      const res = response();

      await routes.get("/api/dev/login")!(
        request({ query: { redirect } }),
        res
      );

      expect(res.redirect).toHaveBeenCalledWith(302, expected);
    }
  );

  it("integrates loopback-only sign-in with real HTTP method, origin, host, and proxy checks", async () => {
    ENV.devQaAuthEnabled = true;
    ENV.isProduction = false;
    process.env.HOST = "127.0.0.1";
    const user = { openId: "dev-review-queue-user", name: "Review Queue QA" };
    const seedUser = vi
      .spyOn(devSeeds, "seedDevReviewQueueUser")
      .mockResolvedValue(user as never);
    const seedAdmin = vi.spyOn(devSeeds, "seedDevAdminUser");
    const createSession = vi
      .spyOn(sdk, "createSessionToken")
      .mockResolvedValue("qa-session" as never);
    const app = express();
    registerDevAuthRoutes(app);

    await withLoopbackServer(app, async origin => {
      const signIn = await fetch(`${origin}/api/dev/login`, {
        method: "POST",
        headers: { Origin: origin },
        redirect: "manual",
      });
      expect(signIn.status).toBe(302);
      expect(signIn.headers.get("location")).toBe("/dashboard");
      expect(signIn.headers.get("set-cookie")).toContain("app_session_id=");

      const getRequest = await fetch(`${origin}/api/dev/login`, {
        redirect: "manual",
      });
      const missingOrigin = await fetch(`${origin}/api/dev/login`, {
        method: "POST",
        redirect: "manual",
      });
      const crossOrigin = await fetch(`${origin}/api/dev/login`, {
        method: "POST",
        headers: { Origin: "https://attacker.example" },
        redirect: "manual",
      });
      const forwarded = await fetch(`${origin}/api/dev/login-admin`, {
        method: "POST",
        headers: { Origin: origin, "X-Forwarded-For": "127.0.0.1" },
        redirect: "manual",
      });
      const publicHost = await fetch(`${origin}/api/dev/login-admin`, {
        method: "POST",
        headers: {
          Host: "hire.example.com",
          Origin: "http://hire.example.com",
        },
        redirect: "manual",
      });

      expect([
        getRequest.status,
        missingOrigin.status,
        crossOrigin.status,
        forwarded.status,
        publicHost.status,
      ]).toEqual([404, 404, 404, 404, 404]);
    });

    expect(seedUser).toHaveBeenCalledOnce();
    expect(seedAdmin).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledOnce();
  });

  it("rate limits local QA session issuance per direct client", async () => {
    ENV.devQaAuthEnabled = true;
    ENV.isProduction = false;
    process.env.HOST = "127.0.0.1";
    const user = { openId: "dev-review-queue-user", name: "Review Queue QA" };
    const seedUser = vi
      .spyOn(devSeeds, "seedDevReviewQueueUser")
      .mockResolvedValue(user as never);
    const createSession = vi
      .spyOn(sdk, "createSessionToken")
      .mockResolvedValue("qa-session" as never);
    const app = express();
    registerDevAuthRoutes(app);

    await withLoopbackServer(app, async origin => {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 11; attempt += 1) {
        const response = await fetch(`${origin}/api/dev/login`, {
          method: "POST",
          headers: { Origin: origin },
          redirect: "manual",
        });
        statuses.push(response.status);
      }
      expect(statuses.slice(0, 10)).toEqual(Array(10).fill(302));
      expect(statuses[10]).toBe(429);
    });

    expect(seedUser).toHaveBeenCalledTimes(10);
    expect(createSession).toHaveBeenCalledTimes(10);
  });

  it.each([
    ["GET", request({ method: "GET" })],
    ["non-loopback peer", request({ remoteAddress: "203.0.113.10" })],
    [
      "forwarded request",
      request({ headers: { "x-forwarded-for": "127.0.0.1" } }),
    ],
    [
      "forwarded host",
      request({ headers: { "x-forwarded-host": "localhost:3000" } }),
    ],
    [
      "forwarded protocol",
      request({ headers: { "x-forwarded-proto": "http" } }),
    ],
    ["forwarded prefix", request({ headers: { "x-forwarded-prefix": "/" } })],
    [
      "standard forwarded request",
      request({ headers: { forwarded: "for=127.0.0.1" } }),
    ],
    ["cross-origin request", request({ origin: "https://attacker.example" })],
    [
      "non-loopback host",
      request({ host: "hire.example.com", origin: "http://hire.example.com" }),
    ],
  ])(
    "rejects %s before seeding any user or issuing a session",
    async (_case, req) => {
      ENV.devQaAuthEnabled = true;
      ENV.isProduction = false;
      process.env.HOST = "127.0.0.1";
      const seedUser = vi.spyOn(devSeeds, "seedDevReviewQueueUser");
      const seedAdmin = vi.spyOn(devSeeds, "seedDevAdminUser");
      const createSession = vi.spyOn(sdk, "createSessionToken");
      const { routes } = registerRoutes();
      const res = response();

      await routes.get("/api/dev/login-admin")!(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(seedUser).not.toHaveBeenCalled();
      expect(seedAdmin).not.toHaveBeenCalled();
      expect(createSession).not.toHaveBeenCalled();
    }
  );
});
