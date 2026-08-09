import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  applicationAttempts,
  privacyErasureRuns,
  privacyErasureTasks,
  userProfiles,
  userResumes,
} from "../drizzle/schema";
import { disconnectConnectorAccess } from "./connectorDisconnect";
import { getDb } from "./db";
import { PRIVACY_RETENTION_POLICY_VERSION } from "./privacyRetention";
import { storageDelete } from "./storage";

const LEASE_MS = 5 * 60 * 1000;

type CleanupDependencies = {
  disconnect: typeof disconnectConnectorAccess;
  deleteObject: typeof storageDelete;
};

const defaultDependencies: CleanupDependencies = {
  disconnect: disconnectConnectorAccess,
  deleteObject: storageDelete,
};

export function privacyErasureConfirmation(
  userId: number,
  policyVersion: string
) {
  return `CLEAN UP USER ${userId} USING ${policyVersion}`;
}

async function loadObjectKey(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  task: typeof privacyErasureTasks.$inferSelect
) {
  const id = task.sourceRecordId;
  if (!id) return null;
  if (
    task.sourceTable === "user_profiles" &&
    task.sourceColumn === "resume_file_key"
  ) {
    return (
      (
        await db
          .select({ key: userProfiles.resumeFileKey })
          .from(userProfiles)
          .where(
            and(eq(userProfiles.id, id), eq(userProfiles.userId, task.userId))
          )
          .limit(1)
      )[0]?.key ?? null
    );
  }
  if (
    task.sourceTable === "application_attempts" &&
    task.sourceColumn === "screenshot_key"
  ) {
    return (
      (
        await db
          .select({ key: applicationAttempts.screenshotKey })
          .from(applicationAttempts)
          .where(
            and(
              eq(applicationAttempts.id, id),
              eq(applicationAttempts.userId, task.userId)
            )
          )
          .limit(1)
      )[0]?.key ?? null
    );
  }
  if (task.sourceTable === "user_resumes" && task.sourceColumn === "file_key") {
    return (
      (
        await db
          .select({ key: userResumes.fileKey })
          .from(userResumes)
          .where(
            and(eq(userResumes.id, id), eq(userResumes.userId, task.userId))
          )
          .limit(1)
      )[0]?.key ?? null
    );
  }
  throw new Error("unsupported_private_object_source");
}

async function updateRunReadiness(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  runId: number,
  leaseId: string
) {
  const tasks = await db
    .select()
    .from(privacyErasureTasks)
    .where(eq(privacyErasureTasks.runId, runId));
  const externalTasks = tasks.filter(
    task => task.kind !== "retention_hold" && task.kind !== "database_finalize"
  );
  const hasFailure = externalTasks.some(task => task.status === "failed");
  const needsManualAction = externalTasks.some(
    task => task.status === "blocked"
  );
  const hasPending = externalTasks.some(
    task => task.status === "pending" || task.status === "in_progress"
  );
  const status = hasFailure
    ? "failed"
    : needsManualAction
      ? "manual_action_required"
      : hasPending
        ? "cleanup_in_progress"
        : "ready_for_database";
  await db
    .update(privacyErasureRuns)
    .set({
      status,
      failureSummary: hasFailure
        ? "One or more external cleanup tasks require retry."
        : null,
      executionLeaseId: null,
      executionLeaseExpiresAt: null,
    })
    .where(
      and(
        eq(privacyErasureRuns.id, runId),
        eq(privacyErasureRuns.executionLeaseId, leaseId)
      )
    );
  return { status, tasks };
}

export async function executePrivacyErasureCleanup(
  runId: number,
  confirmation: string,
  dependencies: CleanupDependencies = defaultDependencies
) {
  const db = await getDb();
  if (!db)
    throw new Error(
      "A persistent production database is required for erasure cleanup."
    );
  const run = (
    await db
      .select()
      .from(privacyErasureRuns)
      .where(eq(privacyErasureRuns.id, runId))
      .limit(1)
  )[0];
  if (!run) throw new Error("Privacy erasure run not found.");
  if (run.policyVersion !== PRIVACY_RETENTION_POLICY_VERSION) {
    throw new Error(
      "The erasure run uses an outdated retention policy and must be replanned."
    );
  }
  if (
    confirmation !== privacyErasureConfirmation(run.userId, run.policyVersion)
  ) {
    throw new Error("The erasure cleanup confirmation text does not match.");
  }
  if (
    [
      "ready_for_database",
      "database_in_progress",
      "completed",
      "cancelled",
    ].includes(run.status)
  ) {
    throw new Error(
      `Privacy erasure cleanup cannot run from status ${run.status}.`
    );
  }

  const leaseId = randomUUID();
  const now = new Date();
  const claimed = await db
    .update(privacyErasureRuns)
    .set({
      status: "cleanup_in_progress",
      executionLeaseId: leaseId,
      executionLeaseExpiresAt: new Date(now.getTime() + LEASE_MS),
    })
    .where(
      and(
        eq(privacyErasureRuns.id, runId),
        inArray(privacyErasureRuns.status, [
          "planned",
          "cleanup_in_progress",
          "manual_action_required",
          "failed",
        ]),
        or(
          isNull(privacyErasureRuns.executionLeaseId),
          lt(privacyErasureRuns.executionLeaseExpiresAt, now)
        )
      )
    );
  if (Number(claimed[0].affectedRows) !== 1) {
    throw new Error("Another erasure cleanup worker currently holds this run.");
  }

  const tasks = await db
    .select()
    .from(privacyErasureTasks)
    .where(
      and(
        eq(privacyErasureTasks.runId, runId),
        inArray(privacyErasureTasks.kind, [
          "provider_revoke",
          "private_object_delete",
        ]),
        inArray(privacyErasureTasks.status, [
          "pending",
          "failed",
          "in_progress",
        ])
      )
    );
  for (const task of tasks) {
    await db
      .update(privacyErasureTasks)
      .set({
        status: "in_progress",
        attemptCount: sql`${privacyErasureTasks.attemptCount} + 1`,
        lastAttemptAt: new Date(),
        lastErrorCode: null,
      })
      .where(eq(privacyErasureTasks.id, task.id));
    try {
      if (task.kind === "provider_revoke") {
        if (!task.provider) throw new Error("missing_provider");
        const result = await dependencies.disconnect(run.userId, task.provider);
        if (result.providerRevocation.status === "failed")
          throw new Error("provider_revocation_failed");
        await db
          .update(privacyErasureTasks)
          .set({
            status:
              result.providerRevocation.status === "manual_required"
                ? "blocked"
                : "completed",
            lastErrorCode:
              result.providerRevocation.status === "manual_required"
                ? "manual_provider_cleanup_required"
                : null,
            completedAt:
              result.providerRevocation.status === "manual_required"
                ? null
                : new Date(),
          })
          .where(eq(privacyErasureTasks.id, task.id));
      } else {
        const key = await loadObjectKey(db, task);
        if (key) await dependencies.deleteObject(key);
        await db
          .update(privacyErasureTasks)
          .set({
            status: "completed",
            completedAt: new Date(),
          })
          .where(eq(privacyErasureTasks.id, task.id));
      }
    } catch (error) {
      const code =
        error instanceof Error && /^[a-z_]+$/.test(error.message)
          ? error.message
          : task.kind === "provider_revoke"
            ? "provider_revocation_failed"
            : "storage_delete_failed";
      await db
        .update(privacyErasureTasks)
        .set({ status: "failed", lastErrorCode: code })
        .where(eq(privacyErasureTasks.id, task.id));
    }
  }
  return {
    ...(await updateRunReadiness(db, runId, leaseId)),
    userId: run.userId,
  };
}

export async function confirmManualPrivacyCleanup(
  runId: number,
  taskId: number,
  evidence: string
) {
  const normalizedEvidence = evidence.trim();
  if (normalizedEvidence.length < 20 || normalizedEvidence.length > 2000) {
    throw new Error(
      "Manual cleanup evidence must be between 20 and 2,000 characters."
    );
  }
  const db = await getDb();
  if (!db)
    throw new Error(
      "A persistent production database is required for erasure cleanup."
    );
  const task = (
    await db
      .select()
      .from(privacyErasureTasks)
      .where(
        and(
          eq(privacyErasureTasks.id, taskId),
          eq(privacyErasureTasks.runId, runId),
          eq(privacyErasureTasks.kind, "provider_revoke"),
          eq(privacyErasureTasks.status, "blocked")
        )
      )
      .limit(1)
  )[0];
  if (!task) throw new Error("A blocked manual provider task was not found.");
  await db
    .update(privacyErasureTasks)
    .set({
      status: "completed",
      completionEvidence: normalizedEvidence,
      lastErrorCode: null,
      completedAt: new Date(),
    })
    .where(eq(privacyErasureTasks.id, taskId));
  const remaining = await db
    .select({ id: privacyErasureTasks.id })
    .from(privacyErasureTasks)
    .where(
      and(
        eq(privacyErasureTasks.runId, runId),
        inArray(privacyErasureTasks.kind, [
          "provider_revoke",
          "private_object_delete",
        ]),
        inArray(privacyErasureTasks.status, [
          "pending",
          "blocked",
          "in_progress",
          "failed",
        ])
      )
    )
    .limit(1);
  if (remaining.length === 0) {
    await db
      .update(privacyErasureRuns)
      .set({ status: "ready_for_database" })
      .where(
        and(
          eq(privacyErasureRuns.id, runId),
          eq(privacyErasureRuns.status, "manual_action_required")
        )
      );
  }
  return { success: true, userId: task.userId };
}
