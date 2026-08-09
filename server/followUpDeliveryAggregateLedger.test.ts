import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("follow-up delivery aggregate ledger wiring", () => {
  it("uses exact bounded owner-scoped delivery queues", () => {
    const features = readFileSync(resolve(process.cwd(), "server/applicationFeatures.ts"), "utf8");
    const campaigns = readFileSync(resolve(process.cwd(), "server/applicationCampaigns.ts"), "utf8");
    const queues = features.slice(
      features.indexOf("export async function getFollowUpDeliveryOperatingQueues"),
      features.indexOf("async function getMemoryUpcomingInterviewContexts")
    );

    expect(queues).toContain('eq(applications.userId, userId)');
    expect(queues).toContain('eq(applicationApprovals.status, "approved")');
    expect(queues).toContain("later_approval.id");
    expect(queues).toContain("SUM(CASE WHEN");
    expect(queues).toContain(".limit(limit)");
    expect(campaigns).toContain("getFollowUpDeliveryOperatingQueues(userId, 5)");
    expect(campaigns).toContain("approvedFollowUpsReadyToSend: followUpDeliveryQueues.ready.total");
    expect(campaigns).toContain("followUpDeliveryReconciliation: followUpDeliveryQueues.reconciliation.total");
  });

  it("keeps the delivery operating index aligned with migration 0052", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle/schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0052_follow_up_delivery_operating_index.sql"),
      "utf8"
    );
    const indexName = "application_approvals_delivery_operating_idx";

    expect(schema).toContain(indexName);
    expect(migration).toContain(indexName);
    expect(migration).toContain("`user_id`,`status`,`approval_type`,`entity_type`,`entity_id`,`decided_at`,`id`");
  });
});
