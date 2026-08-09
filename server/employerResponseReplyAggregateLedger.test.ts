import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("employer-response reply aggregate ledger wiring", () => {
  it("uses an exact bounded owner-scoped latest-response anti-join", () => {
    const features = readFileSync(resolve(process.cwd(), "server/applicationFeatures.ts"), "utf8");
    const campaigns = readFileSync(resolve(process.cwd(), "server/applicationCampaigns.ts"), "utf8");
    const page = features.slice(
      features.indexOf("export async function getEmployerResponseReplyPage"),
      features.indexOf("async function getMemoryUpcomingInterviewContexts")
    );

    expect(page).toContain('eq(applications.userId, userId)');
    expect(page).toContain('inArray(applications.status, ["applied", "viewed", "interview"])');
    expect(page).toContain("later_response.received_at");
    expect(page).toContain("active_draft.source_response_id");
    expect(page).toContain("active_approval.status IN ('pending', 'approved')");
    expect(page).toContain("COUNT(*)");
    expect(page).toContain(".limit(limit)");
    expect(campaigns).toContain("getEmployerResponseReplyPage(userId, 5)");
    expect(campaigns).toContain("employerResponsesNeedingReply: employerResponseReplyPage.total");
    expect(campaigns).toContain("employerResponsesNeedingReply: employerResponseQueue.slice(0, 5)");
  });

  it("keeps the durable response link aligned with migration 0051", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle/schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0051_follow_up_response_link.sql"),
      "utf8"
    );

    expect(schema).toContain('sourceResponseId: int("source_response_id")');
    expect(schema).toContain("follow_ups_source_response_sent_idx");
    expect(migration).toContain("JSON_EXTRACT(`approval`.`payload`, '$.sourceResponseId')");
    expect(migration).toContain("follow_ups_source_response_id_employer_responses_id_fk");
    expect(migration).toContain("follow_ups_source_response_sent_idx");
  });
});
