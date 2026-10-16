import { describe, expect, it } from "vitest";
import {
  buildTrustedServiceUrl,
  requireMalwareScannerUrl,
  requireOAuthServerUrl,
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
    "https://forge.example/api?",
    "https://forge.example/api#fragment",
    "https://forge.example/api#",
  ])("rejects an unsafe credential-bearing service base: %s", (value) => {
    expect(() => requireTrustedServiceBaseUrl(value)).toThrow(/trusted service url/i);
  });
});

describe("OAuth server origin policy", () => {
  it("requires a matching HTTPS origin in production", () => {
    expect(requireOAuthServerUrl(
      "https://oauth.example.test/api",
      ["https://oauth.example.test"],
      true
    ).origin).toBe("https://oauth.example.test");
  });

  it.each([
    { url: "https://other.example.test", allowed: ["https://oauth.example.test"] },
    { url: "http://localhost:3000", allowed: ["https://oauth.example.test"] },
    { url: "https://oauth.example.test", allowed: [] },
    { url: "https://oauth.example.test", allowed: ["http://oauth.example.test"] },
    { url: "https://oauth.example.test", allowed: ["https://oauth.example.test/path"] },
  ])("rejects an untrusted production OAuth destination", ({ url, allowed }) => {
    expect(() => requireOAuthServerUrl(url, allowed, true)).toThrow();
  });

  it("allows loopback HTTP for standalone development only", () => {
    expect(requireOAuthServerUrl("http://localhost:3000", [], false).origin)
      .toBe("http://localhost:3000");
    expect(() => requireOAuthServerUrl("http://oauth.example.test", [], false)).toThrow();
  });
});

describe("malware scanner origin policy", () => {
  it("requires an explicitly allowlisted HTTPS origin in production", () => {
    expect(requireMalwareScannerUrl(
      "https://scanner.example.test/scan",
      ["https://scanner.example.test"],
      true
    ).href).toBe("https://scanner.example.test/scan");
  });

  it("permits an allowlisted loopback HTTP scanner for same-host deployments", () => {
    expect(requireMalwareScannerUrl(
      "http://127.0.0.1:39999/scan",
      ["http://127.0.0.1:39999"],
      true
    ).origin).toBe("http://127.0.0.1:39999");
  });

  it("requires remote scanner origins to be allowlisted outside production too", () => {
    expect(() =>
      requireMalwareScannerUrl(
        "https://scanner.example.test/scan",
        [],
        false
      )
    ).toThrow("FILE_MALWARE_SCAN_ALLOWED_ORIGINS must be configured for remote scanners.");
    expect(
      requireMalwareScannerUrl("http://localhost:39999/scan", [], false).origin
    ).toBe("http://localhost:39999");
  });

  it.each([
    { url: "https://other.example.test/scan", allowed: ["https://scanner.example.test"] },
    { url: "https://scanner.example.test/scan", allowed: [] },
    { url: "http://scanner.example.test/scan", allowed: ["http://scanner.example.test"] },
    { url: "http://127.0.0.1:39999/scan", allowed: ["http://127.0.0.1:39998"] },
    { url: "https://scanner.example.test/scan", allowed: ["https://scanner.example.test/path"] },
    { url: "https://scanner.example.test/scan", allowed: ["https://scanner.example.test/?"] },
  ])("rejects an untrusted production malware scanner", ({ url, allowed }) => {
    expect(() => requireMalwareScannerUrl(url, allowed, true)).toThrow();
  });
});
