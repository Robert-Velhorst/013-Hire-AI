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
      mismatchedColumns: [],
      unexpectedColumns: ["users.legacy_name"],
      missingIndexes: [],
      mismatchedIndexes: [],
      expectedForeignKeyCount: 0,
      actualForeignKeyCount: 0,
      missingForeignKeys: [],
      mismatchedForeignKeys: [],
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

  it("reports SQL type and nullability drift", () => {
    const audit = compareDatabaseSchema(
      new Map([["users", new Set(["id", "email"])]]),
      [
        { tableName: "users", columnName: "id", sqlType: "bigint", isNullable: "NO" },
        { tableName: "users", columnName: "email", sqlType: "varchar(255)", isNullable: "YES" },
      ],
      new Map(),
      [],
      new Map([["users", new Map([
        ["id", { sqlType: "int", nullable: false }],
        ["email", { sqlType: "varchar(320)", nullable: false }],
      ])]])
    );

    expect(audit.mismatchedColumns).toEqual([
      "users.email: expected varchar(320) NOT NULL, actual varchar(255) NULL",
      "users.id: expected int NOT NULL, actual bigint NOT NULL",
    ]);
    expect(hasDatabaseSchemaDrift(audit)).toBe(true);
  });

  it("reports missing foreign keys and referential-action drift", () => {
    const audit = compareDatabaseSchema(
      new Map([["applications", new Set(["user_id", "job_id"])]]),
      [
        { tableName: "applications", columnName: "user_id" },
        { tableName: "applications", columnName: "job_id" },
      ],
      new Map(),
      [],
      new Map(),
      new Map([["applications", [
        { columns: ["user_id"], referencedTable: "users", referencedColumns: ["id"], onDelete: "cascade", onUpdate: "restrict" },
        { columns: ["job_id"], referencedTable: "jobs", referencedColumns: ["id"], onDelete: "restrict", onUpdate: "restrict" },
      ]]]),
      [{
        tableName: "applications",
        constraintName: "applications_user_fk",
        columnName: "user_id",
        sequence: 1,
        referencedTable: "users",
        referencedColumn: "id",
        deleteRule: "SET NULL",
        updateRule: "RESTRICT",
      }]
    );

    expect(audit.expectedForeignKeyCount).toBe(2);
    expect(audit.actualForeignKeyCount).toBe(1);
    expect(audit.missingForeignKeys).toEqual(["applications.job_id -> jobs(id)"]);
    expect(audit.mismatchedForeignKeys).toEqual([
      "applications.user_id -> users(id): expected DELETE CASCADE UPDATE RESTRICT, actual DELETE SET NULL UPDATE RESTRICT",
    ]);
    expect(hasDatabaseSchemaDrift(audit)).toBe(true);
  });
});
