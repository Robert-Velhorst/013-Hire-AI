import { describe, expect, it } from "vitest";
import {
  buildTrustedServiceUrl,
  parseTrustedServiceOrigins,
  requireAllowedServiceBaseUrl,
  requireTrustedServiceBaseUrl,
} from "./trustedServiceUrl";

describe("trusted internal service URL policy", () => {
  it("preserves a configured base path when adding a service route", () => {
    expect(buildTrustedServiceUrl("https://forge.example/base", "/v1/jobs"))
      .toBe("https://forge.example/base/v1/jobs");
  });

  it.each([
    "http://localhost:4000",
    "http://127.0.0.1:4000",
    "http://[::1]:4000",
  ])("permits loopback HTTP for standalone Windows use: %s", (value) => {
    expect(requireTrustedServiceBaseUrl(value).hostname).toBeTruthy();
  });

  it.each([
    "http://forge.example/api",
    "ftp://forge.example/api",
    "https://user:secret@forge.example/api",
    "https://forge.example/api?token=secret",
    "https://forge.example/api#fragment",
  ])("rejects an unsafe credential-bearing service base: %s", (value) => {
    expect(() => requireTrustedServiceBaseUrl(value)).toThrow(/trusted service url/i);
  });

  it("allows a service base only when its exact HTTPS origin is configured", () => {
    expect(requireAllowedServiceBaseUrl(
      "https://oauth.example.test/api",
      "https://other.example.test, https://oauth.example.test"
    ).toString()).toBe("https://oauth.example.test/api");
    expect(() => requireAllowedServiceBaseUrl(
      "https://oauth.example.test.evil.invalid/api",
      "https://oauth.example.test"
    )).toThrow(/explicit allowlist/i);
  });

  it("requires an exact origin allowlist even for loopback HTTP", () => {
    expect(requireAllowedServiceBaseUrl(
      "http://localhost:3000/oauth",
      "http://localhost:3000"
    ).origin).toBe("http://localhost:3000");
    expect(() => requireAllowedServiceBaseUrl(
      "http://localhost:3000/oauth",
      ""
    )).toThrow(/explicit allowlist/i);
  });

  it.each([
    "https://oauth.example.test/api",
    "http://oauth.example.test",
    "https://user:secret@oauth.example.test",
    "https://oauth.example.test?tenant=hire-ai",
  ])("rejects an invalid OAuth API allowlist origin: %s", value => {
    expect(() => parseTrustedServiceOrigins(value)).toThrow();
  });
});
