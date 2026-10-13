import { describe, expect, it } from "vitest";
import { planPendingMigrations } from "../scripts/database-migration-plan.mjs";

describe("database migration ordering", () => {
  it("applies missing out-of-order journal entries after the ledger high-water mark", () => {
    const migrations = [
      { hash: "already-applied", folderMillis: 100, sql: [] },
      { hash: "out-of-order", folderMillis: 50, sql: [] },
      { hash: "new", folderMillis: 60, sql: [] },
    ];

    expect(planPendingMigrations(migrations, ["already-applied"], 200, 150)).toEqual([
      { hash: "out-of-order", folderMillis: 201, sql: [] },
      { hash: "new", folderMillis: 202, sql: [] },
    ]);
  });

  it("does not re-run a migration whose exact content hash is already recorded", () => {
    const migrations = [{ hash: "known", folderMillis: 10, sql: [] }];
    expect(planPendingMigrations(migrations, ["known"], 50, 20)).toEqual([]);
  });

  it("fails closed when the database ledger contains a hash outside this journal", () => {
    expect(() =>
      planPendingMigrations(
        [{ hash: "current", folderMillis: 10, sql: [] }],
        ["unknown-from-another-branch"],
        50,
        20
      )
    ).toThrow("Database migration ledger contains hashes absent from this journal");
  });

  it("rejects duplicate migration hashes in the journal", () => {
    expect(() =>
      planPendingMigrations(
        [
          { hash: "duplicate", folderMillis: 10, sql: [] },
          { hash: "duplicate", folderMillis: 20, sql: [] },
        ],
        [],
        0,
        30
      )
    ).toThrow("Migration journal contains a duplicate content hash");
  });
});
