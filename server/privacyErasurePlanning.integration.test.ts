import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  adminReviewItems,
  connectorAuthorizations,
  privacyErasureRuns,
  privacyErasureTasks,
  successFees,
  userProfiles,
  users,
} from "../drizzle/schema";
import { getDb } from "./db";
import { planPrivacyErasure } from "./privacyErasurePlanning";
import {
  confirmManualPrivacyCleanup,
  executePrivacyErasureCleanup,
  privacyErasureConfirmation,
} from "./privacyErasureExecution";

const runIntegration = process.env.PRIVACY_ERASURE_INTEGRATION === "true";

describe.skipIf(!runIntegration)("privacy erasure planning on MySQL", () => {
  const userId = 1_780_900_001;
  const adminId = 1_780_900_002;
  let reviewItemId = 0;
  let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;

  beforeAll(async () => {
    const connection = await getDb();
    if (!connection) throw new Error("Integration DATABASE_URL is required.");
    db = connection;
    await db.insert(users).values({
      id: userId,
      openId: `privacy-plan-${userId}`,
      name: "Sensitive Candidate Name",
      email: "privacy-plan@example.test",
      accountStatus: "suspended",
    });
    await db.insert(userProfiles).values({
      userId,
      skills: "Sensitive profile content",
      resumeFileKey: `resumes/${userId}/private-resume.pdf`,
    });
    await db.insert(connectorAuthorizations).values({
      userId,
      provider: "dropbox",
      encryptedAccessToken: "encrypted-provider-secret",
    });
    await db.insert(successFees).values({
      userId,
      employerName: "Retention Employer",
      jobTitle: "Retained Job",
      monthlySalary: 10_000,
      monthlyFeeAmount: 500,
      startDate: new Date("2026-01-01T00:00:00Z"),
      offerLetterKey: `offers/${userId}/retained-offer.pdf`,
    });
    const review = await db.insert(adminReviewItems).values({
      userId,
      entityType: "user",
      entityId: userId,
      category: "privacy_deletion",
      status: "resolved",
      priority: "critical",
      title: "Integration erasure review",
      resolution: "Retention policy approved for integration verification.",
      resolvedBy: adminId,
      resolvedAt: new Date(),
    });
    reviewItemId = Number(review[0].insertId);
  });

  afterAll(async () => {
    if (!db) return;
    const runs = await db
      .select({ id: privacyErasureRuns.id })
      .from(privacyErasureRuns)
      .where(eq(privacyErasureRuns.reviewItemId, reviewItemId));
    for (const run of runs) {
      await db
        .delete(privacyErasureTasks)
        .where(eq(privacyErasureTasks.runId, run.id));
    }
    await db
      .delete(privacyErasureRuns)
      .where(eq(privacyErasureRuns.reviewItemId, reviewItemId));
    await db
      .delete(adminReviewItems)
      .where(eq(adminReviewItems.id, reviewItemId));
    await db
      .delete(connectorAuthorizations)
      .where(eq(connectorAuthorizations.userId, userId));
    await db.delete(userProfiles).where(eq(userProfiles.userId, userId));
    await db.delete(successFees).where(eq(successFees.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it("creates one restart-safe plan without copying secrets or object keys", async () => {
    const first = await planPrivacyErasure(reviewItemId, adminId);
    const second = await planPrivacyErasure(reviewItemId, adminId);

    expect(first.existing).toBe(false);
    expect(second.existing).toBe(true);
    expect(second.run.id).toBe(first.run.id);
    const tasks = await db
      .select()
      .from(privacyErasureTasks)
      .where(
        and(
          eq(privacyErasureTasks.runId, first.run.id),
          eq(privacyErasureTasks.userId, userId)
        )
      );
    expect(tasks.map(task => task.kind)).toEqual(
      expect.arrayContaining([
        "provider_revoke",
        "private_object_delete",
        "retention_hold",
        "database_finalize",
      ])
    );
    expect(JSON.stringify({ run: first.run, tasks })).not.toContain(
      "encrypted-provider-secret"
    );
    expect(JSON.stringify({ run: first.run, tasks })).not.toContain(
      "private-resume.pdf"
    );
    expect(JSON.stringify({ run: first.run, tasks })).not.toContain(
      "retained-offer.pdf"
    );

    await expect(
      executePrivacyErasureCleanup(first.run.id, "incorrect confirmation", {
        disconnect: vi.fn() as any,
        deleteObject: vi.fn() as any,
      })
    ).rejects.toThrow("confirmation text does not match");

    await db
      .update(privacyErasureRuns)
      .set({
        executionLeaseId: "another-worker",
        executionLeaseExpiresAt: new Date(Date.now() + 60_000),
      })
      .where(eq(privacyErasureRuns.id, first.run.id));
    await expect(
      executePrivacyErasureCleanup(
        first.run.id,
        privacyErasureConfirmation(userId, first.run.policyVersion),
        {
          disconnect: vi.fn() as any,
          deleteObject: vi.fn() as any,
        }
      )
    ).rejects.toThrow("Another erasure cleanup worker");
    await db
      .update(privacyErasureRuns)
      .set({ executionLeaseId: null, executionLeaseExpiresAt: null })
      .where(eq(privacyErasureRuns.id, first.run.id));

    const deletedObjects: string[] = [];
    const cleanup = await executePrivacyErasureCleanup(
      first.run.id,
      privacyErasureConfirmation(userId, first.run.policyVersion),
      {
        disconnect: vi.fn(async () => ({
          account: { status: "disabled" },
          providerRevocation: {
            status: "manual_required" as const,
            detail: "Remove the provider grant manually.",
          },
        })) as any,
        deleteObject: vi.fn(async (key: string) => {
          deletedObjects.push(key);
          return { key };
        }),
      }
    );
    expect(cleanup.status).toBe("manual_action_required");
    expect(deletedObjects).toEqual([`resumes/${userId}/private-resume.pdf`]);
    const manualTask = cleanup.tasks.find(
      task => task.kind === "provider_revoke" && task.status === "blocked"
    );
    expect(manualTask).toBeDefined();

    await confirmManualPrivacyCleanup(
      first.run.id,
      manualTask!.id,
      "Provider account permissions were removed and independently verified."
    );
    const readyRun = (
      await db
        .select()
        .from(privacyErasureRuns)
        .where(eq(privacyErasureRuns.id, first.run.id))
        .limit(1)
    )[0];
    expect(readyRun.status).toBe("ready_for_database");
  });
});
