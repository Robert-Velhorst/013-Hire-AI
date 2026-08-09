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
      expectedIndexCount: 0,
      actualIndexCount: 0,
      missingTables: ["employer_responses"],
      missingColumns: ["users.email"],
      unexpectedColumns: ["users.legacy_name"],
      missingIndexes: [],
      mismatchedIndexes: [],
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

  it("reports missing and structurally mismatched named indexes", () => {
    const audit = compareDatabaseSchema(
      new Map([["applications", new Set(["user_id", "job_id", "status"])]]),
      [
        { tableName: "applications", columnName: "user_id" },
        { tableName: "applications", columnName: "job_id" },
        { tableName: "applications", columnName: "status" },
      ],
      new Map([["applications", new Map([
        ["applications_user_job_unique", { columns: ["user_id", "job_id"], unique: true }],
        ["applications_user_status_idx", { columns: ["user_id", "status"], unique: false }],
      ])]]),
      [
        { tableName: "applications", indexName: "applications_user_job_unique", nonUnique: 1, sequence: 2, columnName: "job_id" },
        { tableName: "applications", indexName: "applications_user_job_unique", nonUnique: 1, sequence: 1, columnName: "user_id" },
      ]
    );

    expect(audit.missingIndexes).toEqual(["applications.applications_user_status_idx"]);
    expect(audit.expectedIndexCount).toBe(2);
    expect(audit.actualIndexCount).toBe(1);
    expect(audit.mismatchedIndexes).toEqual([
      "applications.applications_user_job_unique: expected unique (user_id,job_id), actual (user_id,job_id)",
    ]);
    expect(hasDatabaseSchemaDrift(audit)).toBe(true);
  });
});
