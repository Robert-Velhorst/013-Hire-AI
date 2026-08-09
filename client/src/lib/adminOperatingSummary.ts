export interface AdminStatsLike {
  activeFees?: number | null;
  pendingFees?: number | null;
  suspendedFees?: number | null;
  pausedFees?: number | null;
  disputedFees?: number | null;
  overdueVerifications?: number | null;
  monthlyRevenueUsd?: number | null;
  totalRevenueUsd?: number | null;
  totalUsers?: number | null;
}

export interface AdminOverdueVerificationLike {
  graceExpired?: boolean | null;
  daysOverdue?: number | null;
}

export interface AdminReviewItemLike {
  priority?: string | null;
  category?: string | null;
}

export interface AdminPaymentLike {
  status?: string | null;
}

export interface AdminOperatingSummary {
  status: "clear" | "watch" | "attention" | "critical";
  label: string;
  nextAction: string;
  totalOpenWork: number;
  criticalItems: number;
  highRiskItems: number;
  overdueVerifications: number;
  graceExpiredVerifications: number;
  pendingVerifications: number;
  failedPayments: number;
  legalEscalations: number;
  offerAttributionReviews: number;
  employmentEndedReviews: number;
  monthlyRevenueUsd: number;
}

export interface AdminOperatingAggregates {
  reviewTotal: number;
  criticalItems: number;
  highRiskItems: number;
  overdueVerifications: number;
  graceExpiredVerifications: number;
  pendingVerifications: number;
  failedPayments: number;
  legalEscalations: number;
  offerAttributionReviews: number;
  employmentEndedReviews: number;
}

function countBy<T>(items: T[] | null | undefined, predicate: (item: T) => boolean) {
  return (items || []).filter(predicate).length;
}

export function getAdminOperatingSummary(input: {
  stats?: AdminStatsLike | null;
  overdue?: AdminOverdueVerificationLike[] | null;
  pendingVerifications?: unknown[] | null;
  reviewQueue?: AdminReviewItemLike[] | null;
  payments?: AdminPaymentLike[] | null;
  aggregates?: Partial<AdminOperatingAggregates> | null;
}): AdminOperatingSummary {
  const overdueVerifications = input.aggregates?.overdueVerifications ?? input.overdue?.length ?? input.stats?.overdueVerifications ?? 0;
  const graceExpiredVerifications = input.aggregates?.graceExpiredVerifications ?? countBy(input.overdue, (item) => item.graceExpired === true);
  const pendingVerifications = input.aggregates?.pendingVerifications ?? input.pendingVerifications?.length ?? input.stats?.pendingFees ?? 0;
  const failedPayments = input.aggregates?.failedPayments ?? countBy(input.payments, (payment) => payment.status === "failed");
  const legalEscalations = input.aggregates?.legalEscalations ?? countBy(input.reviewQueue, (item) => item.category === "legal_escalation");
  const offerAttributionReviews = input.aggregates?.offerAttributionReviews ?? countBy(input.reviewQueue, (item) => item.category === "offer_attribution");
  const employmentEndedReviews = input.aggregates?.employmentEndedReviews ?? countBy(input.reviewQueue, (item) => item.category === "employment_ended");
  const criticalItems = input.aggregates?.criticalItems ?? (countBy(input.reviewQueue, (item) =>
    item.priority === "critical" || item.category === "legal_escalation" || item.category === "payment_failed"
  ) + graceExpiredVerifications + failedPayments);
  const highRiskItems = input.aggregates?.highRiskItems ?? (countBy(input.reviewQueue, (item) => item.priority === "high" || item.category === "employment_ended") + overdueVerifications);
  const totalOpenWork =
    (input.aggregates?.reviewTotal ?? input.reviewQueue?.length ?? 0) +
    pendingVerifications +
    overdueVerifications +
    failedPayments;
  const monthlyRevenueUsd = input.stats?.monthlyRevenueUsd ?? 0;

  if (criticalItems > 0) {
    return {
      status: "critical",
      label: "Critical review",
      nextAction: legalEscalations > 0
        ? "Review legal escalation items manually before any enforcement action."
        : failedPayments > 0
          ? "Review failed payment items and billing status before suspending accounts."
          : "Review grace-expired verification items before suspension or escalation.",
      totalOpenWork,
      criticalItems,
      highRiskItems,
      overdueVerifications,
      graceExpiredVerifications,
      pendingVerifications,
      failedPayments,
      legalEscalations,
      offerAttributionReviews,
      employmentEndedReviews,
      monthlyRevenueUsd,
    };
  }

  if (overdueVerifications > 0 || highRiskItems > 0 || offerAttributionReviews > 0 || employmentEndedReviews > 0) {
    return {
      status: "attention",
      label: "Needs attention",
      nextAction: offerAttributionReviews > 0
        ? "Review offer attribution before success-fee billing is created."
        : employmentEndedReviews > 0
          ? "Review employment-ended reports before closing success-fee obligations."
        : "Work overdue verification and high-priority review items first.",
      totalOpenWork,
      criticalItems,
      highRiskItems,
      overdueVerifications,
      graceExpiredVerifications,
      pendingVerifications,
      failedPayments,
      legalEscalations,
      offerAttributionReviews,
      employmentEndedReviews,
      monthlyRevenueUsd,
    };
  }

  if (pendingVerifications > 0 || totalOpenWork > 0) {
    return {
      status: "watch",
      label: "Review queue",
      nextAction: "Review pending employment verification and operating queue items.",
      totalOpenWork,
      criticalItems,
      highRiskItems,
      overdueVerifications,
      graceExpiredVerifications,
      pendingVerifications,
      failedPayments,
      legalEscalations,
      offerAttributionReviews,
      employmentEndedReviews,
      monthlyRevenueUsd,
    };
  }

  return {
    status: "clear",
    label: "Operationally clear",
    nextAction: "No admin operating work is currently queued.",
    totalOpenWork,
    criticalItems,
    highRiskItems,
    overdueVerifications,
    graceExpiredVerifications,
    pendingVerifications,
    failedPayments,
    legalEscalations,
    offerAttributionReviews,
    employmentEndedReviews,
    monthlyRevenueUsd,
  };
}
