import { describe, expect, it } from "vitest";
import {
  assertIndexedWindowPlan,
  type ExplainRow,
} from "../scripts/lib/database-query-plan-audit";

function row(overrides: Partial<ExplainRow> = {}): ExplainRow {
  return {
    table: "sf",
    type: "index",
    key: "success_fees_created_id_idx",
    rows: 100,
    Extra: null,
    ...overrides,
  } as ExplainRow;
}

describe("database query-plan audit", () => {
  it("accepts a bounded window using the required index", () => {
    expect(
      assertIndexedWindowPlan("fees", [row()], "success_fees_created_id_idx"),
    ).toMatchObject({
      index: "success_fees_created_id_idx",
      accessType: "index",
      estimatedRows: 100,
    });
  });

  it.each([
    ["missing table", [], "did not include"],
    ["wrong index", [row({ key: "another_index" })], "expected success_fees_created_id_idx"],
    ["full scan", [row({ type: "ALL" })], "full table scan"],
    ["filesort", [row({ Extra: "Using filesort" })], "filesort"],
  ])("rejects %s", (_name, rows, message) => {
    expect(() =>
      assertIndexedWindowPlan(
        "fees",
        rows as ExplainRow[],
        "success_fees_created_id_idx",
      ),
    ).toThrow(message as string);
  });
});
