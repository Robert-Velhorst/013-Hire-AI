import { describe, expect, it } from "vitest";
import { buildTrustedServiceUrl, requireTrustedServiceBaseUrl } from "./trustedServiceUrl";

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
});
