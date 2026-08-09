import { and, eq, isNotNull } from "drizzle-orm";
import {
  applicationAttempts,
  connectorAuthorizations,
  employmentVerifications,
  privacyErasureRuns,
  privacyErasureTasks,
  successFees,
  userProfiles,
  userResumes,
} from "../drizzle/schema";
import { getAdminReviewEvidenceSnapshot, getDb } from "./db";
import {
  buildPrivacyErasurePreview,
  PRIVACY_RETENTION_POLICY_VERSION,
} from "./privacyRetention";

type PersistentDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type TaskQueryDb = Pick<PersistentDb, "select">;

type PlannedTask = typeof privacyErasureTasks.$inferInsert;

const privateObjectSources = [
  {
    table: "user_profiles",
    tableRef: userProfiles,
    userColumn: userProfiles.userId,
    valueColumn: userProfiles.resumeFileKey,
    column: "resume_file_key",
    retained: false,
  },
  {
    table: "application_attempts",
    tableRef: applicationAttempts,
    userColumn: applicationAttempts.userId,
    valueColumn: applicationAttempts.screenshotKey,
    column: "screenshot_key",
    retained: false,
  },
  {
    table: "user_resumes",
    tableRef: userResumes,
    userColumn: userResumes.userId,
    valueColumn: userResumes.fileKey,
    column: "file_key",
    retained: false,
  },
  {
    table: "success_fees",
    tableRef: successFees,
    userColumn: successFees.userId,
    valueColumn: successFees.offerLetterKey,
    column: "offer_letter_key",
    retained: true,
  },
  {
    table: "employment_verifications",
    tableRef: employmentVerifications,
    userColumn: employmentVerifications.userId,
    valueColumn: employmentVerifications.documentKey,
    column: "document_key",
    retained: true,
  },
] as const;

async function collectTasks(db: TaskQueryDb, runId: number, userId: number) {
  const tasks: PlannedTask[] = [];
  const authorizations = await db
    .select({
      id: connectorAuthorizations.id,
      provider: connectorAuthorizations.provider,
    })
    .from(connectorAuthorizations)
    .where(eq(connectorAuthorizations.userId, userId));
  for (const authorization of authorizations) {
    tasks.push({
      runId,
      userId,
      taskKey: `provider:${authorization.provider}:${authorization.id}`,
      kind: "provider_revoke",
      sourceTable: "connector_authorizations",
      sourceRecordId: authorization.id,
      provider: authorization.provider,
    });
  }

  for (const source of privateObjectSources) {
    const rows = await db
      .select({ id: source.tableRef.id })
      .from(source.tableRef)
      .where(and(eq(source.userColumn, userId), isNotNull(source.valueColumn)));
    for (const row of rows) {
      const kind = source.retained ? "retention_hold" : "private_object_delete";
      tasks.push({
        runId,
        userId,
        taskKey: `${kind}:${source.table}:${row.id}:${source.column}`,
        kind,
        sourceTable: source.table,
        sourceRecordId: row.id,
        sourceColumn: source.column,
        status: source.retained ? "blocked" : "pending",
      });
    }
  }

  tasks.push({
    runId,
    userId,
    taskKey: "database:finalize",
    kind: "database_finalize",
    sourceTable: "privacy_retention_policy",
  });
  return tasks;
}

export async function getPrivacyErasureRunForReview(reviewItemId: number) {
  const db = await getDb();
  if (!db) return null;
  const runs = await db
    .select()
    .from(privacyErasureRuns)
    .where(eq(privacyErasureRuns.reviewItemId, reviewItemId))
    .limit(1);
  if (!runs[0]) return null;
  const tasks = await db
    .select()
    .from(privacyErasureTasks)
    .where(eq(privacyErasureTasks.runId, runs[0].id));
  return { run: runs[0], tasks };
}

export async function planPrivacyErasure(
  reviewItemId: number,
  adminUserId: number,
  options: { allowUnresolvedReview?: boolean } = {}
) {
  const evidence = await getAdminReviewEvidenceSnapshot(reviewItemId);
  if (
    evidence.reviewItem.category !== "privacy_deletion" ||
    evidence.reviewItem.entityType !== "user"
  ) {
    throw new Error(
      "Erasure plans are available only for privacy deletion reviews."
    );
  }
  if (
    evidence.reviewItem.status !== "resolved" &&
    !options.allowUnresolvedReview
  ) {
    throw new Error(
      "Resolve the privacy retention review before creating an erasure plan."
    );
  }
  if (
    !["open", "in_progress", "resolved"].includes(evidence.reviewItem.status)
  ) {
    throw new Error(
      "A dismissed privacy review cannot receive an erasure plan."
    );
  }

  const db = await getDb();
  if (!db)
    throw new Error(
      "A persistent production database is required for erasure planning."
    );
  const existing = await getPrivacyErasureRunForReview(reviewItemId);
  if (existing) return { ...existing, existing: true as const };

  const preview = await buildPrivacyErasurePreview(evidence.reviewItem.userId);
  if (!preview.available) throw new Error(preview.reason);
  const run = await db.transaction(async tx => {
    await tx.insert(privacyErasureRuns).values({
      reviewItemId,
      userId: evidence.reviewItem.userId,
      requestedByAdminId: adminUserId,
      policyVersion: PRIVACY_RETENTION_POLICY_VERSION,
      inventorySnapshot: JSON.stringify({
        generatedAt: preview.generatedAt,
        summary: preview.summary,
        items: preview.items,
      }),
    });
    const rows = await tx
      .select()
      .from(privacyErasureRuns)
      .where(eq(privacyErasureRuns.reviewItemId, reviewItemId))
      .limit(1);
    if (!rows[0])
      throw new Error("The privacy erasure run could not be created.");
    const tasks = await collectTasks(
      tx,
      rows[0].id,
      evidence.reviewItem.userId
    );
    if (tasks.length > 0) await tx.insert(privacyErasureTasks).values(tasks);
    return rows[0];
  });
  const planned = await getPrivacyErasureRunForReview(reviewItemId);
  if (!planned)
    throw new Error(
      "The privacy erasure plan could not be loaded after creation."
    );
  return { ...planned, run, existing: false as const };
}
