import type { Express, Request, Response } from "express";
import { decodeJwt } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as db from "../db";
import { ENV } from "./env";
import { registerOAuthRoutes } from "./oauth";
import { createOAuthLoginState } from "./oauthState";
import { sdk } from "./sdk";

const originalSessionTtlMs = ENV.sessionTtlMs;
const originalCookieSecret = ENV.cookieSecret;
const originalAppId = ENV.appId;

describe("OAuth session lifetime", () => {
  afterEach(() => {
    ENV.sessionTtlMs = originalSessionTtlMs;
    ENV.cookieSecret = originalCookieSecret;
    ENV.appId = originalAppId;
    vi.restoreAllMocks();
  });

  it("uses one bounded lifetime for the signed session and browser cookie", async () => {
    ENV.sessionTtlMs = 1_800_000;
    vi.spyOn(sdk, "exchangeCodeForToken").mockResolvedValue({
      accessToken: "provider-token",
    } as Awaited<ReturnType<typeof sdk.exchangeCodeForToken>>);
    vi.spyOn(sdk, "getUserInfo").mockResolvedValue({
      openId: "session-lifetime-user",
      name: "Session Lifetime User",
      email: "session@example.test",
      loginMethod: "oauth",
      platform: "oauth",
    });
    vi.spyOn(db, "upsertUser").mockResolvedValue(undefined);
    const createSessionToken = vi
      .spyOn(sdk, "createSessionToken")
      .mockResolvedValue("signed-session");

    let callback: ((req: Request, res: Response) => Promise<void>) | undefined;
    const app = {
      get: vi.fn((path: string, handler: typeof callback) => {
        if (path === "/api/oauth/callback") callback = handler;
      }),
    } as unknown as Express;
    registerOAuthRoutes(app);

    const oauthState = createOAuthLoginState(
      "https://hire.example.test/api/oauth/callback",
      ENV.cookieSecret
    );
    const cookie = vi.fn();
    const redirect = vi.fn();
    const req = {
      query: { code: "authorization-code", state: oauthState.state },
      headers: { cookie: `hire_ai_oauth_state=${oauthState.nonce}` },
      secure: true,
    } as unknown as Request;
    const res = {
      cookie,
      clearCookie: vi.fn(),
      redirect,
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    await callback?.(req, res);

    expect(createSessionToken).toHaveBeenCalledWith(
      "session-lifetime-user",
      expect.objectContaining({ expiresInMs: 1_800_000 })
    );
    expect(cookie).toHaveBeenCalledWith(
      "app_session_id",
      "signed-session",
      expect.objectContaining({ maxAge: 1_800_000, secure: true })
    );
    expect(redirect).toHaveBeenCalledWith(302, "/");
  });

  it("uses the configured lifetime when a session caller omits an override", async () => {
    ENV.sessionTtlMs = 1_800_000;
    ENV.cookieSecret = "session-lifetime-signing-secret";
    ENV.appId = "session-lifetime-app";
    const issuedAtSeconds = Math.floor(Date.now() / 1000);

    const token = await sdk.signSession({
      openId: "session-lifetime-user",
      appId: ENV.appId,
      name: "Session Lifetime User",
      sessionVersion: 0,
    });
    const payload = decodeJwt(token);

    expect(payload.exp).toBeGreaterThanOrEqual(issuedAtSeconds + 1_799);
    expect(payload.exp).toBeLessThanOrEqual(issuedAtSeconds + 1_801);
  });
});
