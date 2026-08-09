import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("review queue aggregate ledger wiring", () => {
  it("hydrates five records while retaining exact owner-scoped totals", () => {
    const db = readFileSync(resolve(process.cwd(), "server/db.ts"), "utf8");
    const campaigns = readFileSync(resolve(process.cwd(), "server/applicationCampaigns.ts"), "utf8");
    const decisions = db.slice(
      db.indexOf("export async function getUserReviewDecisionPage"),
      db.indexOf("export async function createApplicationMaterial")
    );
    const adminReviews = db.slice(
      db.indexOf("export async function getUserAdminReviewPage"),
      db.indexOf("export async function getUnreadInterviewNotificationPage")
    );

    expect(decisions).toContain("eq(applicationDecisions.userId, userId)");
    expect(decisions).toContain("COUNT(*)");
    expect(decisions).toContain(".limit(limit + 1)");
    expect(adminReviews).toContain("eq(adminReviewItems.userId, userId)");
    expect(adminReviews).toContain("COUNT(*)");
    expect(adminReviews).toContain(".limit(limit)");
    expect(campaigns).toContain("getUserReviewDecisionPage(userId, 5)");
    expect(campaigns).toContain('getUserAdminReviewPage(userId, ["open", "in_progress"], 5)');
    expect(campaigns).toContain("reviewDecisionPage.total");
    expect(campaigns).toContain("reviewDecisionScope");
  });

  it("keeps both operating indexes aligned with migration 0055", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle/schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0055_review_queue_operating_indexes.sql"),
      "utf8"
    );

    for (const indexName of [
      "application_decisions_user_review_updated_idx",
      "admin_review_items_user_status_created_idx",
    ]) {
      expect(schema).toContain(indexName);
      expect(migration).toContain(indexName);
    }
    expect(migration).toContain("`user_id`,`review_required`,`updated_at`,`id`");
    expect(migration).toContain("`user_id`,`status`,`created_at`,`id`");
  });
});
