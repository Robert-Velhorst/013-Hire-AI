import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { createOAuthHttpClient } from "./_core/sdk";
import { describe, expect, it } from "vitest";

const productionEnv = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: "mysql://user:password@localhost:3306/hire_ai",
  ERASURE_IDENTITY_HMAC_KEYS: "doctor-erasure-identity-hmac-key-at-least-32-characters",
  JWT_SECRET: "doctor-test-cookie-secret-at-least-32-characters",
  VITE_APP_ID: "hire-ai-doctor-test",
  OAUTH_SERVER_URL: "https://oauth.example.test",
  OAUTH_SERVER_ALLOWED_ORIGINS: "https://oauth.example.test",
  PUBLIC_APP_ORIGIN: "https://hire.example.test",
  OWNER_OPEN_ID: "doctor-owner",
  BUILT_IN_FORGE_API_KEY: "doctor-forge-key",
  STRIPE_SECRET_KEY: "sk_test_doctor",
  STRIPE_WEBHOOK_SECRET: "whsec_doctor",
  FILE_MALWARE_SCAN_MODE: "http",
  FILE_MALWARE_SCAN_URL: "https://scanner.example.test",
  JOB_SCRAPING_SCHEDULER_ENABLED: "false",
  HAI_CONNECTOR_ENABLED: "false",
  VITE_OAUTH_PORTAL_URL: "",
};

function runDoctor(
  portalUrl: string,
  oauthServerUrl = productionEnv.OAUTH_SERVER_URL,
  oauthServerAllowedOrigins = productionEnv.OAUTH_SERVER_ALLOWED_ORIGINS,
  nodeEnv = "production"
) {
  return spawnSync(process.execPath, [resolve("scripts", "doctor.mjs")], {
    cwd: process.cwd(),
    env: {
      ...productionEnv,
      NODE_ENV: nodeEnv,
      OAUTH_PORTAL_URL: portalUrl,
      OAUTH_SERVER_URL: oauthServerUrl,
      OAUTH_SERVER_ALLOWED_ORIGINS: oauthServerAllowedOrigins,
    },
    encoding: "utf8",
  });
}

function runProductionValidation(
  oauthServerUrl: string,
  oauthServerAllowedOrigins = productionEnv.OAUTH_SERVER_ALLOWED_ORIGINS,
  nodeEnv = "production"
) {
  return spawnSync(
    process.execPath,
    [
      "--import=tsx",
      "--eval",
      "import('./server/_core/env.ts').then(({ validateProductionEnv }) => validateProductionEnv())",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...productionEnv,
        NODE_ENV: nodeEnv,
        OAUTH_SERVER_URL: oauthServerUrl,
        OAUTH_SERVER_ALLOWED_ORIGINS: oauthServerAllowedOrigins,
        OAUTH_PORTAL_URL: "https://auth.example.test",
      },
      encoding: "utf8",
    }
  );
}

describe("OAuth endpoint production policy", () => {
  it("does not forward OAuth token POST bodies across redirects", () => {
    expect(createOAuthHttpClient().defaults.maxRedirects).toBe(0);
  });

  it("accepts a runtime HTTPS portal", () => {
    const result = runDoctor("https://auth.example.test");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS OAuth portal: trusted runtime URL configured");
  });

  it.each([
    "",
    "http://auth.example.test",
    "https://user:password@auth.example.test",
    "https://auth.example.test?tenant=hire-ai",
    "https://auth.example.test?",
    "https://auth.example.test#",
  ])(
    "rejects unsafe or missing runtime portal %s",
    (value) => {
      const result = runDoctor(value);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("FAIL OAuth portal");
    }
  );

  it("accepts an HTTPS OAuth server and local loopback HTTP for standalone use", () => {
    const result = runDoctor("https://auth.example.test", "http://localhost:3000", "", "development");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS OAuth server: trusted runtime URL configured");
  });

  it("rejects a production OAuth server outside its configured allowlist in the doctor", () => {
    const result = runDoctor(
      "https://auth.example.test",
      "https://other.example.test",
      productionEnv.OAUTH_SERVER_ALLOWED_ORIGINS
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL OAuth server");
  });

  it("requires an explicitly allowlisted HTTPS origin for production OAuth", () => {
    expect(runProductionValidation("https://oauth.example.test").status).toBe(0);
    expect(runProductionValidation("https://other.example.test").status).not.toBe(0);
    expect(runProductionValidation("http://localhost:3000").status).not.toBe(0);
    expect(runProductionValidation("https://oauth.example.test", "").status).not.toBe(0);
    const missingAllowlist = runDoctor("https://auth.example.test", "https://oauth.example.test", "");
    expect(missingAllowlist.status).toBe(1);
    expect(missingAllowlist.stdout).toContain("FAIL production configuration");
  });

  it("enforces a configured OAuth allowlist during development startup", () => {
    expect(runProductionValidation(
      "https://oauth.example.test",
      productionEnv.OAUTH_SERVER_ALLOWED_ORIGINS,
      "development"
    ).status).toBe(0);
    expect(runProductionValidation(
      "https://other.example.test",
      productionEnv.OAUTH_SERVER_ALLOWED_ORIGINS,
      "development"
    ).status).not.toBe(0);
  });

  it.each([
    "http://oauth.example.test",
    "https://user:password@oauth.example.test",
    "https://oauth.example.test?tenant=hire-ai",
    "https://oauth.example.test?",
    "https://oauth.example.test#",
  ])("rejects an unsafe OAuth server URL %s", (value) => {
    const result = runDoctor("https://auth.example.test", value);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL OAuth server");
  });

  it("enforces the trusted OAuth server URL at production startup", () => {
    expect(runProductionValidation("https://oauth.example.test").status).toBe(0);
    expect(runProductionValidation("http://oauth.example.test").status).not.toBe(0);
    expect(runProductionValidation("https://oauth.example.test?").status).not.toBe(0);
  });
});
