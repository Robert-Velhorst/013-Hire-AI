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
  HAI_CONNECTOR_ENABLED: "false",
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
};

function runDoctor(extra: Record<string, string> = {}) {
  return spawnSync(process.execPath, [resolve("scripts", "doctor.mjs")], {
    cwd: process.cwd(),
    env: { ...productionEnv, ...extra },
    encoding: "utf8",
  });
}

describe("connector OAuth production doctor policy", () => {
  it("accepts intentionally disabled connectors", () => {
    const result = runDoctor();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS connector OAuth: disabled");
  });

  it("accepts a complete provider configuration without printing values", () => {
    const encryptionKey = Buffer.alloc(32, 7).toString("base64");
    const stateSecret = "doctor-connector-state-secret-at-least-32-characters";
    const result = runDoctor({
      CONNECTOR_OAUTH_REDIRECT_URI: "https://hire.example.test/api/connectors/oauth/callback",
      CONNECTOR_TOKEN_ENCRYPTION_KEY: encryptionKey,
      CONNECTOR_OAUTH_STATE_SECRET: stateSecret,
      GOOGLE_OAUTH_CLIENT_ID: "doctor-google-client",
      GOOGLE_OAUTH_CLIENT_SECRET: "doctor-google-secret",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS connector OAuth: 2 connector(s) configured");
    expect(result.stdout).not.toContain(encryptionKey);
    expect(result.stdout).not.toContain(stateSecret);
  });

  it("rejects partial and weak configuration", () => {
    const result = runDoctor({
      CONNECTOR_OAUTH_REDIRECT_URI: "https://hire.example.test/api/connectors/oauth/callback",
      CONNECTOR_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      CONNECTOR_OAUTH_STATE_SECRET: "short",
      GOOGLE_OAUTH_CLIENT_ID: "doctor-google-client",
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL connector OAuth");
  });
});
