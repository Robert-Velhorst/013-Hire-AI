import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("interview-outcome aggregate ledger wiring", () => {
  it("uses an exact bounded owner-scoped anti-join", () => {
    const features = readFileSync(resolve(process.cwd(), "server/applicationFeatures.ts"), "utf8");
    const campaigns = readFileSync(resolve(process.cwd(), "server/applicationCampaigns.ts"), "utf8");
    const outcomePage = features.slice(
      features.indexOf("export async function getInterviewOutcomePage"),
      features.indexOf("async function getMemoryUpcomingInterviewContexts")
    );

    expect(outcomePage).toContain('eq(applications.userId, userId)');
    expect(outcomePage).toContain('eq(interviewSchedules.status, "completed")');
    expect(outcomePage).toContain("NOT EXISTS");
    expect(outcomePage).toContain("employer_responses.interview_id");
    expect(outcomePage).toContain("COUNT(*)");
    expect(outcomePage).toContain(".limit(limit)");
    expect(campaigns).toContain("getInterviewOutcomePage(userId, 5)");
    expect(campaigns).toContain("interviewOutcomesNeeded: interviewOutcomePage.total");
    expect(campaigns).toContain("interviewOutcomesNeeded: interviewOutcomePage.items");
  });

  it("keeps the outcome query indexes aligned with migration 0049", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle/schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0049_interview_outcome_operating_indexes.sql"),
      "utf8"
    );

    for (const indexName of [
      "employer_responses_user_interview_idx",
      "interview_schedules_status_updated_id_idx",
    ]) {
      expect(schema).toContain(indexName);
      expect(migration).toContain(indexName);
    }
  });
});
