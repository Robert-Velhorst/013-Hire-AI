import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("interview-scheduling aggregate ledger wiring", () => {
  it("uses an exact bounded owner-scoped scheduling query", () => {
    const features = readFileSync(resolve(process.cwd(), "server/applicationFeatures.ts"), "utf8");
    const campaigns = readFileSync(resolve(process.cwd(), "server/applicationCampaigns.ts"), "utf8");
    const page = features.slice(
      features.indexOf("export async function getInterviewSchedulingPage"),
      features.indexOf("async function getMemoryUpcomingInterviewContexts")
    );

    expect(page).toContain('eq(applications.userId, userId)');
    expect(page).toContain('eq(applications.status, "interview")');
    expect(page).toContain("later_invite.received_at > invite.received_at");
    expect(page).toContain("consumed_schedule.employer_response_id = invite.id");
    expect(page).toContain("COUNT(*)");
    expect(page).toContain(".limit(limit)");
    expect(campaigns).toContain("getInterviewSchedulingPage(userId, 5)");
    expect(campaigns).toContain("interviewSchedulingNeeded: interviewSchedulingPage.total");
    expect(campaigns).toContain("interviewScheduling: interviewSchedulingPage.items");
  });

  it("keeps scheduling query indexes aligned with migration 0050", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle/schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0050_interview_scheduling_operating_indexes.sql"),
      "utf8"
    );

    for (const indexName of [
      "employer_responses_application_type_received_id_idx",
      "interview_schedules_application_status_created_response_idx",
    ]) {
      expect(schema).toContain(indexName);
      expect(migration).toContain(indexName);
    }
  });
});
