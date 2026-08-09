import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("follow-up drafting aggregate ledger wiring", () => {
  it("uses an exact bounded owner-scoped drafting query with lifecycle holds", () => {
    const features = readFileSync(resolve(process.cwd(), "server/applicationFeatures.ts"), "utf8");
    const campaigns = readFileSync(resolve(process.cwd(), "server/applicationCampaigns.ts"), "utf8");
    const page = features.slice(
      features.indexOf("export async function getFollowUpDraftingPage"),
      features.indexOf("async function getMemoryUpcomingInterviewContexts")
    );

    expect(page).toContain('eq(applications.userId, userId)');
    expect(page).toContain("active_follow_up.sent_date IS NULL");
    expect(page).toContain("replyable_response.response_type IN ('employer_question', 'other')");
    expect(page).toContain("consumed_schedule.employer_response_id = invite.id");
    expect(page).toContain("NOT ${hasCancelledInterviewSchedule}");
    expect(page).toContain("outcome_response.interview_id = completed_interview.id");
    expect(page).toContain("COUNT(*)");
    expect(page).toContain("candidateTotal");
    expect(page).toContain("blockedTotal");
    expect(page).toContain(".limit(limit)");
    expect(campaigns).toContain("getFollowUpDraftingPage(userId, 5, now)");
    expect(campaigns).toContain("followUpsDue: followUpDraftingPage.candidateTotal");
    expect(campaigns).toContain("followUpsBlocked: followUpDraftingPage.blockedTotal");
    const ledger = campaigns.slice(campaigns.indexOf("export async function getUserOperatingLedger"));
    expect(ledger).not.toContain("loadOperatingApplicationEvidence(applications, userId)");
    expect(ledger).not.toContain("getAutonomousFollowUpReadiness({");
    expect(ledger).toContain("getUserOperatingApplicationApprovals(\n    userId,\n    [],\n    5");
  });

  it("keeps the active-draft lookup index aligned with migration 0053", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle/schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0053_follow_up_drafting_operating_index.sql"),
      "utf8"
    );
    const indexName = "follow_ups_application_sent_id_idx";

    expect(schema).toContain(indexName);
    expect(migration).toContain(indexName);
    expect(migration).toContain("`application_id`,`sent_date`,`id`");
  });
});
