import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const productionEnv = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: "mysql://user:password@localhost:3306/hire_ai",
  JWT_SECRET: "doctor-test-cookie-secret",
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
};

function runDoctor(sessionTtlMs: string) {
  return spawnSync(process.execPath, [resolve("scripts", "doctor.mjs")], {
    cwd: process.cwd(),
    env: { ...productionEnv, SESSION_TTL_MS: sessionTtlMs },
    encoding: "utf8",
  });
}

describe("session lifetime production policy", () => {
  it("accepts a bounded absolute lifetime", () => {
    const result = runDoctor("604800000");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "PASS session lifetime policy: 604800000ms absolute lifetime"
    );
  });

  it.each(["unbounded", "900000.5", "899999", "2592000001"])(
    "rejects invalid lifetime %s",
    (value) => {
      const result = runDoctor(value);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("FAIL session lifetime policy");
    }
  );
});
