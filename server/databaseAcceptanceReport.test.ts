import path from "node:path";
import { describe, expect, it } from "vitest";
import { verifyDatabaseAcceptanceReport } from "../scripts/database-acceptance-report.mjs";

const root = path.resolve(".");
const suite = "server/example.integration.test.ts";

function reportFor(assertionResults: Array<{ status: string }>) {
  return {
    numFailedTests: assertionResults.filter(
      result => result.status === "failed"
    ).length,
    numPendingTests: assertionResults.filter(
      result => result.status === "skipped" || result.status === "pending"
    ).length,
    testResults: [
      {
        name: path.join(root, suite),
        assertionResults,
      },
    ],
  };
}

describe("database acceptance report verification", () => {
  it("accepts every approved suite only when its tests pass", () => {
    expect(
      verifyDatabaseAcceptanceReport(
        reportFor([{ status: "passed" }]),
        [suite],
        root
      )
    ).toEqual([]);
  });

  it("fails when an approved suite has no report or executes no tests", () => {
    expect(
      verifyDatabaseAcceptanceReport({ testResults: [] }, [suite], root)
    ).toContain(`${suite}: no test result was reported`);
    expect(
      verifyDatabaseAcceptanceReport(reportFor([]), [suite], root)
    ).toContain(`${suite}: no tests executed`);
  });

  it("fails when a suite silently skips an expected test", () => {
    expect(
      verifyDatabaseAcceptanceReport(
        reportFor([{ status: "skipped" }]),
        [suite],
        root
      )
    ).toContain(`${suite}: 1 test(s) were skipped`);
  });

  it("fails on failed or pending tests even if a report was generated", () => {
    const failures = verifyDatabaseAcceptanceReport(
      reportFor([{ status: "failed" }, { status: "pending" }]),
      [suite],
      root
    );
    expect(failures).toContain(`${suite}: 2 test(s) did not pass`);
    expect(failures).toContain("1 test(s) failed");
    expect(failures).toContain("1 test(s) were pending");
  });
});
