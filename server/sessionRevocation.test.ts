import { COOKIE_NAME } from "@shared/const";
import type { Request } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { upsertUser } from "./db";
import type { TrpcContext } from "./_core/context";
import { ENV } from "./_core/env";
import { sdk } from "./_core/sdk";
import { appRouter } from "./routers";

const originalCookieSecret = ENV.cookieSecret;
const originalAppId = ENV.appId;

describe("session revocation", () => {
  afterEach(() => {
    ENV.cookieSecret = originalCookieSecret;
    ENV.appId = originalAppId;
    vi.restoreAllMocks();
  });

  it("rejects a copied session token after logout", async () => {
    ENV.cookieSecret = "session-revocation-test-secret";
    ENV.appId = "session-revocation-test-app";
    const openId = `session-revocation-${Date.now()}-${Math.random()}`;
    await upsertUser({
      openId,
      name: "Session Revocation User",
      accountStatus: "active",
    });
    const token = await sdk.createSessionToken(openId, {
      name: "Session Revocation User",
    });
    const req = {
      secure: false,
      headers: { cookie: `${COOKIE_NAME}=${token}` },
    } as Request;
    const user = await sdk.authenticateRequest(req);
    const clearCookie = vi.fn();
    const caller = appRouter.createCaller({
      req,
      res: { clearCookie },
      user,
    } as unknown as TrpcContext);

    await expect(caller.auth.logout()).resolves.toEqual({ success: true });
    expect(clearCookie).toHaveBeenCalledWith(
      COOKIE_NAME,
      expect.not.objectContaining({ maxAge: expect.anything() })
    );
    await expect(sdk.authenticateRequest(req)).rejects.toMatchObject({
      statusCode: 403,
      message: "Invalid session cookie",
    });

    const replacementToken = await sdk.createSessionToken(openId, {
      name: "Session Revocation User",
    });
    const replacementReq = {
      secure: false,
      headers: { cookie: `${COOKIE_NAME}=${replacementToken}` },
    } as Request;
    await expect(sdk.authenticateRequest(replacementReq)).resolves.toMatchObject({
      openId,
    });
  });
});
