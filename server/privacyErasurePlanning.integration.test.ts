import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  adminReviewItems,
  applicationAttempts,
  applicationMaterials,
  applications,
  connectorAuthorizations,
  followUps,
  jobPlatforms,
  jobs,
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
import {
  finalizePrivacyErasure,
  privacyDatabaseErasureConfirmation,
} from "./privacyErasureFinalization";

const runIntegration = process.env.PRIVACY_ERASURE_INTEGRATION === "true";

describe.skipIf(!runIntegration)("privacy erasure planning on MySQL", () => {
  const userId = 1_780_900_001;
  const adminId = 1_780_900_002;
  let reviewItemId = 0;
  let applicationId = 0;
  let jobId = 0;
  let platformId = 0;
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
    const platform = await db.insert(jobPlatforms).values({
      name: `Privacy integration ${userId}`,
      url: "https://jobs.example.test",
      tier: "tier4",
    });
    platformId = Number(platform[0].insertId);
    const job = await db.insert(jobs).values({
      title: "Privacy Integration Role",
      company: "Integration Employer",
      platformId,
    });
    jobId = Number(job[0].insertId);
    const application = await db.insert(applications).values({
      userId,
      jobId,
      coverLetter: "Sensitive cover letter",
      customResume: "Sensitive custom resume",
      notes: "Sensitive application notes",
    });
    applicationId = Number(application[0].insertId);
    await db.insert(applicationMaterials).values({
      applicationId,
      coverLetter: "Sensitive generated material",
    });
    await db.insert(applicationAttempts).values({
      applicationId,
      userId,
      jobId,
      confirmationText: "Sensitive confirmation",
      confirmationUrl: "https://private.example.test/confirmation",
      screenshotKey: `attempts/${userId}/private.png`,
    });
    await db.insert(followUps).values({
      applicationId,
      message: "Sensitive follow-up",
      deliveryRecipient: "person@example.test",
      deliverySubject: "Sensitive subject",
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
    await db
      .delete(followUps)
      .where(eq(followUps.applicationId, applicationId));
    await db
      .delete(applicationMaterials)
      .where(eq(applicationMaterials.applicationId, applicationId));
    await db
      .delete(applicationAttempts)
      .where(eq(applicationAttempts.applicationId, applicationId));
    await db.delete(applications).where(eq(applications.id, applicationId));
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db.delete(jobPlatforms).where(eq(jobPlatforms.id, platformId));
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
    expect(deletedObjects).toHaveLength(2);
    expect(deletedObjects).toEqual(
      expect.arrayContaining([
        `resumes/${userId}/private-resume.pdf`,
        `attempts/${userId}/private.png`,
      ])
    );
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

    const databaseConfirmation = privacyDatabaseErasureConfirmation(
      userId,
      first.run.policyVersion
    );
    await expect(
      finalizePrivacyErasure(first.run.id, databaseConfirmation, {
        beforeCommit: async () => {
          throw new Error("injected_transaction_failure");
        },
      })
    ).rejects.toThrow("injected_transaction_failure");
    expect(
      (
        await db
          .select()
          .from(userProfiles)
          .where(eq(userProfiles.userId, userId))
      ).length
    ).toBe(1);
    expect(
      (
        await db
          .select()
          .from(privacyErasureRuns)
          .where(eq(privacyErasureRuns.id, first.run.id))
      )[0].status
    ).toBe("ready_for_database");

    await db
      .update(privacyErasureRuns)
      .set({
        status: "database_in_progress",
        executionLeaseId: "active-database-worker",
        executionLeaseExpiresAt: new Date(Date.now() + 60_000),
      })
      .where(eq(privacyErasureRuns.id, first.run.id));
    await expect(
      finalizePrivacyErasure(first.run.id, databaseConfirmation)
    ).rejects.toThrow("Another database erasure worker");
    await db
      .update(privacyErasureRuns)
      .set({ executionLeaseExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(privacyErasureRuns.id, first.run.id));

    const finalized = await finalizePrivacyErasure(
      first.run.id,
      databaseConfirmation
    );
    expect(finalized.existing).toBe(false);
    expect(
      await finalizePrivacyErasure(first.run.id, databaseConfirmation)
    ).toMatchObject({ success: true, existing: true });
    expect(
      await db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(applicationMaterials)
        .where(eq(applicationMaterials.applicationId, applicationId))
    ).toHaveLength(0);
    const retainedApplication = (
      await db
        .select()
        .from(applications)
        .where(eq(applications.id, applicationId))
    )[0];
    expect(retainedApplication).toMatchObject({
      coverLetter: null,
      customResume: null,
      notes: null,
    });
    const retainedFollowUp = (
      await db
        .select()
        .from(followUps)
        .where(eq(followUps.applicationId, applicationId))
    )[0];
    expect(retainedFollowUp).toMatchObject({
      message: null,
      deliveryRecipient: null,
      deliverySubject: null,
    });
    const retainedFee = (
      await db.select().from(successFees).where(eq(successFees.userId, userId))
    )[0];
    expect(retainedFee.offerLetterKey).toBe(
      `offers/${userId}/retained-offer.pdf`
    );
    const erasedUser = (
      await db.select().from(users).where(eq(users.id, userId))
    )[0];
    expect(erasedUser).toMatchObject({
      name: null,
      email: null,
      loginMethod: null,
      stripeCustomerId: null,
      accountStatus: "suspended",
    });
    expect(erasedUser.openId).toMatch(/^erased-/);
  });
});
