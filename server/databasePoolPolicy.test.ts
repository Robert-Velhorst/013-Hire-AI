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

function runDoctor(extra: Record<string, string>) {
  return spawnSync(process.execPath, [resolve("scripts", "doctor.mjs")], {
    cwd: process.cwd(),
    env: { ...productionEnv, ...extra },
    encoding: "utf8",
  });
}

describe("database pool policy", () => {
  it("accepts bounded deployment settings", () => {
    const result = runDoctor({
      DATABASE_POOL_LIMIT: "8",
      DATABASE_POOL_QUEUE_LIMIT: "64",
      DATABASE_POOL_IDLE_TIMEOUT_MS: "45000",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS database pool policy: 8 connections, 64 queued requests, 45000ms idle timeout");
  });

  it.each([
    ["DATABASE_POOL_LIMIT", "0"],
    ["DATABASE_POOL_LIMIT", "51"],
    ["DATABASE_POOL_QUEUE_LIMIT", "unbounded"],
    ["DATABASE_POOL_IDLE_TIMEOUT_MS", "9999"],
  ])("rejects invalid %s configuration", (name, value) => {
    const result = runDoctor({ [name]: value });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL database pool policy");
  });
});
