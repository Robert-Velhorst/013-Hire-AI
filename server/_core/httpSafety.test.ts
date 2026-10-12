import { describe, expect, it } from "vitest";
import {
  applyHttpSafetyHeaders,
  getRuntimeReadiness,
  PRODUCTION_CONTENT_SECURITY_POLICY,
} from "./httpSafety";

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
    expect(headers.get("Content-Security-Policy")).toBe(
      PRODUCTION_CONTENT_SECURITY_POLICY
    );
    expect(PRODUCTION_CONTENT_SECURITY_POLICY).toContain(
      "style-src-elem 'self'"
    );
    expect(PRODUCTION_CONTENT_SECURITY_POLICY).toContain(
      "style-src-attr 'none'"
    );
    expect(PRODUCTION_CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(PRODUCTION_CONTENT_SECURITY_POLICY).toContain(
      "frame-ancestors 'none'"
    );
    expect(PRODUCTION_CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    expect(PRODUCTION_CONTENT_SECURITY_POLICY).not.toMatch(
      /unsafe-inline|unsafe-eval|https?:\/\//i
    );
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
