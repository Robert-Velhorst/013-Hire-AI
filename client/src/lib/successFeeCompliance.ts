export interface SuccessFeeLike {
  status?: string | null;
  nextVerificationDue?: Date | string | null;
  monthlyFeeAmount?: number | null;
}

export interface OfferAttributionReviewLike {
  approval?: unknown;
}

export type SuccessFeeComplianceStatus = "none" | "clear" | "due_soon" | "needs_attention";
export type SuccessFeeComplianceRisk = "low" | "medium" | "high" | "critical";
export type SuccessFeeComplianceActionId =
  | "review_offer_attribution"
  | "resolve_disputed_fee"
  | "resolve_suspended_payment"
  | "review_paused_billing"
  | "submit_verification"
  | "prepare_verification"
  | "monitor"
  | "report_hire";

export interface SuccessFeeComplianceSummary {
  status: SuccessFeeComplianceStatus;
  activeFees: number;
  suspendedFees: number;
  pausedFees: number;
  disputedFees: number;
  pendingVerification: number;
  overdueVerifications: number;
  dueSoonVerifications: number;
  pendingOfferAttributions: number;
  monthlyFeeCents: number;
  nextVerificationDue: Date | null;
  daysUntilNextVerification: number | null;
  label: string;
  nextAction: string;
}

export type SuccessFeeComplianceAggregates = Omit<
  SuccessFeeComplianceSummary,
  "status" | "pendingOfferAttributions" | "daysUntilNextVerification" | "label" | "nextAction"
>;

export interface SuccessFeeComplianceAction {
  id: SuccessFeeComplianceActionId;
  label: string;
  detail: string;
  cta: string;
  route: string;
  risk: SuccessFeeComplianceRisk;
  proofRequired: boolean;
  approvalGated: boolean;
}

const ACTIVE_FEE_STATUSES = new Set(["active", "pending_verification"]);
const DUE_SOON_DAYS = 14;

function coerceDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getSuccessFeeComplianceSummary(
  fees: SuccessFeeLike[] = [],
  offerAttributionReviews: OfferAttributionReviewLike[] = [],
  now = new Date()
): SuccessFeeComplianceSummary {
  const activeFees = fees.filter((fee) => ACTIVE_FEE_STATUSES.has(fee.status || ""));
  const suspendedFees = fees.filter((fee) => fee.status === "suspended");
  const pausedFees = fees.filter((fee) => fee.status === "paused");
  const disputedFees = fees.filter((fee) => fee.status === "disputed");
  const verificationDeadlines = activeFees
    .map((fee) => coerceDate(fee.nextVerificationDue))
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => a.getTime() - b.getTime());
  const overdueVerifications = verificationDeadlines.filter((date) => date.getTime() < now.getTime()).length;
  const dueSoonVerifications = verificationDeadlines.filter((date) => {
    const daysUntil = Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
    return daysUntil >= 0 && daysUntil <= DUE_SOON_DAYS;
  }).length;
  const pendingVerification = activeFees.filter((fee) => fee.status === "pending_verification").length;
  const pendingOfferAttributions = offerAttributionReviews.length;
  const monthlyFeeCents = activeFees.reduce((sum, fee) => sum + (fee.monthlyFeeAmount || 0), 0);
  const nextVerificationDue = verificationDeadlines[0] || null;

  return getSuccessFeeComplianceSummaryFromAggregates({
    activeFees: activeFees.length,
    suspendedFees: suspendedFees.length,
    pausedFees: pausedFees.length,
    disputedFees: disputedFees.length,
    pendingVerification,
    overdueVerifications,
    dueSoonVerifications,
    monthlyFeeCents,
    nextVerificationDue,
  }, pendingOfferAttributions, now);
}

export function getSuccessFeeComplianceSummaryFromAggregates(
  aggregates: SuccessFeeComplianceAggregates,
  pendingOfferAttributions = 0,
  now = new Date()
): SuccessFeeComplianceSummary {
  const {
    activeFees,
    suspendedFees,
    pausedFees,
    disputedFees,
    pendingVerification,
    overdueVerifications,
    dueSoonVerifications,
    monthlyFeeCents,
    nextVerificationDue,
  } = aggregates;
  const normalizedNextDue = coerceDate(nextVerificationDue);
  const daysUntilNextVerification = normalizedNextDue
    ? Math.ceil((normalizedNextDue.getTime() - now.getTime()) / 86_400_000)
    : null;

  if (pendingOfferAttributions > 0 || disputedFees > 0 || suspendedFees > 0 || pausedFees > 0 || overdueVerifications > 0) {
    return {
      status: "needs_attention",
      activeFees,
      suspendedFees,
      pausedFees,
      disputedFees,
      pendingVerification,
      overdueVerifications,
      dueSoonVerifications,
      pendingOfferAttributions,
      monthlyFeeCents,
      nextVerificationDue: normalizedNextDue,
      daysUntilNextVerification,
      label: "Needs attention",
      nextAction: pendingOfferAttributions > 0
        ? "Review offer attribution and report hires that came through Hire.AI."
        : disputedFees > 0
          ? "Resolve the disputed success-fee record through review before billing enforcement advances."
        : suspendedFees > 0
          ? "Resolve the suspended success-fee payment before billing enforcement advances."
          : pausedFees > 0
            ? "Review the paused success-fee record before billing resumes."
        : "Submit overdue employment verification proof.",
    };
  }

  if (pendingVerification > 0 || dueSoonVerifications > 0) {
    return {
      status: "due_soon",
      activeFees,
      suspendedFees,
      pausedFees,
      disputedFees,
      pendingVerification,
      overdueVerifications,
      dueSoonVerifications,
      pendingOfferAttributions,
      monthlyFeeCents,
      nextVerificationDue: normalizedNextDue,
      daysUntilNextVerification,
      label: "Verification pending",
      nextAction: "Keep offer proof and verification documents ready for review.",
    };
  }

  if (activeFees > 0) {
    return {
      status: "clear",
      activeFees,
      suspendedFees,
      pausedFees,
      disputedFees,
      pendingVerification,
      overdueVerifications,
      dueSoonVerifications,
      pendingOfferAttributions,
      monthlyFeeCents,
      nextVerificationDue: normalizedNextDue,
      daysUntilNextVerification,
      label: "Current",
      nextAction: "No success-fee compliance action is due right now.",
    };
  }

  return {
    status: "none",
    activeFees: 0,
    suspendedFees: 0,
    pausedFees: 0,
    disputedFees: 0,
    pendingVerification: 0,
    overdueVerifications: 0,
    dueSoonVerifications: 0,
    pendingOfferAttributions,
    monthlyFeeCents: 0,
    nextVerificationDue: null,
    daysUntilNextVerification: null,
    label: pendingOfferAttributions > 0 ? "Needs attention" : "No active fees",
    nextAction: pendingOfferAttributions > 0
      ? "Review offer attribution and report hires that came through Hire.AI."
      : "Report a hire only after an offer is accepted.",
  };
}

export function getSuccessFeeComplianceAction(
  summary: SuccessFeeComplianceSummary
): SuccessFeeComplianceAction {
  if (summary.pendingOfferAttributions > 0) {
    return {
      id: "review_offer_attribution",
      label: "Offer attribution review",
      detail: "Confirm whether the offer came from Hire.AI activity before reporting the hire or allowing billing setup to proceed.",
      cta: "Open review queue",
      route: "/review-queue",
      risk: "high",
      proofRequired: true,
      approvalGated: true,
    };
  }

  if (summary.disputedFees > 0) {
    return {
      id: "resolve_disputed_fee",
      label: "Success-fee dispute review",
      detail: "A success-fee record is disputed. Review the billing record and supporting evidence before any enforcement or reactivation decision.",
      cta: "Review billing",
      route: "/billing",
      risk: "critical",
      proofRequired: true,
      approvalGated: true,
    };
  }

  if (summary.suspendedFees > 0) {
    return {
      id: "resolve_suspended_payment",
      label: "Payment recovery required",
      detail: "A success-fee payment is suspended. Review the billing record and resolve payment recovery before any enforcement action advances.",
      cta: "Review billing",
      route: "/billing",
      risk: "high",
      proofRequired: false,
      approvalGated: false,
    };
  }

  if (summary.pausedFees > 0) {
    return {
      id: "review_paused_billing",
      label: "Paused billing review",
      detail: "A success-fee record is paused. Review its reason and supporting evidence before billing is resumed or closed.",
      cta: "Review billing",
      route: "/billing",
      risk: "high",
      proofRequired: true,
      approvalGated: true,
    };
  }

  if (summary.overdueVerifications > 0) {
    return {
      id: "submit_verification",
      label: "Verification overdue",
      detail: "Upload current employment proof so the success-fee ledger can stay compliant before suspension or admin review escalates.",
      cta: "Submit verification",
      route: "/billing",
      risk: "critical",
      proofRequired: true,
      approvalGated: true,
    };
  }

  if (summary.pendingVerification > 0 || summary.dueSoonVerifications > 0) {
    return {
      id: "prepare_verification",
      label: "Verification pending",
      detail: "Keep offer and employment proof ready; submit verification when the current proof window opens.",
      cta: "Review fees",
      route: "/billing",
      risk: "medium",
      proofRequired: true,
      approvalGated: false,
    };
  }

  if (summary.activeFees > 0) {
    return {
      id: "monitor",
      label: "Compliance current",
      detail: "Success-fee records are current. Keep quarterly verification and payment records up to date.",
      cta: "View fees",
      route: "/billing",
      risk: "low",
      proofRequired: false,
      approvalGated: false,
    };
  }

  return {
    id: "report_hire",
    label: "No active success fee",
    detail: "Report a hire only after accepting an offer and having proof ready for attribution and billing review.",
    cta: "Report accepted hire",
    route: "/billing",
    risk: "high",
    proofRequired: true,
    approvalGated: true,
  };
}
