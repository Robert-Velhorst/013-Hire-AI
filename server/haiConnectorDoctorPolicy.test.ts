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
  OAUTH_PORTAL_URL: "https://auth.example.test",
  OWNER_OPEN_ID: "doctor-owner",
  BUILT_IN_FORGE_API_KEY: "doctor-forge-key",
  STRIPE_SECRET_KEY: "sk_test_doctor",
  STRIPE_WEBHOOK_SECRET: "whsec_doctor",
  FILE_MALWARE_SCAN_MODE: "http",
  FILE_MALWARE_SCAN_URL: "https://scanner.example.test",
  JOB_SCRAPING_SCHEDULER_ENABLED: "false",
  CONNECTOR_OAUTH_REDIRECT_URI: "",
  CONNECTOR_TOKEN_ENCRYPTION_KEY: "",
  CONNECTOR_OAUTH_STATE_SECRET: "",
  GOOGLE_OAUTH_CLIENT_ID: "",
  GOOGLE_OAUTH_CLIENT_SECRET: "",
  DROPBOX_OAUTH_CLIENT_ID: "",
  DROPBOX_OAUTH_CLIENT_SECRET: "",
  MICROSOFT_OAUTH_CLIENT_ID: "",
  MICROSOFT_OAUTH_CLIENT_SECRET: "",
  LINKEDIN_OAUTH_CLIENT_ID: "",
  LINKEDIN_OAUTH_CLIENT_SECRET: "",
  GITHUB_OAUTH_CLIENT_ID: "",
  GITHUB_OAUTH_CLIENT_SECRET: "",
  HAI_CONNECTOR_ENABLED: "true",
  HAI_CONNECTOR_TOKEN: "doctor-hai-token-at-least-32-random-characters",
  HAI_CONNECTOR_USER_ID: "41",
  HAI_CONNECTOR_URL: "http://127.0.0.1:3000/api/hai/a2a",
};

function runDoctor(extra: Record<string, string> = {}) {
  return spawnSync(process.execPath, [resolve("scripts", "doctor.mjs")], {
    cwd: process.cwd(),
    env: { ...productionEnv, ...extra },
    encoding: "utf8",
  });
}

describe("HAI production doctor policy", () => {
  it("accepts a complete connector without printing its token", () => {
    const result = runDoctor();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS HAI connector: configured read-only local bridge");
    expect(result.stdout).not.toContain(productionEnv.HAI_CONNECTOR_TOKEN);
  });

  it.each([
    [{ HAI_CONNECTOR_TOKEN: "replace-with-at-least-32-random-characters" }, "placeholder"],
    [{ HAI_CONNECTOR_TOKEN: "doctor token with whitespace that is long enough" }, "whitespace"],
    [{ HAI_CONNECTOR_USER_ID: "41junk" }, "positive user ID"],
    [{ HAI_CONNECTOR_URL: "http://127.0.0.1:3000/api/hai/status" }, "/api/hai/a2a"],
  ])("rejects unsafe HAI configuration", (extra, message) => {
    const result = runDoctor(extra);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL HAI connector");
    expect(result.stdout).toContain(message);
  });
});
