import { describe, expect, it } from "vitest";
import {
  compareDatabaseSchema,
  hasDatabaseSchemaDrift,
} from "../scripts/lib/database-schema-audit";

describe("database schema audit", () => {
  it("reports missing tables, missing columns, and unexpected migrated columns", () => {
    const expected = new Map([
      ["users", new Set(["id", "email"])],
      ["employer_responses", new Set(["id", "interview_id"])],
    ]);

    const audit = compareDatabaseSchema(expected, [
      { tableName: "users", columnName: "id" },
      { tableName: "users", columnName: "legacy_name" },
    ]);
    expect(audit).toEqual({
      expectedTableCount: 2,
      actualTableCount: 1,
      missingTables: ["employer_responses"],
      missingColumns: ["users.email"],
      unexpectedColumns: ["users.legacy_name"],
    });
    expect(hasDatabaseSchemaDrift(audit)).toBe(true);
  });

  it("accepts an exact runtime schema", () => {
    const audit = compareDatabaseSchema(
      new Map([["users", new Set(["id", "email"])]]),
      [
        { tableName: "users", columnName: "id" },
        { tableName: "users", columnName: "email" },
      ]
    );

    expect(hasDatabaseSchemaDrift(audit)).toBe(false);
  });
});
