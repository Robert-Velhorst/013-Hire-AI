import { describe, expect, it } from "vitest";
import {
  OAUTH_LOGIN_STATE_TTL_MS,
  createOAuthLoginState,
  verifyOAuthLoginState,
} from "./oauthState";

const secret = "oauth-state-test-signing-secret-at-least-32-characters";
const callbackUri = "https://hire.example.test/api/oauth/callback";

describe("primary OAuth login state", () => {
  it("accepts one short-lived state only for the initiating browser nonce", () => {
    const issued = createOAuthLoginState(callbackUri, secret, 10_000, "browser-nonce");

    expect(issued.nonce).toBe("browser-nonce");
    expect(verifyOAuthLoginState(issued.state, issued.nonce, secret, 10_001)).toEqual({
      redirectUri: callbackUri,
    });
    expect(verifyOAuthLoginState(issued.state, "other-browser", secret, 10_001)).toBeNull();
  });

  it("rejects tampered, expired, future, malformed, and unsigned state", () => {
    const issued = createOAuthLoginState(callbackUri, secret, 10_000, "browser-nonce");

    expect(verifyOAuthLoginState(`${issued.state}x`, issued.nonce, secret, 10_001)).toBeNull();
    expect(verifyOAuthLoginState(issued.state, issued.nonce, secret, 10_000 + OAUTH_LOGIN_STATE_TTL_MS + 1)).toBeNull();
    expect(verifyOAuthLoginState(issued.state, issued.nonce, secret, 9_999)).toBeNull();
    expect(verifyOAuthLoginState("not-signed-state", issued.nonce, secret, 10_001)).toBeNull();
    expect(verifyOAuthLoginState(btoa(callbackUri), issued.nonce, secret, 10_001)).toBeNull();
  });

  it.each([
    "javascript:alert(1)",
    "http://public.example.test/api/oauth/callback",
    "https://user:password@hire.example.test/api/oauth/callback",
    "https://hire.example.test/not-the-callback",
    "https://hire.example.test/api/oauth/callback?next=/admin",
  ])("does not issue state for an unsafe callback URI", (value) => {
    expect(() => createOAuthLoginState(value, secret, 10_000, "browser-nonce")).toThrow(
      "OAuth callback URI is invalid"
    );
  });

  it("allows loopback HTTP for standalone development", () => {
    const redirectUri = "http://127.0.0.1:3050/api/oauth/callback";
    const issued = createOAuthLoginState(redirectUri, secret, 10_000, "browser-nonce");

    expect(verifyOAuthLoginState(issued.state, issued.nonce, secret, 10_001)).toEqual({ redirectUri });
  });
});
