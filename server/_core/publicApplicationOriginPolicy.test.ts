import { describe, expect, it } from "vitest";
import { resolvePublicApplicationOrigin } from "@shared/publicApplicationOriginPolicy.mjs";

describe("public application origin policy", () => {
  it("uses the configured origin instead of an untrusted request host", () => {
    expect(
      resolvePublicApplicationOrigin({
        configuredUrl: "https://hire.example.test/",
        requestProtocol: "https",
        requestHost: "attacker.example",
        isProduction: true,
      })
    ).toBe("https://hire.example.test");
  });

  it("requires an explicit origin in production", () => {
    expect(() =>
      resolvePublicApplicationOrigin({
        requestProtocol: "https",
        requestHost: "hire.example.test",
        isProduction: true,
      })
    ).toThrow("HIRE_AI_PUBLIC_BASE_URL is required in production.");
  });

  it.each([
    "http://hire.example.test",
    "https://user:secret@hire.example.test",
    "https://hire.example.test/app",
    "https://hire.example.test?tenant=1",
  ])("rejects unsafe production public URL %s", configuredUrl => {
    expect(() =>
      resolvePublicApplicationOrigin({ configuredUrl, isProduction: true })
    ).toThrow();
  });

  it("derives only a trusted loopback HTTP origin for local operation", () => {
    expect(
      resolvePublicApplicationOrigin({
        requestProtocol: "http",
        requestHost: "127.0.0.1:3000",
        isProduction: false,
      })
    ).toBe("http://127.0.0.1:3000");
  });

  it("rejects non-loopback cleartext request origins", () => {
    expect(() =>
      resolvePublicApplicationOrigin({
        requestProtocol: "http",
        requestHost: "hire.example.test",
        isProduction: false,
      })
    ).toThrow("Trusted service URL must use HTTPS or loopback HTTP.");
  });
});
