import { describe, expect, it } from "vitest";
import {
  OAUTH_LOGIN_STATE_TTL_MS,
  createOAuthLoginState,
  verifyOAuthLoginState,
} from "./oauthState";

const secret = "oauth-state-test-signing-secret-at-least-32-characters";
const callbackUri = "https://hire.example.test/api/oauth/callback";

describe("primary OAuth login state", () => {
  it("accepts one short-lived state only for the initiating browser nonce", async () => {
    const issued = await createOAuthLoginState(callbackUri, secret, 10_000, "browser-nonce");

    expect(issued.nonce).toBe("browser-nonce");
    expect(await verifyOAuthLoginState(issued.state, issued.nonce, secret, 10_001)).toEqual({
      redirectUri: callbackUri,
    });
    expect(await verifyOAuthLoginState(issued.state, "other-browser", secret, 10_001)).toBeNull();
  });

  it("rejects tampered, expired, future, malformed, and unsigned state", async () => {
    const issued = await createOAuthLoginState(callbackUri, secret, 10_000, "browser-nonce");

    expect(await verifyOAuthLoginState(`${issued.state}x`, issued.nonce, secret, 10_001)).toBeNull();
    expect(await verifyOAuthLoginState(issued.state, issued.nonce, secret, 10_000 + OAUTH_LOGIN_STATE_TTL_MS + 1)).toBeNull();
    expect(await verifyOAuthLoginState(issued.state, issued.nonce, secret, 9_999)).toBeNull();
    expect(await verifyOAuthLoginState("not-signed-state", issued.nonce, secret, 10_001)).toBeNull();
    expect(await verifyOAuthLoginState(btoa(callbackUri), issued.nonce, secret, 10_001)).toBeNull();
  });

  it.each([
    "javascript:alert(1)",
    "http://public.example.test/api/oauth/callback",
    "https://user:password@hire.example.test/api/oauth/callback",
    "https://hire.example.test/not-the-callback",
    "https://hire.example.test/api/oauth/callback?next=/admin",
  ])("does not issue state for an unsafe callback URI", async (value) => {
    await expect(createOAuthLoginState(value, secret, 10_000, "browser-nonce")).rejects.toThrow(
      "OAuth callback URI is invalid"
    );
  });

  it("allows loopback HTTP for standalone development", async () => {
    const redirectUri = "http://127.0.0.1:3050/api/oauth/callback";
    const issued = await createOAuthLoginState(redirectUri, secret, 10_000, "browser-nonce");

    expect(await verifyOAuthLoginState(issued.state, issued.nonce, secret, 10_001)).toEqual({ redirectUri });
  });
});
