import { describe, expect, it } from "vitest";
import { applyHttpSafetyHeaders, getRuntimeReadiness } from "./httpSafety";

describe("HTTP safety headers", () => {
  it("sets baseline protections without a production-only policy in development", () => {
    const headers = new Map<string, string>();
    applyHttpSafetyHeaders({ setHeader: (name, value) => headers.set(name, String(value)) }, false);

    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.has("Content-Security-Policy")).toBe(false);
  });

  it("adds transport and content protections in production", () => {
    const headers = new Map<string, string>();
    applyHttpSafetyHeaders({ setHeader: (name, value) => headers.set(name, String(value)) }, true);

    expect(headers.get("Strict-Transport-Security")).toContain("max-age=31536000");
    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });
});

describe("runtime readiness", () => {
  it("allows explicit development-memory operation while exposing it honestly", () => {
    expect(getRuntimeReadiness({
      isProduction: false,
      databaseConfigured: false,
      requiredProductionConfigPresent: false,
    })).toEqual({
      ready: true,
      mode: "development",
      persistence: "development_memory",
    });
  });

  it("fails closed when production configuration is incomplete", () => {
    expect(getRuntimeReadiness({
      isProduction: true,
      databaseConfigured: true,
      requiredProductionConfigPresent: false,
    })).toMatchObject({ ready: false, mode: "production" });
  });
});
