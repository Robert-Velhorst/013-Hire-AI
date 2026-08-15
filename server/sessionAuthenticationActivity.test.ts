import { COOKIE_NAME } from "@shared/const";
import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { getUserByOpenId, upsertUser } from "./db";
import { ENV } from "./_core/env";
import { sdk } from "./_core/sdk";

describe("session authentication activity", () => {
  it("does not rewrite the sign-in timestamp on ordinary authenticated API requests", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const openId = `session-activity-${suffix}`;
    const signedInAt = new Date("2025-01-02T03:04:05.000Z");
    ENV.cookieSecret = "session-activity-test-secret";
    ENV.appId = "session-activity-test-app";
    await upsertUser({
      openId,
      name: "Session Activity User",
      accountStatus: "active",
      lastSignedIn: signedInAt,
    });
    const token = await sdk.createSessionToken(openId, {
      name: "Session Activity User",
    });
    const request = {
      headers: { cookie: `${COOKIE_NAME}=${token}` },
    } as Request;

    const first = await sdk.authenticateRequest(request);
    const second = await sdk.authenticateRequest(request);
    const persisted = await getUserByOpenId(openId);

    expect(first.id).toBe(second.id);
    expect(first.lastSignedIn).toEqual(signedInAt);
    expect(second.lastSignedIn).toEqual(signedInAt);
    expect(persisted?.lastSignedIn).toEqual(signedInAt);
  });
});
