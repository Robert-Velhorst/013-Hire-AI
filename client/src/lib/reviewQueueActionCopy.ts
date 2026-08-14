import type { TranslationKey } from "@/contexts/LocaleContext";
import type { ReviewQueueActionCopyId, ReviewQueueActionSummary } from "./operatingReviewQueue";

export interface ReviewQueueActionCopyDefinition {
  label: TranslationKey;
  detail: TranslationKey;
  cta: TranslationKey;
}

const REVIEW_QUEUE_ACTION_COPY = {
  approval: { label: "controlApprovalLabel", detail: "actionApprovalDetail", cta: "actionOpenLinkedLedger" },
  approved_delivery: { label: "controlApprovedDeliveryLabel", detail: "actionApprovedDeliveryDetail", cta: "actionOpenDelivery" },
  delivery_reconciliation: { label: "controlDeliveryCheckLabel", detail: "actionDeliveryReconciliationDetail", cta: "actionVerifyDelivery" },
  evidence_gate: { label: "controlEvidenceLabel", detail: "actionEvidenceGateDetail", cta: "actionResolveEvidence" },
  connector_readiness: { label: "controlConnectorLabel", detail: "actionConnectorReadinessDetail", cta: "actionOpenProfileConnectors" },
  job_decision_manual_linked: { label: "controlJobDecisionLabel", detail: "actionJobDecisionManualDetail", cta: "actionOpenApplicationLedger" },
  job_decision_manual_unlinked: { label: "controlJobDecisionLabel", detail: "actionJobDecisionManualDetail", cta: "actionReviewJob" },
  job_decision_blocked_linked: { label: "controlJobDecisionLabel", detail: "actionJobDecisionBlockedDetail", cta: "actionOpenApplicationLedger" },
  job_decision_blocked_unlinked: { label: "controlJobDecisionLabel", detail: "actionJobDecisionBlockedDetail", cta: "actionReviewJob" },
  job_decision_resolve_linked: { label: "controlJobDecisionLabel", detail: "actionJobDecisionResolveDetail", cta: "actionOpenApplicationLedger" },
  job_decision_resolve_unlinked: { label: "controlJobDecisionLabel", detail: "actionJobDecisionResolveDetail", cta: "actionReviewJob" },
  interview_scheduling: { label: "controlInterviewScheduleLabel", detail: "actionInterviewSchedulingDetail", cta: "actionScheduleInterview" },
  interview_preparation: { label: "controlInterviewPrepLabel", detail: "actionInterviewPreparationDetail", cta: "actionOpenApplication" },
  interview_outcome: { label: "controlInterviewOutcomeLabel", detail: "actionInterviewOutcomeDetail", cta: "actionRecordOutcome" },
  inbox_response_candidate: { label: "controlInboxLabel", detail: "actionInboxResponseDetail", cta: "actionReviewInboxCandidate" },
  employer_reply: { label: "controlEmployerReplyLabel", detail: "actionEmployerReplyDetail", cta: "actionOpenResponse" },
  follow_up: { label: "reviewControlFollowUpLabel", detail: "actionFollowUpDetail", cta: "actionDraftFollowUp" },
  success_fee_ledger: { label: "controlSuccessFeeLabel", detail: "actionSuccessFeeDetail", cta: "actionOpenOfferLedger" },
  success_fee_billing: { label: "controlSuccessFeeLabel", detail: "actionSuccessFeeDetail", cta: "actionOpenBilling" },
  profile_gap: { label: "controlProfileBlockerLabel", detail: "actionProfileGapDetail", cta: "actionImproveProfile" },
  admin_employment_ended: { label: "controlAdminLabel", detail: "actionAdminEmploymentEndedDetail", cta: "actionOpenAdminPanel" },
  admin_review: { label: "controlAdminLabel", detail: "actionAdminReviewDetail", cta: "actionOpenAdminPanel" },
} satisfies Record<ReviewQueueActionCopyId, ReviewQueueActionCopyDefinition>;

export function getReviewQueueActionCopy(summary: ReviewQueueActionSummary) {
  return REVIEW_QUEUE_ACTION_COPY[summary.copyId];
}

const APPROVAL_TYPE_KEYS = {
  application_submission: "approvalTypeApplicationSubmission",
  follow_up_send: "approvalTypeFollowUpSend",
  offer_attribution: "approvalTypeOfferAttribution",
  interview_schedule: "approvalTypeInterviewSchedule",
  billing_action: "approvalTypeBillingAction",
  profile_claim: "approvalTypeProfileClaim",
} satisfies Record<string, TranslationKey>;

const DECISION_KEYS = {
  auto_apply: "decisionAutoApply",
  apply: "decisionApply",
  save: "decisionSave",
  ignore: "decisionIgnore",
  review: "decisionReview",
  manual_apply: "decisionManualApply",
} satisfies Record<string, TranslationKey>;

export function getApprovalTypeTranslationKey(value?: string | null) {
  return value ? APPROVAL_TYPE_KEYS[value as keyof typeof APPROVAL_TYPE_KEYS] ?? null : null;
}

export function getApplicationDecisionTranslationKey(value?: string | null) {
  return value ? DECISION_KEYS[value as keyof typeof DECISION_KEYS] ?? null : null;
}
