import { describe, expect, it } from "vitest";
import {
  applyHttpSafetyHeaders,
  createProductionContentSecurityPolicy,
  getRuntimeReadiness,
  normalizeApprovedAnalyticsOrigin,
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
      "style-src-attr 'unsafe-inline'"
    );
    expect(PRODUCTION_CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(PRODUCTION_CONTENT_SECURITY_POLICY).toContain(
      "frame-ancestors 'none'"
    );
    expect(PRODUCTION_CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    expect(PRODUCTION_CONTENT_SECURITY_POLICY).not.toMatch(/unsafe-eval|https?:\/\//i);
    expect(PRODUCTION_CONTENT_SECURITY_POLICY).toContain("script-src-attr 'none'");
    expect(PRODUCTION_CONTENT_SECURITY_POLICY).not.toContain("script-src 'self' https:");
  });

  it("allows analytics only from an explicitly approved HTTPS origin", () => {
    expect(createProductionContentSecurityPolicy("https://metrics.example.test")).toContain(
      "connect-src 'self' https://metrics.example.test"
    );
    expect(createProductionContentSecurityPolicy("https://metrics.example.test")).toContain(
      "script-src 'self' https://metrics.example.test"
    );
    expect(createProductionContentSecurityPolicy("http://metrics.example.test")).toBe(
      PRODUCTION_CONTENT_SECURITY_POLICY
    );
    expect(createProductionContentSecurityPolicy("https://metrics.example.test/path")).toBe(
      PRODUCTION_CONTENT_SECURITY_POLICY
    );
  });

  it("normalizes only credential-free HTTPS origins", () => {
    expect(normalizeApprovedAnalyticsOrigin("https://metrics.example.test/")).toBe(
      "https://metrics.example.test"
    );
    expect(normalizeApprovedAnalyticsOrigin("https://user:pass@metrics.example.test")).toBeUndefined();
    expect(normalizeApprovedAnalyticsOrigin("https://metrics.example.test/path")).toBeUndefined();
    expect(normalizeApprovedAnalyticsOrigin("javascript:alert(1)")).toBeUndefined();
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
