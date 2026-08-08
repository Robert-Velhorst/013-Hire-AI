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

/**
 * Apply baseline response protections without depending on a middleware package.
 * The policy intentionally leaves Vite development behavior untouched.
 */
export function applyHttpSafetyHeaders(response: Pick<Response, "setHeader">, isProduction: boolean) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");

  if (isProduction) {
    response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'"
    );
  }
}

export function getRuntimeReadiness(input: RuntimeReadinessInput): RuntimeReadiness {
  if (!input.isProduction) {
    return {
      ready: true,
      mode: "development",
      persistence: input.databaseConfigured ? "database_configured" : "development_memory",
    };
  }

  return {
    ready: input.databaseConfigured && input.requiredProductionConfigPresent,
    mode: "production",
    persistence: input.databaseConfigured ? "database_configured" : "not_configured",
  };
}
