import { and, eq } from "drizzle-orm";
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminReviewItems,
  applicationApprovals,
} from "../drizzle/schema";
import {
  createAdminReviewItem,
  createApplicationApproval,
  getDb,
  resolveAdminReviewItem,
  resolveApplicationApproval,
} from "./db";

const runIntegration = process.env.HIRE_AI_DATABASE_ACCEPTANCE === "true";
const userId = 1_781_013_081;
const adminId = 1_781_013_082;
const adminFixtureBackfill = `UPDATE hire_ai_active_review_backfill_fixture AS older
      JOIN hire_ai_active_review_backfill_fixture AS newer
        ON newer.user_id = older.user_id
        AND newer.entity_type = older.entity_type
        AND newer.entity_id = older.entity_id
        AND newer.category = older.category
        AND newer.status IN ('open', 'in_progress')
        AND (newer.updated_at > older.updated_at OR (newer.updated_at = older.updated_at AND newer.id > older.id))
      SET older.status = 'dismissed', older.resolved_at = COALESCE(older.resolved_at, CURRENT_TIMESTAMP),
        older.resolution = COALESCE(older.resolution, 'Duplicate active review superseded during migration; historical record retained.')
      WHERE older.status IN ('open', 'in_progress')`;
const approvalFixtureBackfill = `UPDATE hire_ai_active_approval_backfill_fixture AS older
      JOIN hire_ai_active_approval_backfill_fixture AS newer
        ON newer.user_id = older.user_id
        AND newer.entity_type = older.entity_type
        AND newer.entity_id = older.entity_id
        AND newer.approval_type = older.approval_type
        AND newer.status = 'pending'
        AND (newer.updated_at > older.updated_at OR (newer.updated_at = older.updated_at AND newer.id > older.id))
      SET older.status = 'cancelled', older.decided_at = COALESCE(older.decided_at, CURRENT_TIMESTAMP),
        older.decision_note = COALESCE(older.decision_note, 'Duplicate pending approval superseded during migration; historical record retained.')
      WHERE older.status = 'pending'`;
const normalizeBackfillSql = (statement: string) =>
  statement
    .replaceAll("`", "")
    .replaceAll("hire_ai_active_review_backfill_fixture", "admin_review_items")
    .replaceAll("hire_ai_active_approval_backfill_fixture", "application_approvals")
    .replace(/\s+/g, " ")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)\s*/g, ")")
    .trim()
    .replace(/;$/, "");

describe("active identity migration backfill SQL", () => {
  it("keeps fixture statements aligned with the migration", () => {
    const migration = readFileSync(resolve(process.cwd(), "drizzle", "0081_mighty_oracle.sql"), "utf8");
    const statements = migration.split("--> statement-breakpoint");
    const adminBackfill = statements.find(statement =>
      statement.trimStart().startsWith("UPDATE `admin_review_items` AS older")
    );
    const approvalBackfill = statements.find(statement =>
      statement.trimStart().startsWith("UPDATE `application_approvals` AS older")
    );

    expect(adminBackfill).toBeDefined();
    expect(approvalBackfill).toBeDefined();
    expect(normalizeBackfillSql(adminBackfill!)).toBe(normalizeBackfillSql(adminFixtureBackfill));
    expect(normalizeBackfillSql(approvalBackfill!)).toBe(normalizeBackfillSql(approvalFixtureBackfill));
  });
});

describe.skipIf(!runIntegration)("active approval and review identities on MySQL", () => {
  let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;

  beforeAll(async () => {
    const connection = await getDb();
    if (!connection) throw new Error("Integration DATABASE_URL is required.");
    db = connection;
  }, 30_000);

  afterAll(async () => {
    if (!db) return;
    await db.delete(applicationApprovals).where(eq(applicationApprovals.userId, userId));
    await db.delete(adminReviewItems).where(eq(adminReviewItems.userId, userId));
  }, 30_000);

  it("deduplicates concurrent requests for every approval type and permits a later cycle", async () => {
    const approvalTypes = [
      "application_submission",
      "follow_up_send",
      "offer_attribution",
      "interview_schedule",
      "profile_claim",
      "billing_action",
    ] as const;

    for (const [index, approvalType] of approvalTypes.entries()) {
      const entityId = userId + index;
      const results = await Promise.all(Array.from({ length: 12 }, (_, caller) =>
        createApplicationApproval({
          userId,
          applicationId: null,
          entityType: "application",
          entityId,
          approvalType,
          status: "pending",
          title: `Approval request ${caller}`,
        })
      ));
      const ids = new Set(results.map(result => Number(result.insertId)));
      expect(ids.size, approvalType).toBe(1);

      const pending = await db.select().from(applicationApprovals).where(and(
        eq(applicationApprovals.userId, userId),
        eq(applicationApprovals.entityId, entityId),
        eq(applicationApprovals.approvalType, approvalType),
        eq(applicationApprovals.status, "pending")
      ));
      expect(pending, approvalType).toHaveLength(1);

      const [approvalId] = ids;
      await resolveApplicationApproval(approvalId!, userId, "cancelled", "Integration cycle complete.", "admin");
      const reopened = await createApplicationApproval({
        userId,
        applicationId: null,
        entityType: "application",
        entityId,
        approvalType,
        status: "pending",
        title: "Later approval cycle",
      });
      expect(Number(reopened.insertId)).not.toBe(approvalId);
      expect(reopened.existing).toBe(false);
    }
  }, 60_000);

  it("deduplicates concurrent requests for every review category and permits a later cycle", async () => {
    const categories = [
      "application_review",
      "submission_evidence",
      "employer_response",
      "offer_attribution",
      "verification_overdue",
      "payment_failed",
      "legal_escalation",
      "employment_ended",
      "privacy_deletion",
    ] as const;

    for (const [index, category] of categories.entries()) {
      const entityId = userId + index;
      const results = await Promise.all(Array.from({ length: 4 }, (_, caller) =>
        createAdminReviewItem({
          userId,
          entityType: "user",
          entityId,
          category,
          status: "in_progress",
          title: `Review request ${caller}`,
        })
      ));
      const ids = new Set(results.map(result => Number(result.insertId)));
      expect(ids.size, category).toBe(1);

      const active = await db.select().from(adminReviewItems).where(and(
        eq(adminReviewItems.userId, userId),
        eq(adminReviewItems.entityId, entityId),
        eq(adminReviewItems.category, category),
        eq(adminReviewItems.status, "in_progress")
      ));
      expect(active, category).toHaveLength(1);

      const [reviewId] = ids;
      await resolveAdminReviewItem(reviewId!, adminId, "dismissed", "Integration cycle complete.");
      const reopened = await createAdminReviewItem({
        userId,
        entityType: "user",
        entityId,
        category,
        status: "open",
        title: "Later review cycle",
      });
      expect(Number(reopened.insertId)).not.toBe(reviewId);
      expect(reopened.existing).toBe(false);
    }
  }, 60_000);

  it("preserves the migration's deterministic duplicate cleanup for legacy rows", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("Integration DATABASE_URL is required.");
    const connection = await mysql.createConnection(databaseUrl);

    try {
      await connection.query("DROP TABLE IF EXISTS hire_ai_active_review_backfill_fixture");
      await connection.query("DROP TABLE IF EXISTS hire_ai_active_approval_backfill_fixture");
      await connection.query(`CREATE TABLE hire_ai_active_review_backfill_fixture (
        id INT NOT NULL PRIMARY KEY,
        user_id INT NOT NULL,
        entity_type VARCHAR(32) NOT NULL,
        entity_id INT NOT NULL,
        category VARCHAR(32) NOT NULL,
        status VARCHAR(32) NOT NULL,
        updated_at TIMESTAMP NOT NULL,
        resolved_at TIMESTAMP NULL,
        resolution TEXT NULL
      )`);
      await connection.query(`CREATE TABLE hire_ai_active_approval_backfill_fixture (
        id INT NOT NULL PRIMARY KEY,
        user_id INT NOT NULL,
        entity_type VARCHAR(32) NOT NULL,
        entity_id INT NOT NULL,
        approval_type VARCHAR(32) NOT NULL,
        status VARCHAR(32) NOT NULL,
        updated_at TIMESTAMP NOT NULL,
        decided_at TIMESTAMP NULL,
        decision_note TEXT NULL
      )`);
      await connection.execute(
        `INSERT INTO hire_ai_active_review_backfill_fixture VALUES
          (1, 10, 'user', 20, 'legal_escalation', 'open', '2026-01-01 00:00:00', NULL, NULL),
          (2, 10, 'user', 20, 'legal_escalation', 'in_progress', '2026-01-02 00:00:00', NULL, NULL),
          (3, 10, 'user', 21, 'legal_escalation', 'open', '2026-01-01 00:00:00', NULL, NULL)`
      );
      await connection.execute(
        `INSERT INTO hire_ai_active_approval_backfill_fixture VALUES
          (1, 10, 'application', 20, 'application_submission', 'pending', '2026-01-01 00:00:00', NULL, NULL),
          (2, 10, 'application', 20, 'application_submission', 'pending', '2026-01-02 00:00:00', NULL, NULL),
          (3, 10, 'application', 21, 'application_submission', 'pending', '2026-01-01 00:00:00', NULL, NULL)`
      );

      await connection.query(adminFixtureBackfill);
      await connection.query(approvalFixtureBackfill);

      const [reviews] = await connection.query<Array<{ id: number; status: string; resolution: string | null }>>(
        "SELECT id, status, resolution FROM hire_ai_active_review_backfill_fixture ORDER BY id"
      );
      const [approvals] = await connection.query<Array<{ id: number; status: string; decision_note: string | null }>>(
        "SELECT id, status, decision_note FROM hire_ai_active_approval_backfill_fixture ORDER BY id"
      );
      expect(reviews.map(row => row.status)).toEqual(["dismissed", "in_progress", "open"]);
      expect(reviews[0]?.resolution).toContain("historical record retained");
      expect(approvals.map(row => row.status)).toEqual(["cancelled", "pending", "pending"]);
      expect(approvals[0]?.decision_note).toContain("historical record retained");
    } finally {
      await connection.query("DROP TABLE IF EXISTS hire_ai_active_review_backfill_fixture");
      await connection.query("DROP TABLE IF EXISTS hire_ai_active_approval_backfill_fixture");
      await connection.end();
    }
  }, 60_000);
});
