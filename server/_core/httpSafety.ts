import type { Response } from "express";

export type RuntimeReadinessInput = {
  isProduction: boolean;
  databaseConfigured: boolean;
  requiredProductionConfigPresent: boolean;
};

export type RuntimeReadiness = {
  ready: boolean;
  mode: "development" | "production";
  persistence: "database_configured" | "development_memory" | "not_configured";
};

export const PRODUCTION_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "img-src 'self' data: blob:",
  "manifest-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "script-src 'self'",
  "script-src-attr 'none'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "style-src-elem 'self' 'sha256-CIxDM5jnsGiKqXs2v7NKCY5MzdR9gu6TtiMJrDw29AY=' 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='",
  "worker-src 'none'",
].join("; ");

export function normalizeApprovedAnalyticsOrigin(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;

  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

export function createProductionContentSecurityPolicy(analyticsOrigin?: string) {
  const approvedOrigin = normalizeApprovedAnalyticsOrigin(analyticsOrigin);
  if (!approvedOrigin) return PRODUCTION_CONTENT_SECURITY_POLICY;

  return PRODUCTION_CONTENT_SECURITY_POLICY
    .replace("connect-src 'self'", `connect-src 'self' ${approvedOrigin}`)
    .replace("script-src 'self'", `script-src 'self' ${approvedOrigin}`);
}

/**
 * Apply baseline response protections without depending on a middleware package.
 * The policy intentionally leaves Vite development behavior untouched.
 */
export function applyHttpSafetyHeaders(
  response: Pick<Response, "setHeader">,
  isProduction: boolean,
  analyticsAllowedOrigin?: string
) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()"
  );
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");

  if (isProduction) {
    response.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
    response.setHeader(
      "Content-Security-Policy",
      createProductionContentSecurityPolicy(analyticsAllowedOrigin)
    );
  }
}

export function getRuntimeReadiness(
  input: RuntimeReadinessInput
): RuntimeReadiness {
  if (!input.isProduction) {
    return {
      ready: true,
      mode: "development",
      persistence: input.databaseConfigured
        ? "database_configured"
        : "development_memory",
    };
  }

  return {
    ready: input.databaseConfigured && input.requiredProductionConfigPresent,
    mode: "production",
    persistence: input.databaseConfigured
      ? "database_configured"
      : "not_configured",
  };
}
