import { and, desc, eq, inArray } from "drizzle-orm";
import {
  connectorRevocationObligations,
  privacyErasureRuns,
  privacyErasureTasks,
} from "../drizzle/schema";
import { getDb } from "./db";
import {
  CONNECTOR_REVOCATION_INSTRUCTION_VERSION,
  getConnectorRevocationInstruction,
} from "./connectorRevocation";
import type { OAuthConnectorProvider } from "./connectorOAuth";

export type ConnectorRevocationFailureCode =
  | "provider_rejected"
  | "network_failure"
  | "credential_unavailable";

export type ConnectorRevocationEvidence =
  | "provider_api_confirmed"
  | "user_attested_manual_removal"
  | "operator_attested_manual_removal";

export async function recordConnectorRevocationObligation(input: {
  userId: number;
  provider: OAuthConnectorProvider;
  status: "manual_required" | "retry_required";
  lastErrorCode?: ConnectorRevocationFailureCode | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("persistent_database_required");
  await db.insert(connectorRevocationObligations).values({
    userId: input.userId,
    provider: input.provider,
    status: input.status,
    instructionVersion: CONNECTOR_REVOCATION_INSTRUCTION_VERSION,
    lastErrorCode: input.lastErrorCode ?? null,
    completionEvidence: null,
    completedAt: null,
  }).onDuplicateKeyUpdate({
    set: {
      status: input.status,
      instructionVersion: CONNECTOR_REVOCATION_INSTRUCTION_VERSION,
      lastErrorCode: input.lastErrorCode ?? null,
      completionEvidence: null,
      completedAt: null,
      updatedAt: new Date(),
    },
  });
  return getOpenConnectorRevocationObligation(input.userId, input.provider);
}

export async function getOpenConnectorRevocationObligation(
  userId: number,
  provider: OAuthConnectorProvider
) {
  const db = await getDb();
  if (!db) throw new Error("persistent_database_required");
  const rows = await db.select().from(connectorRevocationObligations).where(and(
    eq(connectorRevocationObligations.userId, userId),
    eq(connectorRevocationObligations.provider, provider),
    inArray(connectorRevocationObligations.status, ["manual_required", "retry_required"])
  )).limit(1);
  return rows[0] ?? null;
}

export async function listOpenConnectorRevocationObligations(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("persistent_database_required");
  const rows = await db.select({
    id: connectorRevocationObligations.id,
    provider: connectorRevocationObligations.provider,
    status: connectorRevocationObligations.status,
    instructionVersion: connectorRevocationObligations.instructionVersion,
    lastErrorCode: connectorRevocationObligations.lastErrorCode,
    createdAt: connectorRevocationObligations.createdAt,
    updatedAt: connectorRevocationObligations.updatedAt,
  }).from(connectorRevocationObligations).where(and(
    eq(connectorRevocationObligations.userId, userId),
    inArray(connectorRevocationObligations.status, ["manual_required", "retry_required"])
  ));
  return rows.map(row => ({
    ...row,
    instruction: getConnectorRevocationInstruction(row.provider),
  }));
}

export async function listConnectorRevocationHistory(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("persistent_database_required");
  const rows = await db.select({
    provider: connectorRevocationObligations.provider,
    status: connectorRevocationObligations.status,
    instructionVersion: connectorRevocationObligations.instructionVersion,
    lastErrorCode: connectorRevocationObligations.lastErrorCode,
    completionEvidence: connectorRevocationObligations.completionEvidence,
    completedAt: connectorRevocationObligations.completedAt,
    createdAt: connectorRevocationObligations.createdAt,
  }).from(connectorRevocationObligations)
    .where(eq(connectorRevocationObligations.userId, userId))
    .orderBy(desc(connectorRevocationObligations.createdAt), desc(connectorRevocationObligations.id))
    .limit(100);
  return rows;
}

export async function completeConnectorRevocationObligation(
  userId: number,
  provider: OAuthConnectorProvider,
  evidence: ConnectorRevocationEvidence
) {
  const db = await getDb();
  if (!db) throw new Error("persistent_database_required");
  return db.transaction(async tx => {
    const open = await tx.select({ id: connectorRevocationObligations.id }).from(connectorRevocationObligations).where(and(
      eq(connectorRevocationObligations.userId, userId),
      eq(connectorRevocationObligations.provider, provider),
      inArray(connectorRevocationObligations.status, ["manual_required", "retry_required"])
    )).limit(1).for("update");
    const obligation = open[0];
    if (!obligation) return { completed: false, affectedRuns: [] as number[] };

    await tx.update(connectorRevocationObligations).set({
      status: "completed",
      lastErrorCode: null,
      completionEvidence: evidence,
      completedAt: new Date(),
    }).where(eq(connectorRevocationObligations.id, obligation.id));

    const tasks = await tx.select({
      id: privacyErasureTasks.id,
      runId: privacyErasureTasks.runId,
    }).from(privacyErasureTasks).where(and(
      eq(privacyErasureTasks.userId, userId),
      eq(privacyErasureTasks.provider, provider),
      eq(privacyErasureTasks.kind, "provider_revoke"),
      inArray(privacyErasureTasks.status, ["blocked", "failed"])
    ));
    if (tasks.length > 0) {
      await tx.update(privacyErasureTasks).set({
        status: "completed",
        completionEvidence: evidence,
        lastErrorCode: null,
        completedAt: new Date(),
      }).where(inArray(privacyErasureTasks.id, tasks.map(task => task.id)));
    }

    const affectedRuns = Array.from(new Set(tasks.map(task => task.runId)));
    for (const runId of affectedRuns) {
      const remaining = await tx.select({ id: privacyErasureTasks.id }).from(privacyErasureTasks).where(and(
        eq(privacyErasureTasks.runId, runId),
        inArray(privacyErasureTasks.kind, ["provider_revoke", "private_object_delete"]),
        inArray(privacyErasureTasks.status, ["pending", "blocked", "in_progress", "failed"])
      )).limit(1);
      if (remaining.length === 0) {
        await tx.update(privacyErasureRuns).set({ status: "ready_for_database" }).where(and(
          eq(privacyErasureRuns.id, runId),
          inArray(privacyErasureRuns.status, ["manual_action_required", "cleanup_in_progress", "failed"])
        ));
      }
    }
    return { completed: true, affectedRuns };
  });
}
