import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
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
  OAUTH_PORTAL_URL: "https://auth.example.test",
  PUBLIC_APP_ORIGIN: "https://hire.example.test",
  OWNER_OPEN_ID: "doctor-owner",
  BUILT_IN_FORGE_API_KEY: "doctor-forge-key",
  STRIPE_SECRET_KEY: "sk_test_doctor",
  STRIPE_WEBHOOK_SECRET: "whsec_doctor",
  FILE_MALWARE_SCAN_MODE: "http",
  FILE_MALWARE_SCAN_URL: "https://scanner.example.test",
  FILE_MALWARE_SCAN_ALLOWED_ORIGINS: "https://scanner.example.test",
  JOB_SCRAPING_SCHEDULER_ENABLED: "false",
  HAI_CONNECTOR_ENABLED: "false",
};

function runDoctor(publicAppOrigin: string) {
  return spawnSync(process.execPath, [resolve("scripts", "doctor.mjs")], {
    cwd: process.cwd(),
    env: { ...productionEnv, PUBLIC_APP_ORIGIN: publicAppOrigin },
    encoding: "utf8",
  });
}

describe("public application origin production doctor policy", () => {
  it("accepts the canonical HTTPS origin", () => {
    const result = runDoctor("https://hire.example.test");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS public application origin: canonical HTTPS origin configured");
  });

  it.each(["", "http://hire.example.test", "https://hire.example.test/path"])(
    "rejects invalid public origins: %s",
    value => {
      const result = runDoctor(value);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("FAIL public application origin");
    }
  );
});
