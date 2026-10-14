import { describe, expect, it } from "vitest";
import {
  normalizePublicAppOrigin,
  resolveOAuthCallbackUri,
} from "./publicAppOrigin";

describe("public application origin", () => {
  it("accepts canonical HTTPS origins in production", () => {
    expect(normalizePublicAppOrigin("https://hire.example.test", true)).toBe(
      "https://hire.example.test"
    );
    expect(normalizePublicAppOrigin("https://hire.example.test/", true)).toBe(
      "https://hire.example.test"
    );
  });

  it.each([
    "http://hire.example.test",
    "https://user:pass@hire.example.test",
    "https://hire.example.test/path",
    "https://hire.example.test?tenant=1",
    "https://hire.example.test#callback",
    " https://hire.example.test",
  ])("rejects a non-origin production value: %s", value => {
    expect(normalizePublicAppOrigin(value, true)).toBeNull();
  });

  it("allows loopback HTTP only outside production", () => {
    expect(normalizePublicAppOrigin("http://localhost:3000", false)).toBe(
      "http://localhost:3000"
    );
    expect(normalizePublicAppOrigin("http://localhost:3000", true)).toBeNull();
    expect(normalizePublicAppOrigin("http://hire.example.test", false)).toBeNull();
  });

  it("uses the configured origin instead of an inbound Host header", () => {
    expect(resolveOAuthCallbackUri({
      publicAppOrigin: "https://hire.example.test",
      isProduction: true,
      requestProtocol: "https",
      requestHost: "attacker.example.test",
    })).toBe("https://hire.example.test/api/oauth/callback");
  });

  it("derives a development callback only from a valid local or HTTPS origin", () => {
    expect(resolveOAuthCallbackUri({
      publicAppOrigin: "",
      isProduction: false,
      requestProtocol: "http",
      requestHost: "localhost:3000",
    })).toBe("http://localhost:3000/api/oauth/callback");
    expect(() => resolveOAuthCallbackUri({
      publicAppOrigin: "",
      isProduction: true,
      requestProtocol: "https",
      requestHost: "hire.example.test",
    })).toThrow("PUBLIC_APP_ORIGIN is required in production.");
    expect(() => resolveOAuthCallbackUri({
      publicAppOrigin: "",
      isProduction: false,
      requestProtocol: "http",
      requestHost: "attacker.example.test",
    })).toThrow("OAuth callback origin is invalid.");
  });
});
