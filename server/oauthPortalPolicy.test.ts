import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const productionEnv = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: "mysql://user:password@localhost:3306/hire_ai",
  JWT_SECRET: "doctor-test-cookie-secret-at-least-32-characters",
  VITE_APP_ID: "hire-ai-doctor-test",
  OAUTH_SERVER_URL: "https://oauth.example.test",
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

function runDoctor(portalUrl: string) {
  return spawnSync(process.execPath, [resolve("scripts", "doctor.mjs")], {
    cwd: process.cwd(),
    env: { ...productionEnv, OAUTH_PORTAL_URL: portalUrl },
    encoding: "utf8",
  });
}

describe("OAuth portal production policy", () => {
  it("accepts a runtime HTTPS portal", () => {
    const result = runDoctor("https://auth.example.test");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS OAuth portal: trusted runtime URL configured");
  });

  it.each(["", "http://auth.example.test", "https://user:password@auth.example.test", "https://auth.example.test?tenant=hire-ai"])(
    "rejects unsafe or missing runtime portal %s",
    (value) => {
      const result = runDoctor(value);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("FAIL OAuth portal");
    }
  );
});
