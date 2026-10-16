import type { Express, Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as devSeeds from "../devReviewQueueSeed";
import { ENV } from "./env";
import { registerDevAuthRoutes } from "./devAuth";
import { isDevQaAuthDeploymentEnabled, isDevQaAuthWriteRequest } from "./devAuthPolicy";
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

function request(overrides: {
  method?: string;
  remoteAddress?: string;
  host?: string;
  origin?: string;
  protocol?: string;
  headers?: Record<string, string>;
} = {}) {
  const headers = Object.fromEntries(
    Object.entries(overrides.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])
  );
  return {
    method: overrides.method ?? "POST",
    protocol: overrides.protocol ?? "http",
    socket: { remoteAddress: overrides.remoteAddress ?? "127.0.0.1" },
    headers,
    query: {},
    get(name: string) {
      if (name.toLowerCase() === "host") return overrides.host ?? "localhost:3000";
      if (name.toLowerCase() === "origin") return overrides.origin ?? "http://localhost:3000";
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
    { enabled: true, production: false, host: "::" },
  ])("does not register QA routes unless explicitly enabled on a non-production loopback bind", ({ enabled, production, host }) => {
    ENV.devQaAuthEnabled = enabled;
    ENV.isProduction = production;
    process.env.HOST = host;

    const { app, routes } = registerRoutes();

    expect(routes.size).toBe(0);
    expect(app.get).not.toHaveBeenCalled();
  });

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

  it("rejects forwarded, public-host, cross-origin, and non-POST QA writes", () => {
    ENV.devQaAuthEnabled = true;
    ENV.isProduction = false;
    process.env.HOST = "127.0.0.1";

    expect(isDevQaAuthDeploymentEnabled()).toBe(true);
    expect(isDevQaAuthWriteRequest(request())).toBe(true);
    expect(isDevQaAuthWriteRequest(request({ method: "GET" }))).toBe(false);
    expect(isDevQaAuthWriteRequest(request({ remoteAddress: "203.0.113.10" }))).toBe(false);
    expect(isDevQaAuthWriteRequest(request({ host: "hire.example.com", origin: "http://hire.example.com" }))).toBe(false);
    expect(isDevQaAuthWriteRequest(request({ origin: "https://attacker.example" }))).toBe(false);
    expect(isDevQaAuthWriteRequest(request({ headers: { "x-forwarded-for": "127.0.0.1" } }))).toBe(false);
    expect(isDevQaAuthWriteRequest(request({ headers: { forwarded: "for=127.0.0.1" } }))).toBe(false);
  });

  it("rejects a public request before seeding a user or issuing a session", async () => {
    ENV.devQaAuthEnabled = true;
    ENV.isProduction = false;
    process.env.HOST = "127.0.0.1";
    const seedAdmin = vi.spyOn(devSeeds, "seedDevAdminUser");
    const createSession = vi.spyOn(sdk, "createSessionToken");
    const { routes } = registerRoutes();
    const res = response();

    await routes.get("/api/dev/login-admin")!(request({
      remoteAddress: "203.0.113.10",
      host: "hire.example.com",
      origin: "https://hire.example.com",
    }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(seedAdmin).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });
});
