export type ApprovalResolutionStatus = "approved" | "rejected" | "cancelled";
export type ReviewDecisionResolution = "save" | "ignore";
export type ReviewQueueActionKind =
  | "approval"
  | "send_handoff"
  | "delivery_reconciliation"
  | "evidence_gate"
  | "connector_readiness"
  | "job_decision"
  | "interview_scheduling"
  | "interview_preparation"
  | "interview_outcome"
  | "inbox_response_candidate"
  | "employer_reply"
  | "follow_up"
  | "success_fee"
  | "profile_gap"
  | "admin_review";

export type ReviewQueueActionRisk = "low" | "medium" | "high" | "critical";

export type ReviewQueueActionCopyId =
  | "approval"
  | "approved_delivery"
  | "delivery_reconciliation"
  | "evidence_gate"
  | "connector_readiness"
  | "job_decision_manual_linked"
  | "job_decision_manual_unlinked"
  | "job_decision_blocked_linked"
  | "job_decision_blocked_unlinked"
  | "job_decision_resolve_linked"
  | "job_decision_resolve_unlinked"
  | "interview_scheduling"
  | "interview_preparation"
  | "interview_outcome"
  | "inbox_response_candidate"
  | "employer_reply"
  | "follow_up"
  | "success_fee_ledger"
  | "success_fee_billing"
  | "profile_gap"
  | "admin_employment_ended"
  | "admin_review";

export interface ReviewQueueActionSummary {
  copyId: ReviewQueueActionCopyId;
  detailOverride?: string;
  route: string;
  risk: ReviewQueueActionRisk;
  approvalGated: boolean;
  externalAction: "none" | "manual_handoff" | "approved_delivery" | "delivery_reconciliation" | "blocked_until_approved" | "blocked_until_evidence";
}

export type ReviewQueueControlStatus =
  | "blocked"
  | "handoff"
  | "attention"
  | "ready"
  | "clear";

export type ReviewQueueControlCopyId =
  | "pending_approvals"
  | "delivery_reconciliation"
  | "approved_delivery"
  | "success_fee_compliance"
  | "evidence_gates"
  | "admin_reviews"
  | "profile_blockers"
  | "connector_readiness"
  | "inbox_response_candidates"
  | "employer_replies"
  | "interview_scheduling"
  | "interview_outcomes"
  | "follow_up_drafting"
  | "job_decisions"
  | "interview_preparation"
  | "profile_warnings"
  | "queue_clear";

export type ReviewQueueControlSection =
  | "approvals"
  | "send-handoffs"
  | "delivery-reconciliation"
  | "evidence-gates"
  | "connector-readiness"
  | "job-decisions"
  | "interview-scheduling"
  | "interview-preparation"
  | "interview-outcomes"
  | "inbox-response-candidates"
  | "employer-replies"
  | "follow-ups"
  | "success-fees"
  | "profile-readiness"
  | "admin-reviews"
  | "audit";

export interface ReviewQueueControlSummary {
  status: ReviewQueueControlStatus;
  copyId: ReviewQueueControlCopyId;
  section: ReviewQueueControlSection;
  route: string;
  count: number;
  risk: ReviewQueueActionRisk;
  approvalGated: boolean;
  externalAction: ReviewQueueActionSummary["externalAction"];
}

export interface OperatingReviewQueueInput {
  queues?: {
    pendingApprovals?: unknown[];
    reviewDecisions?: unknown[];
    adminReviews?: unknown[];
    interviewScheduling?: unknown[];
    interviewPreparationNeeded?: unknown[];
    interviewOutcomesNeeded?: unknown[];
    inboxResponseCandidates?: unknown[];
    employerResponsesNeedingReply?: unknown[];
    followUpsDue?: unknown[];
    approvedFollowUpsReadyToSend?: unknown[];
    followUpDeliveryReconciliation?: unknown[];
    evidenceGates?: unknown[];
    successFeeCompliance?: unknown[];
    connectorReadiness?: unknown[];
  } | null;
  metrics?: {
    pendingApprovals?: number | null;
    reviewRequiredDecisions?: number | null;
    interviewSchedulingNeeded?: number | null;
    interviewPreparationNeeded?: number | null;
    interviewOutcomesNeeded?: number | null;
    inboxResponseCandidates?: number | null;
    employerResponsesNeedingReply?: number | null;
    followUpsDue?: number | null;
    approvedFollowUpsReadyToSend?: number | null;
    followUpDeliveryReconciliation?: number | null;
    evidenceGates?: number | null;
    connectorReadiness?: number | null;
    openAdminReviews?: number | null;
  } | null;
  canReviewAdminItems?: boolean | null;
  readiness?: {
    blockers?: unknown[];
    warnings?: unknown[];
  } | null;
}

const APPROVAL_TYPE_LABELS: Record<string, string> = {
  application_submission: "Application submission",
  follow_up_send: "Follow-up send",
  offer_attribution: "Offer attribution",
  interview_schedule: "Interview schedule",
  billing_action: "Billing action",
  profile_claim: "Profile claim",
};

const DECISION_LABELS: Record<string, string> = {
  auto_apply: "Auto-apply",
  apply: "Apply",
  save: "Save",
  ignore: "Ignore",
  review: "Review",
  manual_apply: "Manual apply",
};

function coerceRisk(value?: string | null): ReviewQueueActionRisk {
  return value === "critical" || value === "high" || value === "medium" || value === "low"
    ? value
    : "medium";
}

function applicationRoute(applicationId?: number | null, action?: string, interviewId?: number | null) {
  if (!applicationId) return "/applications";
  const params = new URLSearchParams();
  params.set("applicationId", String(applicationId));
  if (action && action !== "view") {
    params.set("action", action);
  }
  if (action === "record-interview-outcome" && typeof interviewId === "number" && interviewId > 0) {
    params.set("interviewId", String(interviewId));
  }
  return `/applications?${params.toString()}`;
}

function approvalRoute(item: Record<string, unknown>) {
  const entityType = typeof item.entityType === "string" ? item.entityType : "";
  const entityId = typeof item.entityId === "number" ? item.entityId : null;
  const approvalType = typeof item.approvalType === "string" ? item.approvalType : "";

  if (entityType === "application" && entityId) {
    return applicationRoute(entityId, "view");
  }

  if (entityType === "follow_up" || approvalType === "follow_up_send") {
    const applicationId = typeof item.applicationId === "number" ? item.applicationId : null;
    return applicationRoute(applicationId, "send-follow-up");
  }

  if (approvalType === "offer_attribution") {
    const applicationId = typeof item.applicationId === "number" ? item.applicationId : null;
    return applicationId ? applicationRoute(applicationId, "view") : "/billing";
  }

  return "/review-queue";
}

export function getReviewQueueActionSummary(
  kind: ReviewQueueActionKind,
  item: Record<string, unknown> = {}
): ReviewQueueActionSummary {
  switch (kind) {
    case "approval": {
      return {
        copyId: "approval",
        route: approvalRoute(item),
        risk: coerceRisk(typeof item.riskLevel === "string" ? item.riskLevel : null),
        approvalGated: true,
        externalAction: "blocked_until_approved",
      };
    }
    case "send_handoff":
      return {
        copyId: "approved_delivery",
        route: applicationRoute(typeof item.applicationId === "number" ? item.applicationId : null, "send-follow-up"),
        risk: coerceRisk(typeof item.riskLevel === "string" ? item.riskLevel : "medium"),
        approvalGated: false,
        externalAction: "approved_delivery",
      };
    case "delivery_reconciliation":
      return {
        copyId: "delivery_reconciliation",
        route: applicationRoute(typeof item.applicationId === "number" ? item.applicationId : null, "send-follow-up"),
        risk: "high",
        approvalGated: false,
        externalAction: "delivery_reconciliation",
      };
    case "evidence_gate":
      return {
        copyId: "evidence_gate",
        ...(typeof item.detail === "string" ? { detailOverride: item.detail } : {}),
        route: typeof item.route === "string" ? item.route : "/profile",
        risk: coerceRisk(typeof item.severity === "string" ? item.severity : "medium"),
        approvalGated: false,
        externalAction: "blocked_until_evidence",
      };
    case "connector_readiness":
      return {
        copyId: "connector_readiness",
        ...(typeof item.detail === "string" ? { detailOverride: item.detail } : {}),
        route: "/profile",
        risk: coerceRisk(typeof item.riskLevel === "string" ? item.riskLevel : "medium"),
        approvalGated: false,
        externalAction: "none",
      };
    case "job_decision": {
      const decision = typeof item.decision === "string" ? item.decision : null;
      const applicationId = typeof item.applicationId === "number" ? item.applicationId : null;
      const reviewRequired = item.reviewRequired === 1 || item.reviewRequired === true;
      const externalAction = decision === "manual_apply"
        ? "manual_handoff"
        : reviewRequired || decision === "review"
          ? "blocked_until_approved"
          : "none";
      const context = applicationId ? "linked" : "unlinked";
      const copyId: ReviewQueueActionCopyId = externalAction === "manual_handoff"
        ? `job_decision_manual_${context}`
        : externalAction === "blocked_until_approved"
          ? `job_decision_blocked_${context}`
          : `job_decision_resolve_${context}`;
      return {
        copyId,
        route: applicationId ? applicationRoute(applicationId, "view") : "/jobs",
        risk: coerceRisk(typeof item.riskLevel === "string" ? item.riskLevel : "medium"),
        approvalGated: externalAction === "blocked_until_approved",
        externalAction,
      };
    }
    case "interview_scheduling":
      return {
        copyId: "interview_scheduling",
        route: applicationRoute(typeof item.applicationId === "number" ? item.applicationId : null, "schedule-interview"),
        risk: "medium",
        approvalGated: false,
        externalAction: "none",
      };
    case "interview_preparation":
      return {
        copyId: "interview_preparation",
        route: applicationRoute(typeof item.applicationId === "number" ? item.applicationId : null, "view"),
        risk: "low",
        approvalGated: false,
        externalAction: "none",
      };
    case "interview_outcome":
      return {
        copyId: "interview_outcome",
        route: applicationRoute(
          typeof item.applicationId === "number" ? item.applicationId : null,
          "record-interview-outcome",
          typeof item.interviewId === "number" ? item.interviewId : null
        ),
        risk: "medium",
        approvalGated: false,
        externalAction: "none",
      };
    case "inbox_response_candidate":
      return {
        copyId: "inbox_response_candidate",
        route: "/review-queue",
        risk: "medium",
        approvalGated: false,
        externalAction: "none",
      };
    case "employer_reply":
      return {
        copyId: "employer_reply",
        route: applicationRoute(typeof item.applicationId === "number" ? item.applicationId : null, "employer-response"),
        risk: "medium",
        approvalGated: false,
        externalAction: "none",
      };
    case "follow_up":
      return {
        copyId: "follow_up",
        route: applicationRoute(typeof item.applicationId === "number" ? item.applicationId : null, "follow-up"),
        risk: "medium",
        approvalGated: true,
        externalAction: "blocked_until_approved",
      };
    case "success_fee": {
      const applicationId = typeof item.applicationId === "number" ? item.applicationId : null;
      const priority = typeof item.priority === "string" ? item.priority : "high";
      return {
        copyId: applicationId ? "success_fee_ledger" : "success_fee_billing",
        route: applicationId ? applicationRoute(applicationId, "view") : "/billing",
        risk: coerceRisk(priority),
        approvalGated: true,
        externalAction: "blocked_until_approved",
      };
    }
    case "profile_gap":
      return {
        copyId: "profile_gap",
        route: "/profile",
        risk: "medium",
        approvalGated: false,
        externalAction: "none",
      };
    case "admin_review":
      return {
        copyId: item.category === "employment_ended" ? "admin_employment_ended" : "admin_review",
        route: "/admin",
        risk: coerceRisk(typeof item.priority === "string" ? item.priority : "high"),
        approvalGated: true,
        externalAction: "blocked_until_approved",
      };
  }
}

function titleCaseFromToken(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function controlSummary(input: {
  status: ReviewQueueControlStatus;
  copyId: ReviewQueueControlCopyId;
  section: ReviewQueueControlSection;
  route?: string;
  count: number;
  risk: ReviewQueueActionRisk;
  approvalGated: boolean;
  externalAction: ReviewQueueActionSummary["externalAction"];
}): ReviewQueueControlSummary {
  return {
    route: "/review-queue",
    ...input,
  };
}

export function formatApprovalType(type?: string | null) {
  if (!type) {
    return "Approval";
  }

  return APPROVAL_TYPE_LABELS[type] ?? titleCaseFromToken(type);
}

export function formatApplicationDecision(decision?: string | null) {
  if (!decision) {
    return "Review";
  }

  return DECISION_LABELS[decision] ?? titleCaseFromToken(decision);
}

export function getReviewRiskBadgeClass(riskLevel?: string | null) {
  switch (riskLevel) {
    case "critical":
      return "border-red-500/50 text-red-300";
    case "high":
      return "border-orange-500/50 text-orange-300";
    case "medium":
      return "border-amber-500/50 text-amber-300";
    case "low":
      return "border-emerald-500/50 text-emerald-300";
    default:
      return "border-slate-600 text-slate-300";
  }
}

export function getApprovalDecisionNote(
  approvalType: string | null | undefined,
  status: ApprovalResolutionStatus
) {
  const label = formatApprovalType(approvalType).toLowerCase();
  return `${status === "approved" ? "Approved" : "Rejected"} ${label} from the dashboard review queue.`;
}

export function getReviewDecisionResolutionCopy(
  decision: {
    jobId?: number | null;
    decision?: string | null;
    decisionReason?: string | null;
    reviewReason?: string | null;
    matchScore?: number | null;
  },
  resolution: ReviewDecisionResolution
) {
  const label = formatApplicationDecision(decision.decision).toLowerCase();
  const reason = decision.reviewReason || decision.decisionReason || "No review reason was stored.";
  const matchScore = typeof decision.matchScore === "number"
    ? ` Match score: ${decision.matchScore}%.`
    : "";
  const prefix = resolution === "save"
    ? "Saved from the review queue for later user review."
    : "Ignored from the review queue after user review.";

  return `${prefix} Previous decision: ${label}.${matchScore} Review context: ${reason}`;
}

export function getOperatingReviewQueueCounts(input?: OperatingReviewQueueInput | null) {
  const exactCount = (value: number | null | undefined, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
  const pendingApprovals = exactCount(input?.metrics?.pendingApprovals, input?.queues?.pendingApprovals?.length ?? 0);
  const reviewDecisions = exactCount(input?.metrics?.reviewRequiredDecisions, input?.queues?.reviewDecisions?.length ?? 0);
  const interviewScheduling = exactCount(input?.metrics?.interviewSchedulingNeeded, input?.queues?.interviewScheduling?.length ?? 0);
  const interviewPreparationNeeded = exactCount(input?.metrics?.interviewPreparationNeeded, input?.queues?.interviewPreparationNeeded?.length ?? 0);
  const interviewOutcomesNeeded = exactCount(input?.metrics?.interviewOutcomesNeeded, input?.queues?.interviewOutcomesNeeded?.length ?? 0);
  const inboxResponseCandidates = exactCount(input?.metrics?.inboxResponseCandidates, input?.queues?.inboxResponseCandidates?.length ?? 0);
  const employerResponsesNeedingReply = exactCount(input?.metrics?.employerResponsesNeedingReply, input?.queues?.employerResponsesNeedingReply?.length ?? 0);
  const followUpsDue = exactCount(input?.metrics?.followUpsDue, input?.queues?.followUpsDue?.length ?? 0);
  const approvedFollowUpsReadyToSend = exactCount(input?.metrics?.approvedFollowUpsReadyToSend, input?.queues?.approvedFollowUpsReadyToSend?.length ?? 0);
  const followUpDeliveryReconciliation = exactCount(input?.metrics?.followUpDeliveryReconciliation, input?.queues?.followUpDeliveryReconciliation?.length ?? 0);
  const evidenceGates = exactCount(input?.metrics?.evidenceGates, input?.queues?.evidenceGates?.length ?? 0);
  const successFeeCompliance = input?.queues?.successFeeCompliance?.length ?? 0;
  const connectorReadiness = exactCount(input?.metrics?.connectorReadiness, input?.queues?.connectorReadiness?.length ?? 0);
  const adminReviews = input?.canReviewAdminItems === true
    ? exactCount(input?.metrics?.openAdminReviews, input?.queues?.adminReviews?.length ?? 0)
    : 0;
  const profileBlockers = input?.readiness?.blockers?.length ?? 0;
  const profileWarnings = input?.readiness?.warnings?.length ?? 0;

  return {
    pendingApprovals,
    reviewDecisions,
    interviewScheduling,
    interviewPreparationNeeded,
    interviewOutcomesNeeded,
    inboxResponseCandidates,
    employerResponsesNeedingReply,
    followUpsDue,
    approvedFollowUpsReadyToSend,
    followUpDeliveryReconciliation,
    evidenceGates,
    successFeeCompliance,
    connectorReadiness,
    adminReviews,
    profileBlockers,
    profileWarnings,
    total: pendingApprovals + reviewDecisions + interviewScheduling + interviewPreparationNeeded + interviewOutcomesNeeded + inboxResponseCandidates + employerResponsesNeedingReply + followUpsDue + approvedFollowUpsReadyToSend + followUpDeliveryReconciliation + evidenceGates + successFeeCompliance + connectorReadiness + adminReviews + profileBlockers + profileWarnings,
  };
}

export function getReviewQueueControlSummary(
  input?: OperatingReviewQueueInput | null
): ReviewQueueControlSummary {
  const counts = getOperatingReviewQueueCounts(input);

  if (counts.pendingApprovals > 0) {
    return controlSummary({
      status: "blocked",
      copyId: "pending_approvals",
      section: "approvals",
      count: counts.pendingApprovals,
      risk: "high",
      approvalGated: true,
      externalAction: "blocked_until_approved",
    });
  }

  if (counts.followUpDeliveryReconciliation > 0) {
    return controlSummary({
      status: "blocked",
      copyId: "delivery_reconciliation",
      section: "delivery-reconciliation",
      count: counts.followUpDeliveryReconciliation,
      risk: "high",
      approvalGated: false,
      externalAction: "delivery_reconciliation",
    });
  }

  if (counts.approvedFollowUpsReadyToSend > 0) {
    return controlSummary({
      status: "handoff",
      copyId: "approved_delivery",
      section: "send-handoffs",
      count: counts.approvedFollowUpsReadyToSend,
      risk: "medium",
      approvalGated: false,
      externalAction: "approved_delivery",
    });
  }

  if (counts.successFeeCompliance > 0) {
    return controlSummary({
      status: "blocked",
      copyId: "success_fee_compliance",
      section: "success-fees",
      count: counts.successFeeCompliance,
      risk: "high",
      approvalGated: true,
      externalAction: "blocked_until_approved",
    });
  }

  if (counts.evidenceGates > 0) {
    return controlSummary({
      status: "blocked",
      copyId: "evidence_gates",
      section: "evidence-gates",
      route: "/profile",
      count: counts.evidenceGates,
      risk: "high",
      approvalGated: false,
      externalAction: "blocked_until_evidence",
    });
  }

  if (counts.adminReviews > 0) {
    return controlSummary({
      status: "blocked",
      copyId: "admin_reviews",
      section: "admin-reviews",
      count: counts.adminReviews,
      risk: "high",
      approvalGated: true,
      externalAction: "blocked_until_approved",
    });
  }

  if (counts.profileBlockers > 0) {
    return controlSummary({
      status: "blocked",
      copyId: "profile_blockers",
      section: "profile-readiness",
      route: "/profile",
      count: counts.profileBlockers,
      risk: "medium",
      approvalGated: false,
      externalAction: "none",
    });
  }

  if (counts.connectorReadiness > 0) {
    return controlSummary({
      status: "attention",
      copyId: "connector_readiness",
      section: "connector-readiness",
      route: "/profile",
      count: counts.connectorReadiness,
      risk: "medium",
      approvalGated: false,
      externalAction: "none",
    });
  }

  if (counts.inboxResponseCandidates > 0) {
    return controlSummary({
      status: "attention",
      copyId: "inbox_response_candidates",
      section: "inbox-response-candidates",
      count: counts.inboxResponseCandidates,
      risk: "medium",
      approvalGated: false,
      externalAction: "none",
    });
  }

  if (counts.employerResponsesNeedingReply > 0) {
    return controlSummary({
      status: "attention",
      copyId: "employer_replies",
      section: "employer-replies",
      count: counts.employerResponsesNeedingReply,
      risk: "medium",
      approvalGated: false,
      externalAction: "none",
    });
  }

  if (counts.interviewScheduling > 0) {
    return controlSummary({
      status: "attention",
      copyId: "interview_scheduling",
      section: "interview-scheduling",
      count: counts.interviewScheduling,
      risk: "medium",
      approvalGated: false,
      externalAction: "none",
    });
  }

  if (counts.interviewOutcomesNeeded > 0) {
    return controlSummary({
      status: "attention",
      copyId: "interview_outcomes",
      section: "interview-outcomes",
      count: counts.interviewOutcomesNeeded,
      risk: "medium",
      approvalGated: false,
      externalAction: "none",
    });
  }

  if (counts.followUpsDue > 0) {
    return controlSummary({
      status: "ready",
      copyId: "follow_up_drafting",
      section: "follow-ups",
      count: counts.followUpsDue,
      risk: "medium",
      approvalGated: true,
      externalAction: "blocked_until_approved",
    });
  }

  if (counts.reviewDecisions > 0) {
    return controlSummary({
      status: "attention",
      copyId: "job_decisions",
      section: "job-decisions",
      count: counts.reviewDecisions,
      risk: "medium",
      approvalGated: false,
      externalAction: "none",
    });
  }

  if (counts.interviewPreparationNeeded > 0) {
    return controlSummary({
      status: "ready",
      copyId: "interview_preparation",
      section: "interview-preparation",
      count: counts.interviewPreparationNeeded,
      risk: "low",
      approvalGated: false,
      externalAction: "none",
    });
  }

  if (counts.profileWarnings > 0) {
    return controlSummary({
      status: "attention",
      copyId: "profile_warnings",
      section: "profile-readiness",
      route: "/profile",
      count: counts.profileWarnings,
      risk: "low",
      approvalGated: false,
      externalAction: "none",
    });
  }

  return controlSummary({
    status: "clear",
    copyId: "queue_clear",
    section: "audit",
    count: 0,
    risk: "low",
    approvalGated: false,
    externalAction: "none",
  });
}
