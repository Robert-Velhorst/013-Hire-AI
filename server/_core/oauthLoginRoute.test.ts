import type { Express, Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as db from "../db";
import { ENV } from "./env";
import { registerOAuthRoutes } from "./oauth";
import { sdk } from "./sdk";

const originalPortalUrl = ENV.oAuthPortalUrl;
const originalCookieSecret = ENV.cookieSecret;
const originalAppId = ENV.appId;
const originalQaAuthEnabled = ENV.devQaAuthEnabled;
const originalHost = process.env.HOST;

describe("primary OAuth login route", () => {
  afterEach(() => {
    ENV.oAuthPortalUrl = originalPortalUrl;
    ENV.cookieSecret = originalCookieSecret;
    ENV.appId = originalAppId;
    ENV.devQaAuthEnabled = originalQaAuthEnabled;
    if (originalHost === undefined) delete process.env.HOST;
    else process.env.HOST = originalHost;
    vi.restoreAllMocks();
  });

  it("does not expose local QA sign-in unless the explicit QA mode is enabled", async () => {
    ENV.oAuthPortalUrl = "";
    ENV.devQaAuthEnabled = false;
    const routes = new Map<
      string,
      (req: Request, res: Response) => Promise<void> | void
    >();
    registerOAuthRoutes({
      get: vi.fn(
        (
          path: string,
          ...handlers: Array<
            (req: Request, res: Response) => Promise<void> | void
          >
        ) => routes.set(path, handlers[handlers.length - 1]!)
      ),
    } as unknown as Express);
    const redirect = vi.fn();
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();

    await routes.get("/api/oauth/login")?.(
      {} as Request,
      { redirect, status, json } as unknown as Response
    );

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({
      error: "OAuth login is not configured",
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("shows a local QA form only when explicit loopback QA authentication is enabled", async () => {
    ENV.oAuthPortalUrl = "";
    ENV.devQaAuthEnabled = true;
    process.env.HOST = "127.0.0.1";
    const routes = new Map<
      string,
      (req: Request, res: Response) => Promise<void> | void
    >();
    registerOAuthRoutes({
      get: vi.fn(
        (
          path: string,
          ...handlers: Array<
            (req: Request, res: Response) => Promise<void> | void
          >
        ) => routes.set(path, handlers[handlers.length - 1]!)
      ),
    } as unknown as Express);
    const html = vi.fn();
    const type = vi.fn().mockReturnThis();

    await routes.get("/api/oauth/login")?.(
      {
        protocol: "http",
        socket: { remoteAddress: "127.0.0.1" },
        headers: {},
        get: vi.fn((name: string) =>
          name === "host" ? "localhost:3000" : undefined
        ),
      } as unknown as Request,
      {
        status: vi.fn().mockReturnThis(),
        type,
        send: html,
      } as unknown as Response
    );

    expect(type).toHaveBeenCalledWith("html");
    expect(html).toHaveBeenCalledWith(
      expect.stringContaining('<form method="post" action="/api/dev/login">')
    );
  });

  it("issues browser-bound state and exchanges the callback with its verified redirect URI", async () => {
    ENV.oAuthPortalUrl = "https://auth.example.test";
    ENV.cookieSecret = "oauth-route-signing-secret-at-least-32-characters";
    ENV.appId = "hire-ai-route-test";
    vi.spyOn(sdk, "exchangeCodeForToken").mockResolvedValue({
      accessToken: "provider-token",
    } as never);
    vi.spyOn(sdk, "getUserInfo").mockResolvedValue({
      openId: "oauth-route-user",
      name: "OAuth Route User",
      loginMethod: "oauth",
      platform: "oauth",
    });
    vi.spyOn(db, "upsertUser").mockResolvedValue(undefined);
    vi.spyOn(sdk, "createSessionToken").mockResolvedValue("signed-session");

    const routes = new Map<
      string,
      (req: Request, res: Response) => Promise<void> | void
    >();
    const app = {
      get: vi.fn(
        (
          path: string,
          ...handlers: Array<
            (req: Request, res: Response) => Promise<void> | void
          >
        ) => {
          routes.set(path, handlers[handlers.length - 1]!);
        }
      ),
    } as unknown as Express;
    registerOAuthRoutes(app);

    const loginCookie = vi.fn();
    const loginRedirect = vi.fn();
    await routes.get("/api/oauth/login")?.(
      {
        protocol: "https",
        secure: true,
        get: vi.fn((name: string) =>
          name === "host" ? "hire.example.test" : undefined
        ),
      } as unknown as Request,
      {
        cookie: loginCookie,
        redirect: loginRedirect,
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response
    );

    const portalUrl = new URL(loginRedirect.mock.calls[0][1]);
    const state = portalUrl.searchParams.get("state")!;
    const nonce = loginCookie.mock.calls[0][1];
    expect(portalUrl.origin).toBe("https://auth.example.test");
    expect(portalUrl.searchParams.get("redirectUri")).toBe(
      "https://hire.example.test/api/oauth/callback"
    );
    expect(state).not.toBe(
      btoa("https://hire.example.test/api/oauth/callback")
    );
    expect(loginCookie.mock.calls[0][2]).toEqual(
      expect.objectContaining({ httpOnly: true, secure: true })
    );

    const callbackRedirect = vi.fn();
    const clearCookie = vi.fn();
    await routes.get("/api/oauth/callback")?.(
      {
        query: { code: "authorization-code", state },
        headers: { cookie: `hire_ai_oauth_state=${nonce}` },
        secure: true,
      } as unknown as Request,
      {
        cookie: vi.fn(),
        clearCookie,
        redirect: callbackRedirect,
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response
    );

    expect(sdk.exchangeCodeForToken).toHaveBeenCalledWith(
      "authorization-code",
      "https://hire.example.test/api/oauth/callback"
    );
    expect(clearCookie).toHaveBeenCalled();
    expect(callbackRedirect).toHaveBeenCalledWith(302, "/");
  });

  it("rejects a callback that is not bound to the initiating browser", async () => {
    const exchange = vi.spyOn(sdk, "exchangeCodeForToken");
    const routes = new Map<
      string,
      (req: Request, res: Response) => Promise<void> | void
    >();
    registerOAuthRoutes({
      get: vi.fn(
        (
          path: string,
          ...handlers: Array<
            (req: Request, res: Response) => Promise<void> | void
          >
        ) => routes.set(path, handlers[handlers.length - 1]!)
      ),
    } as unknown as Express);
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();

    await routes.get("/api/oauth/callback")?.(
      {
        query: {
          code: "authorization-code",
          state: btoa("https://hire.example.test/api/oauth/callback"),
        },
        headers: {},
      } as unknown as Request,
      { clearCookie: vi.fn(), status, json } as unknown as Response
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error: "OAuth state is invalid or expired",
    });
    expect(exchange).not.toHaveBeenCalled();
  });
});
