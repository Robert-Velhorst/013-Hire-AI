import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("discovery traffic policy", () => {
  it("propagates cancellation and shared HTTP handling through every network scraper", () => {
    const directory = resolve(process.cwd(), "server", "scrapers");
    const files = readdirSync(directory)
      .filter(file => /Scraper\.ts$/.test(file) && !/^(base|index)/.test(file));

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(resolve(directory, file), "utf8");
      const fetches = source.match(/\bfetch\(/g)?.length ?? 0;
      if (fetches === 0) continue;
      expect(source.match(/signal: options\?\.signal/g)?.length).toBe(fetches * 2);
      expect(source).not.toContain("if (!res.ok)");
      expect(source).not.toContain("statusText");
    }
  });

  it("fails the production doctor when scheduled discovery has no source allowlist", () => {
    const env = {
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
      FILE_MALWARE_SCAN_URL: "https://scanner.example.test",
      JOB_SCRAPING_SCHEDULER_ENABLED: "true",
      JOB_SCRAPING_MAX_CONCURRENT_SOURCES: "3",
      JOB_SCRAPING_SOURCE_TIMEOUT_MS: "90000",
      JOB_SCRAPING_ENABLED_PLATFORMS: "",
      HAI_CONNECTOR_ENABLED: "false",
    };
    const blocked = spawnSync(process.execPath, [resolve("scripts", "doctor.mjs")], {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
    });
    expect(blocked.status).toBe(1);
    expect(blocked.stdout).toContain("FAIL discovery traffic policy");

    const accepted = spawnSync(process.execPath, [resolve("scripts", "doctor.mjs")], {
      cwd: process.cwd(),
      env: { ...env, JOB_SCRAPING_ENABLED_PLATFORMS: "RemoteOK,Remotive" },
      encoding: "utf8",
    });
    expect(accepted.status).toBe(0);
    expect(accepted.stdout).toContain("PASS discovery traffic policy");
  });

  it("wires effective traffic limits into configuration and the admin surface", () => {
    const example = readFileSync(resolve(".env.example"), "utf8");
    const admin = readFileSync(resolve("client", "src", "pages", "AdminPanel.tsx"), "utf8");
    expect(example).toContain("JOB_SCRAPING_SOURCE_TIMEOUT_MS=90000");
    expect(example).toContain("JOB_SCRAPING_MAX_CONCURRENT_SOURCES=3");
    expect(admin).toContain('admin-discovery-metric-${id}');
    expect(admin).toContain('ac("concurrentSourceCap")');
    expect(admin).toContain('ac("sourceTimeout")');
  });

  it("fails production diagnostics when the selected scanner is unavailable", () => {
    const env = {
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
      FILE_MALWARE_SCAN_URL: "",
      JOB_SCRAPING_SCHEDULER_ENABLED: "false",
      HAI_CONNECTOR_ENABLED: "false",
    };
    const runDoctor = (extra: Record<string, string>) => spawnSync(process.execPath, [resolve("scripts", "doctor.mjs")], {
      cwd: process.cwd(), env: { ...env, ...extra }, encoding: "utf8",
    });
    const blocked = runDoctor({});
    expect(blocked.status).toBe(1);
    expect(blocked.stdout).toContain("FAIL document malware scanning");
    const malformed = runDoctor({ FILE_MALWARE_SCAN_URL: "file:///tmp/scanner" });
    expect(malformed.status).toBe(1);
    expect(malformed.stdout).toContain("scanner URL must be HTTP(S)");
    const accepted = runDoctor({ FILE_MALWARE_SCAN_URL: "https://scanner.example.test" });
    expect(accepted.status).toBe(0);
    expect(accepted.stdout).toContain("PASS document malware scanning");
  });
});
