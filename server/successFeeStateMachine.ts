import type { SuccessFee } from "../drizzle/schema";

export type SuccessFeeStatus = NonNullable<SuccessFee["status"]>;
export type SuccessFeeLifecycleStatus = NonNullable<SuccessFee["lifecycleStatus"]>;
export type SuccessFeeHoldType =
  | "payment"
  | "account"
  | "administrator"
  | "legal"
  | "verification"
  | "dispute"
  | "legacy_review";

const DISPUTING_HOLDS = new Set<SuccessFeeHoldType>(["legal", "dispute", "legacy_review"]);

export function deriveEffectiveSuccessFeeStatus(
  lifecycleStatus: SuccessFeeLifecycleStatus,
  activeHolds: readonly SuccessFeeHoldType[],
): SuccessFeeStatus {
  if (lifecycleStatus === "ended") return "ended";
  if (activeHolds.some((hold) => DISPUTING_HOLDS.has(hold))) return "disputed";
  if (activeHolds.length > 0) return "suspended";
  return lifecycleStatus;
}

const ALLOWED_TRANSITIONS: Record<SuccessFeeStatus, ReadonlySet<SuccessFeeStatus>> = {
  pending_verification: new Set<SuccessFeeStatus>(["active", "paused", "ended", "suspended", "disputed"]),
  active: new Set<SuccessFeeStatus>(["paused", "suspended", "ended", "disputed"]),
  paused: new Set<SuccessFeeStatus>(["active", "ended", "disputed"]),
  suspended: new Set<SuccessFeeStatus>(["active", "paused", "ended", "disputed"]),
  disputed: new Set<SuccessFeeStatus>(["paused", "ended"]),
  ended: new Set<SuccessFeeStatus>(),
};

export function canTransitionSuccessFeeStatus(
  from: SuccessFeeStatus,
  to: SuccessFeeStatus,
) {
  return from === to || ALLOWED_TRANSITIONS[from].has(to);
}

export function assertSuccessFeeTransition(
  from: SuccessFeeStatus,
  to: SuccessFeeStatus,
) {
  if (!canTransitionSuccessFeeStatus(from, to)) {
    throw new Error(`Invalid success-fee transition: ${from} -> ${to}`);
  }
}
