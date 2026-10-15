import { describe, expect, it } from "vitest";
import { isDatabaseAcceptanceTarget } from "../scripts/database-acceptance-policy.mjs";

describe("database acceptance target policy", () => {
  const validEnvironment = {
    HIRE_AI_DATABASE_ACCEPTANCE: "true",
    NODE_ENV: "test",
    DATABASE_URL:
      "mysql://acceptance:synthetic-password@127.0.0.1:3306/hire_ai_acceptance",
  };

  it("allows the explicit local MySQL acceptance database", () => {
    expect(isDatabaseAcceptanceTarget(validEnvironment)).toBe(true);
  });

  it.each([
    { HIRE_AI_DATABASE_ACCEPTANCE: "false" },
    { NODE_ENV: "production" },
    { DATABASE_URL: "mysql://user:password@127.0.0.1:3306/production" },
    {
      DATABASE_URL:
        "mysql://user:password@database.example:3306/hire_ai_acceptance",
    },
    {
      DATABASE_URL:
        "postgres://user:password@127.0.0.1:5432/hire_ai_acceptance",
    },
    { DATABASE_URL: "not-a-database-url" },
  ])("rejects a missing, production, remote, or invalid target (%o)", extra => {
    expect(isDatabaseAcceptanceTarget({ ...validEnvironment, ...extra })).toBe(
      false
    );
  });

  it("accepts the IPv6 loopback host", () => {
    expect(
      isDatabaseAcceptanceTarget({
        ...validEnvironment,
        DATABASE_URL:
          "mysql://acceptance:synthetic-password@[::1]:3306/hire_ai_acceptance",
      })
    ).toBe(true);
  });
});
