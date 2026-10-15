import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("database acceptance command safety", () => {
  it.each([
    { HIRE_AI_DATABASE_ACCEPTANCE: "", DATABASE_URL: "" },
    {
      HIRE_AI_DATABASE_ACCEPTANCE: "true",
      DATABASE_URL: "mysql://user:private-password@localhost/production",
    },
    {
      HIRE_AI_DATABASE_ACCEPTANCE: "true",
      DATABASE_URL: "invalid private-password",
    },
    {
      HIRE_AI_DATABASE_ACCEPTANCE: "true",
      DATABASE_URL:
        "mysql://user:private-password@localhost/hire_ai_acceptance",
      NODE_ENV: "production",
    },
  ])("fails instead of passing a skipped or unsafe database run", extra => {
    const result = spawnSync(
      process.execPath,
      ["scripts/run-database-acceptance.mjs"],
      {
        env: { ...process.env, ...extra },
        encoding: "utf8",
        timeout: 10000,
      }
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "dedicated local hire_ai_acceptance database"
    );
    expect(result.stderr).not.toContain("private-password");
    expect(result.stdout).not.toContain("RUN");
  });

  it.each([
    {
      HIRE_AI_DATABASE_ACCEPTANCE: "true",
      NODE_ENV: "production",
      DATABASE_URL:
        "mysql://user:private-password@127.0.0.1:3306/hire_ai_acceptance",
    },
    {
      HIRE_AI_DATABASE_ACCEPTANCE: "true",
      NODE_ENV: "test",
      DATABASE_URL:
        "mysql://user:private-password@database.example:3306/hire_ai_acceptance",
    },
  ])("refuses acceptance migrations for unsafe targets (%o)", extra => {
    const result = spawnSync(
      process.execPath,
      ["scripts/run-database-acceptance-migration.mjs"],
      {
        env: { ...process.env, ...extra },
        encoding: "utf8",
        timeout: 10000,
      }
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Refusing acceptance migrations");
    expect(result.stderr).not.toContain("private-password");
    expect(result.stdout).not.toContain("migration");
  });
});
