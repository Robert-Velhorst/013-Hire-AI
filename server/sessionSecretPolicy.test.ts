import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const productionEnv = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: "mysql://user:password@localhost:3306/hire_ai",
  VITE_APP_ID: "hire-ai-doctor-test",
  OAUTH_SERVER_URL: "https://oauth.example.test",
  OAUTH_PORTAL_URL: "https://auth.example.test",
  OWNER_OPEN_ID: "doctor-owner",
  BUILT_IN_FORGE_API_KEY: "doctor-forge-key",
  STRIPE_SECRET_KEY: "sk_test_doctor",
  STRIPE_WEBHOOK_SECRET: "whsec_doctor",
  FILE_MALWARE_SCAN_MODE: "http",
  FILE_MALWARE_SCAN_URL: "https://scanner.example.test",
  JOB_SCRAPING_SCHEDULER_ENABLED: "false",
  HAI_CONNECTOR_ENABLED: "false",
};

function runDoctor(jwtSecret: string) {
  return spawnSync(process.execPath, [resolve("scripts", "doctor.mjs")], {
    cwd: process.cwd(),
    env: { ...productionEnv, JWT_SECRET: jwtSecret },
    encoding: "utf8",
  });
}

describe("session signing secret production policy", () => {
  it("accepts a bounded non-placeholder secret", () => {
    const result = runDoctor("f4wR9x2Qm7Kp3Vn8Yt6Hs1Lc5Jd0ZaEu");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS session signing secret");
  });

  it.each([
    "short-secret",
    "replace-with-a-long-random-secret",
    "hire-ai-local-dev-cookie-secret",
    ` ${"a".repeat(32)}`,
    `${"a".repeat(32)}\n`,
    "a".repeat(4_097),
  ])("rejects unsafe secret configuration", (value) => {
    const result = runDoctor(value);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL session signing secret");
  });
});
