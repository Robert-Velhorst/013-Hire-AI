import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("HAI status resource controls", () => {
  it("uses aggregate counts instead of loading unbounded account histories", () => {
    const connector = readFileSync(resolve(process.cwd(), "server", "haiConnector.ts"), "utf8");
    const database = readFileSync(resolve(process.cwd(), "server", "db.ts"), "utf8");
    const countFunction = database.slice(
      database.indexOf("export async function getUserHaiStatusCounts"),
      database.indexOf("export type ApplicationPageCursor")
    );

    expect(connector).toContain("getUserHaiStatusCounts(userId)");
    expect(connector).not.toContain("getUserApplications(userId)");
    expect(countFunction).toContain("COUNT(*)");
    expect(countFunction).toContain("Promise.all([");
    expect(countFunction).not.toContain(".select(userApplicationSelection)");
  });

  it("exposes only aggregate runtime signal counts to HAI", () => {
    const connector = readFileSync(resolve(process.cwd(), "server", "haiConnector.ts"), "utf8");
    expect(connector).toContain("totalFailures: runtimeSignals.totalFailures");
    expect(connector).toContain("uniqueSignals: runtimeSignals.uniqueSignals");
    expect(connector).not.toContain("runtimeSignals.signals.map");
  });
});
