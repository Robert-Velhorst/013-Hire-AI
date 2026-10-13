import path from "node:path";

function normalizeReportPath(file) {
  return path.resolve(file).split(path.sep).join("/");
}

export function verifyDatabaseAcceptanceReport(report, suites, root) {
  const failures = [];
  const results = new Map(
    (report.testResults || []).map(result => [
      normalizeReportPath(result.name),
      result,
    ])
  );

  for (const suite of suites) {
    const expectedPath = normalizeReportPath(path.join(root, suite));
    const result = results.get(expectedPath);
    if (!result) {
      failures.push(`${suite}: no test result was reported`);
      continue;
    }
    const assertions = result.assertionResults || [];
    const skipped = assertions.filter(
      assertion => assertion.status === "skipped"
    );
    const failed = assertions.filter(
      assertion =>
        assertion.status !== "passed" && assertion.status !== "skipped"
    );
    if (assertions.length === 0) failures.push(`${suite}: no tests executed`);
    if (skipped.length > 0)
      failures.push(`${suite}: ${skipped.length} test(s) were skipped`);
    if (failed.length > 0)
      failures.push(`${suite}: ${failed.length} test(s) did not pass`);
  }

  if (report.numFailedTests > 0)
    failures.push(`${report.numFailedTests} test(s) failed`);
  if (report.numPendingTests > 0)
    failures.push(`${report.numPendingTests} test(s) were pending`);
  return failures;
}
