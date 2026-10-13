import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  adminReviewItems,
  auditEvents,
  connectorAuthorizations,
  connectorRevocationObligations,
  privacyErasureRuns,
  privacyErasureTasks,
  userConnectorAccounts,
  users,
} from "../drizzle/schema";
import { getDb } from "./db";
import { disconnectConnectorAccess } from "./connectorDisconnect";
import * as connectorOAuth from "./connectorOAuth";
import { listOpenConnectorRevocationObligations } from "./connectorRevocationObligations";
import { planPrivacyErasure } from "./privacyErasurePlanning";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";
import {
  finalizePrivacyErasure,
  privacyDatabaseErasureConfirmation,
} from "./privacyErasureFinalization";

const runIntegration = process.env.CONNECTOR_REVOCATION_INTEGRATION === "true";

function context(id: number): TrpcContext {
  return {
    user: {
      id,
      openId: `connector-revoke-${id}`,
      name: "Revocation Fixture",
      email: `revoke-${id}@example.test`,
      loginMethod: "test",
      role: "user",
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

describe.skipIf(!runIntegration)("connector revocation obligations on MySQL", () => {
  const userId = 1_781_100_000 + (process.pid % 800_000);
  const otherUserId = userId + 1;
  const adminId = userId + 2;
  const openId = `connector-revoke-${userId}`;
  let reviewItemId = 0;
  let runId = 0;
  let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;

  beforeAll(async () => {
    const connection = await getDb();
    if (!connection) throw new Error("Integration DATABASE_URL is required.");
    db = connection;
    vi.spyOn(connectorOAuth, "decryptConnectorToken").mockReturnValue("decrypted-fixture-token");
    await db.insert(users).values([
      { id: userId, openId, name: "Revocation Fixture", email: `revoke-${userId}@example.test` },
      { id: otherUserId, openId: `${openId}-other`, name: "Other Fixture", email: `revoke-${otherUserId}@example.test` },
    ]);
    await db.insert(userConnectorAccounts).values({
      userId,
      provider: "linkedin",
      status: "connected",
    });
    await db.insert(connectorAuthorizations).values({
      userId,
      provider: "linkedin",
      encryptedAccessToken: "must-not-be-copied-to-obligation",
    });
  });

  afterAll(async () => {
    if (!db) return;
    if (runId) {
      await db.delete(privacyErasureTasks).where(eq(privacyErasureTasks.runId, runId));
      await db.delete(privacyErasureRuns).where(eq(privacyErasureRuns.id, runId));
    }
    if (reviewItemId) await db.delete(adminReviewItems).where(eq(adminReviewItems.id, reviewItemId));
    await db.delete(auditEvents).where(eq(auditEvents.userId, userId));
    await db.delete(connectorRevocationObligations).where(eq(connectorRevocationObligations.userId, userId));
    await db.delete(connectorRevocationObligations).where(eq(connectorRevocationObligations.userId, otherUserId));
    await db.delete(connectorAuthorizations).where(eq(connectorAuthorizations.userId, userId));
    await db.delete(connectorAuthorizations).where(eq(connectorAuthorizations.userId, otherUserId));
    await db.delete(userConnectorAccounts).where(eq(userConnectorAccounts.userId, userId));
    await db.delete(userConnectorAccounts).where(eq(userConnectorAccounts.userId, otherUserId));
    await db.delete(users).where(and(eq(users.id, userId), eq(users.openId, openId)));
    await db.delete(users).where(eq(users.id, otherUserId));
    vi.restoreAllMocks();
  });

  it("retains manual cleanup after local credential removal and blocks erasure until attested", async () => {
    const disconnected = await disconnectConnectorAccess(userId, "linkedin", async () => ({
      status: "manual_required",
      detail: "Manual permission removal is required.",
    }));
    expect(disconnected.account.status).toBe("disabled");
    expect(disconnected.providerRevocation.status).toBe("manual_required");
    expect(await db.select().from(connectorAuthorizations).where(eq(connectorAuthorizations.userId, userId))).toHaveLength(0);

    const [obligation] = await db.select().from(connectorRevocationObligations)
      .where(eq(connectorRevocationObligations.userId, userId));
    expect(obligation).toMatchObject({
      provider: "linkedin",
      status: "manual_required",
      completionEvidence: null,
    });
    expect(JSON.stringify(obligation)).not.toContain("must-not-be-copied-to-obligation");
    expect(await listOpenConnectorRevocationObligations(otherUserId)).toEqual([]);
    const otherUser = appRouter.createCaller(context(otherUserId));
    await expect(otherUser.privacy.confirmConnectorRevocation({
      obligationId: obligation.id,
      confirmed: true,
    })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const repeated = await disconnectConnectorAccess(userId, "linkedin");
    expect(repeated.providerRevocation.status).toBe("manual_required");

    const review = await db.insert(adminReviewItems).values({
      userId,
      entityType: "user",
      entityId: userId,
      category: "privacy_deletion",
      status: "resolved",
      priority: "critical",
      title: "Revocation integration review",
      resolution: "Synthetic policy approval.",
      resolvedBy: adminId,
      resolvedAt: new Date(),
    });
    reviewItemId = Number(review[0].insertId);
    const plan = await planPrivacyErasure(reviewItemId, adminId);
    runId = plan.run.id;
    const providerTask = plan.tasks.find(task => task.kind === "provider_revoke");
    expect(providerTask).toMatchObject({
      sourceTable: "connector_revocation_obligations",
      sourceRecordId: obligation.id,
      status: "blocked",
    });

    await db.update(privacyErasureRuns).set({ status: "ready_for_database" })
      .where(eq(privacyErasureRuns.id, runId));
    await db.update(privacyErasureTasks).set({ status: "completed" })
      .where(eq(privacyErasureTasks.id, providerTask!.id));
    await expect(finalizePrivacyErasure(
      runId,
      privacyDatabaseErasureConfirmation(userId, plan.run.policyVersion)
    )).rejects.toThrow("Provider revocation obligations must be completed");

    await db.update(privacyErasureRuns).set({ status: "manual_action_required" })
      .where(eq(privacyErasureRuns.id, runId));
    await db.update(privacyErasureTasks).set({ status: "blocked" })
      .where(eq(privacyErasureTasks.id, providerTask!.id));
    const owner = appRouter.createCaller(context(userId));
    await expect(owner.privacy.confirmConnectorRevocation({
      obligationId: obligation.id,
      confirmed: true,
    })).resolves.toMatchObject({ success: true });
    expect(await db.select().from(privacyErasureTasks).where(and(
      eq(privacyErasureTasks.id, providerTask!.id),
      eq(privacyErasureTasks.status, "completed")
    ))).toHaveLength(1);
    expect(await db.select().from(privacyErasureRuns).where(and(
      eq(privacyErasureRuns.id, runId),
      eq(privacyErasureRuns.status, "ready_for_database")
    ))).toHaveLength(1);
  });

  it("keeps failed provider revocation retryable and resolves it on API confirmation", async () => {
    await db.insert(userConnectorAccounts).values({
      userId: otherUserId,
      provider: "dropbox",
      status: "connected",
    });
    await db.insert(connectorAuthorizations).values({
      userId: otherUserId,
      provider: "dropbox",
      encryptedAccessToken: "retry-only-encrypted-token",
    });

    const failed = await disconnectConnectorAccess(otherUserId, "dropbox", async () => {
      throw new Error("provider response included private transport details");
    });
    expect(failed.providerRevocation.status).toBe("failed");
    expect(await db.select().from(connectorAuthorizations).where(eq(connectorAuthorizations.userId, otherUserId))).toHaveLength(1);
    const [open] = await db.select().from(connectorRevocationObligations)
      .where(eq(connectorRevocationObligations.userId, otherUserId));
    expect(open).toMatchObject({ status: "retry_required", lastErrorCode: "provider_rejected" });
    expect(JSON.stringify(open)).not.toContain("private transport details");

    const retried = await disconnectConnectorAccess(otherUserId, "dropbox", async () => ({
      status: "revoked",
      detail: "Provider revocation confirmed.",
    }));
    expect(retried.providerRevocation.status).toBe("revoked");
    const [completed] = await db.select().from(connectorRevocationObligations)
      .where(eq(connectorRevocationObligations.id, open.id));
    expect(completed).toMatchObject({
      status: "completed",
      completionEvidence: "provider_api_confirmed",
      lastErrorCode: null,
    });
    expect(await db.select().from(connectorAuthorizations).where(eq(connectorAuthorizations.userId, otherUserId))).toHaveLength(0);
  });
});
