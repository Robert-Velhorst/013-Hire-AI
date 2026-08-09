import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("offer attribution aggregate ledger wiring", () => {
  it("uses an exact bounded owner-scoped review page", () => {
    const db = readFileSync(resolve(process.cwd(), "server/db.ts"), "utf8");
    const campaigns = readFileSync(resolve(process.cwd(), "server/applicationCampaigns.ts"), "utf8");
    const page = db.slice(
      db.indexOf("export async function getUserOfferAttributionReviewPage"),
      db.indexOf("export async function createSuccessFee")
    );

    expect(page).toContain("eq(applicationApprovals.userId, userId)");
    expect(page).toContain("eq(applications.userId, userId)");
    expect(page).toContain('eq(applicationApprovals.approvalType, "offer_attribution")');
    expect(page).toContain("COUNT(*)");
    expect(page).toContain(".limit(limit)");
    expect(campaigns).toContain("getUserOfferAttributionReviewPage(userId, 5)");
    expect(campaigns).toContain("pendingOfferAttributions: successFeeCompliance.pendingOfferAttributions");
    expect(campaigns).toContain("offerAttributionPage.total");
    expect(campaigns).toContain("offerAttributionPage.items");
  });

  it("keeps the operating index aligned with migration 0054", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle/schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0054_offer_attribution_operating_index.sql"),
      "utf8"
    );
    const indexName = "application_approvals_offer_attribution_operating_idx";

    expect(schema).toContain(indexName);
    expect(migration).toContain(indexName);
    expect(migration).toContain("`user_id`,`status`,`approval_type`,`created_at`,`id`,`application_id`");
  });
});
