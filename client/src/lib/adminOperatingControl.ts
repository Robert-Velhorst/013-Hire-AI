import type { AdminOperatingSummary } from "./adminOperatingSummary";

export type AdminOperatingControlStatus =
  | "critical"
  | "attention"
  | "watch"
  | "clear";

export type AdminOperatingControlRisk = "low" | "medium" | "high" | "critical";

export type AdminOperatingControlTab =
  | "overview"
  | "overdue"
  | "verifications"
  | "review"
  | "payments";

export type AdminOperatingControlActionId =
  | "review_legal"
  | "review_failed_payments"
  | "review_grace_expired_verifications"
  | "review_offer_attribution"
  | "review_employment_ended"
  | "review_overdue_verifications"
  | "review_pending_verifications"
  | "open_review_queue"
  | "monitor";

export interface AdminOperatingControlAction {
  id: AdminOperatingControlActionId;
  status: AdminOperatingControlStatus;
  count: number;
  tab: AdminOperatingControlTab;
  risk: AdminOperatingControlRisk;
  approvalGated: boolean;
}

export function getAdminOperatingControlAction(
  summary: AdminOperatingSummary
): AdminOperatingControlAction {
  if (summary.legalEscalations > 0) {
    return {
      id: "review_legal",
      status: "critical",
      count: summary.legalEscalations,
      tab: "review",
      risk: "critical",
      approvalGated: true,
    };
  }

  if (summary.failedPayments > 0) {
    return {
      id: "review_failed_payments",
      status: "critical",
      count: summary.failedPayments,
      tab: "payments",
      risk: "high",
      approvalGated: true,
    };
  }

  if (summary.graceExpiredVerifications > 0) {
    return {
      id: "review_grace_expired_verifications",
      status: "critical",
      count: summary.graceExpiredVerifications,
      tab: "overdue",
      risk: "high",
      approvalGated: true,
    };
  }

  if (summary.offerAttributionReviews > 0) {
    return {
      id: "review_offer_attribution",
      status: "attention",
      count: summary.offerAttributionReviews,
      tab: "review",
      risk: "high",
      approvalGated: true,
    };
  }

  if (summary.employmentEndedReviews > 0) {
    return {
      id: "review_employment_ended",
      status: "attention",
      count: summary.employmentEndedReviews,
      tab: "review",
      risk: "high",
      approvalGated: true,
    };
  }

  if (summary.overdueVerifications > 0) {
    return {
      id: "review_overdue_verifications",
      status: "attention",
      count: summary.overdueVerifications,
      tab: "overdue",
      risk: "high",
      approvalGated: true,
    };
  }

  if (summary.pendingVerifications > 0) {
    return {
      id: "review_pending_verifications",
      status: "watch",
      count: summary.pendingVerifications,
      tab: "verifications",
      risk: "medium",
      approvalGated: true,
    };
  }

  if (summary.totalOpenWork > 0) {
    return {
      id: "open_review_queue",
      status: "watch",
      count: summary.totalOpenWork,
      tab: "review",
      risk: "medium",
      approvalGated: true,
    };
  }

  return {
    id: "monitor",
    status: "clear",
    count: 0,
    tab: "overview",
    risk: "low",
    approvalGated: false,
  };
}
