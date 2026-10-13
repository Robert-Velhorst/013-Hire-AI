import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { successFeeHolds, successFees } from "../drizzle/schema";
import {
  deriveEffectiveSuccessFeeStatus,
  type SuccessFeeHoldType,
  type SuccessFeeLifecycleStatus,
  type SuccessFeeStatus,
} from "./successFeeStateMachine";

type HoldActor = "system" | "user" | "admin";

export async function addSuccessFeeHold(
  tx: any,
  input: {
    feeId: number;
    holdType: SuccessFeeHoldType;
    reason: string;
    actor: HoldActor;
    actorUserId?: number | null;
    sourceKey?: string;
  }
) {
  const sourceKey =
    input.sourceKey ??
    `${input.holdType}:${input.actor}:${input.actorUserId ?? "system"}:${createHash("sha256").update(input.reason).digest("hex")}`;
  const [existing] = await tx
    .select({ id: successFeeHolds.id })
    .from(successFeeHolds)
    .where(
      and(
        eq(successFeeHolds.successFeeId, input.feeId),
        eq(successFeeHolds.holdType, input.holdType),
        eq(successFeeHolds.sourceKey, sourceKey),
        isNull(successFeeHolds.resolvedAt)
      )
    )
    .limit(1)
    .for("update");
  if (existing) return false;

  await tx.insert(successFeeHolds).values({
    successFeeId: input.feeId,
    holdType: input.holdType,
    reason: input.reason,
    sourceKey,
    createdByActor: input.actor,
    createdByUserId: input.actorUserId ?? null,
  });
  return true;
}

export async function resolveSuccessFeeHolds(
  tx: any,
  input: {
    feeId: number;
    holdType: SuccessFeeHoldType;
    evidence: string;
    resolvedByUserId?: number | null;
    sourceKey?: string;
  }
) {
  const predicates = [
    eq(successFeeHolds.successFeeId, input.feeId),
    eq(successFeeHolds.holdType, input.holdType),
    isNull(successFeeHolds.resolvedAt),
  ];
  if (input.sourceKey)
    predicates.push(eq(successFeeHolds.sourceKey, input.sourceKey));
  const holds = await tx
    .select({ id: successFeeHolds.id })
    .from(successFeeHolds)
    .where(and(...predicates))
    .for("update");
  if (holds.length === 0) return 0;

  const now = new Date();
  await tx
    .update(successFeeHolds)
    .set({
      resolvedAt: now,
      resolvedByUserId: input.resolvedByUserId ?? null,
      resolutionEvidence: input.evidence,
    })
    .where(and(...predicates));
  return holds.length;
}

export async function refreshSuccessFeeEffectiveStatus(
  tx: any,
  input: {
    feeId: number;
    lifecycleStatus: SuccessFeeLifecycleStatus;
    currentStatus?: SuccessFeeStatus;
    currentLifecycleStatus?: SuccessFeeLifecycleStatus;
  }
) {
  const holds = await tx
    .select({ holdType: successFeeHolds.holdType })
    .from(successFeeHolds)
    .where(
      and(
        eq(successFeeHolds.successFeeId, input.feeId),
        isNull(successFeeHolds.resolvedAt)
      )
    );
  const status = deriveEffectiveSuccessFeeStatus(
    input.lifecycleStatus,
    holds.map((hold: { holdType: SuccessFeeHoldType }) => hold.holdType)
  );
  if (
    status !== input.currentStatus ||
    input.lifecycleStatus !== input.currentLifecycleStatus
  ) {
    await tx
      .update(successFees)
      .set({
        lifecycleStatus: input.lifecycleStatus,
        status,
      })
      .where(eq(successFees.id, input.feeId));
  }
  return status;
}
