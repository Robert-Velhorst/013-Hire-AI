import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("inbox response discovery data minimization", () => {
  it("uses the owner-scoped minimal application projection", () => {
    const discovery = readFileSync(resolve(process.cwd(), "server", "inboxResponseDiscovery.ts"), "utf8");
    const database = readFileSync(resolve(process.cwd(), "server", "db.ts"), "utf8");
    const projection = database.slice(
      database.indexOf("export async function getUserInboxMatchApplications"),
      database.indexOf("export type HaiStatusCounts")
    );

    expect(discovery).toContain("getUserInboxMatchApplications(userId)");
    expect(discovery).not.toContain("getUserApplications(userId)");
    expect(projection).toContain("eq(applications.userId, userId)");
    expect(projection).toContain("company: jobs.company");
    expect(projection).toContain("title: jobs.title");
    for (const excludedField of [
      "coverLetter",
      "customResume",
      "notes",
      "salaryMin",
      "applicationUrl",
      "sourceUrl",
    ]) {
      expect(projection).not.toContain(excludedField);
    }
  });
});
