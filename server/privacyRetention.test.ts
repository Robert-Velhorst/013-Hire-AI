import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { TrpcContext } from "./_core/context";
import { createAdminReviewItem } from "./db";
import {
  buildPrivacyErasurePreview,
  directPrivacyRetentionPolicy,
  privacyRetentionPolicyTables,
} from "./privacyRetention";
import { appRouter } from "./routers";

const expectedUserOwnedTables = [
  "users",
  "user_profiles",
  "social_media_profiles",
  "user_connector_accounts",
  "connector_authorizations",
  "applications",
  "application_decisions",
  "application_materials",
  "application_attempts",
  "employer_responses",
  "application_notifications",
  "audit_events",
  "admin_review_items",
  "application_approvals",
  "application_campaigns",
  "autonomous_run_states",
  "job_matches",
  "interview_preparation",
  "follow_ups",
  "inbox_response_candidates",
  "user_resumes",
  "saved_jobs",
  "application_notes",
  "interview_schedules",
  "work_experiences",
  "education_entries",
  "user_skills",
  "user_projects",
  "job_alerts",
  "success_fees",
  "employment_verifications",
  "fee_payments",
].sort();

function context(userId: number, role: "user" | "admin"): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `privacy-retention-${userId}`,
      name: "Privacy operator",
      email: `privacy-${userId}@example.local`,
      loginMethod: "test",
      role,
      stripeCustomerId: null,
      accountStatus: "active",
      tosAcceptedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("privacy retention inventory", () => {
  it("classifies every direct and application-linked user-owned table exactly once", () => {
    expect([...privacyRetentionPolicyTables].sort()).toEqual(expectedUserOwnedTables);
    expect(new Set(privacyRetentionPolicyTables).size).toBe(privacyRetentionPolicyTables.length);
  });

  it("fails when a new direct user-owned schema table is not added to the policy", () => {
    const schemaSource = readFileSync(new URL("../drizzle/schema.ts", import.meta.url), "utf8");
    const schemaTablesWithUserId = [...schemaSource.matchAll(
      /export const \w+ = mysqlTable\("([^"]+)", \{([\s\S]*?)\n\}\s*(?:,|\);)/g
    )]
      .filter((match) => /\buserId:\s/.test(match[2]))
      .map((match) => match[1])
      .sort();
    const policyTablesWithDirectOwnership = directPrivacyRetentionPolicy
      .filter((entry) => entry.table !== "users")
      .map((entry) => entry.table)
      .sort();

    expect(policyTablesWithDirectOwnership).toEqual(schemaTablesWithUserId);
  });

  it("classifies every known private object and provider grant", () => {
    expect(directPrivacyRetentionPolicy.flatMap((entry) => entry.privateObjectColumns ?? []).sort()).toEqual([
      "document_key",
      "file_key",
      "offer_letter_key",
      "resume_file_key",
      "screenshot_key",
    ]);
    expect(directPrivacyRetentionPolicy.filter((entry) => entry.providerRevocationRequired).map((entry) => entry.table).sort()).toEqual([
      "connector_authorizations",
      "user_connector_accounts",
    ]);
  });

  it("fails closed without a persistent database", async () => {
    await expect(buildPrivacyErasurePreview(99101)).resolves.toMatchObject({
      available: false,
      executionAllowed: false,
      items: [],
    });
  });

  it("exposes previews only to admins and only for privacy reviews", async () => {
    const user = appRouter.createCaller(context(99102, "user"));
    const admin = appRouter.createCaller(context(99103, "admin"));
    const request = await user.privacy.requestDeletion();

    await expect(user.admin.previewPrivacyErasure({ reviewItemId: request!.id })).rejects.toThrow();
    await expect(admin.admin.previewPrivacyErasure({ reviewItemId: request!.id })).resolves.toMatchObject({
      available: false,
      executionAllowed: false,
    });

    const unrelated = await createAdminReviewItem({
      userId: 99102,
      entityType: "application",
      entityId: 44,
      category: "application_review",
      title: "Unrelated application review",
    });
    await expect(admin.admin.previewPrivacyErasure({ reviewItemId: unrelated.insertId })).rejects.toThrow(
      "Erasure previews are available only for privacy deletion reviews."
    );
  });
});
