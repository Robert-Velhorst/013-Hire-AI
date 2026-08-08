export interface AdminReviewEvidenceItemLike {
  category?: string | null;
  entityType?: string | null;
  entityId?: number | null;
  priority?: string | null;
  description?: string | null;
}

export interface AdminReviewEvidenceSummary {
  label: string;
  headline: string;
  detail: string;
  checklist: string[];
  route: string;
  risk: "low" | "medium" | "high" | "critical";
  requiresManualDecision: boolean;
}

function coerceRisk(value?: string | null): AdminReviewEvidenceSummary["risk"] {
  if (value === "critical" || value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return "medium";
}

function entityRoute(item: AdminReviewEvidenceItemLike) {
  if (item.entityType === "application" && typeof item.entityId === "number") return "/admin";
  if (item.entityType === "success_fee") return "/admin";
  if (item.entityType === "verification") return "/admin";
  return "/admin";
}

export function getAdminReviewEvidenceSummary(
  item: AdminReviewEvidenceItemLike
): AdminReviewEvidenceSummary {
  const risk = coerceRisk(item.priority);
  const route = entityRoute(item);

  switch (item.category) {
    case "application_review":
      return {
        label: "Application proof",
        headline: "Review application materials before any external action.",
        detail: "Confirm the application ledger has supported claims, prepared material, user approval state, and no unsupported submission claim.",
        checklist: [
          "Prepared resume or material source is visible.",
          "Claims made are supported by profile evidence.",
          "Submission approval is pending or explicitly decided.",
          "Audit trail confirms no external submission was performed prematurely.",
        ],
        route,
        risk,
        requiresManualDecision: true,
      };
    case "submission_evidence":
      return {
        label: "Submission evidence",
        headline: "Verify deterministic proof before marking an application submitted.",
        detail: "Check portal, ATS, or email confirmation details before accepting submission evidence.",
        checklist: [
          "Confirmation source and timestamp are captured.",
          "Confirmation URL or text identifies the employer/application.",
          "Application status matches the proof.",
          "Audit event records the evidence decision.",
        ],
        route,
        risk,
        requiresManualDecision: true,
      };
    case "employer_response":
      return {
        label: "Employer response",
        headline: "Classify the employer reply and route the next application step.",
        detail: "Separate interview invites, employer questions, rejections, and offers before follow-up automation continues.",
        checklist: [
          "Response source is recorded.",
          "Response type matches the message content.",
          "Interview or offer workflows are queued when relevant.",
          "Routine follow-ups are suppressed when a direct reply needs handling.",
        ],
        route,
        risk,
        requiresManualDecision: true,
      };
    case "offer_attribution":
      return {
        label: "Offer attribution",
        headline: "Confirm Hire.AI attribution before success-fee billing.",
        detail: "Review application, response, interview, and offer evidence before creating or approving billing obligations.",
        checklist: [
          "Offer proof is present and readable.",
          "Offer can be traced to a Hire.AI-sourced application or follow-up.",
          "Salary and start-date evidence support fee terms.",
          "User consent and success-fee terms are auditable.",
        ],
        route,
        risk: risk === "low" ? "high" : risk,
        requiresManualDecision: true,
      };
    case "verification_overdue":
      return {
        label: "Verification overdue",
        headline: "Review employment verification before suspension or escalation.",
        detail: "Use due dates, grace windows, prior proof, and account context before any enforcement action.",
        checklist: [
          "Next verification due date and grace expiry are known.",
          "Recent verification submissions were checked.",
          "Account reminders or notes were reviewed.",
          "Suspension or escalation decision is recorded with rationale.",
        ],
        route,
        risk,
        requiresManualDecision: true,
      };
    case "payment_failed":
      return {
        label: "Payment evidence",
        headline: "Review failed payment context before changing billing state.",
        detail: "Inspect payment status, subscription state, and admin notes before pausing, suspending, or escalating.",
        checklist: [
          "Failed payment record and period are visible.",
          "Subscription state is checked.",
          "User account status is reviewed.",
          "Billing action has an admin rationale.",
        ],
        route,
        risk,
        requiresManualDecision: true,
      };
    case "legal_escalation":
      return {
        label: "Legal evidence",
        headline: "Confirm the full audit package before legal escalation.",
        detail: "Legal escalation should only proceed after reviewing ToS acceptance, billing records, verification history, and prior admin actions.",
        checklist: [
          "Terms acceptance and success-fee obligation are traceable.",
          "Billing, payment, and verification records were reviewed.",
          "Prior warnings, notes, and account actions are visible.",
          "Escalation rationale is documented by an admin.",
        ],
        route,
        risk: "critical",
        requiresManualDecision: true,
      };
    case "employment_ended":
      return {
        label: "Employment end proof",
        headline: "Review employment-ended report before closing success-fee obligations.",
        detail: "Check end date, subscription cancellation, final billing, and employment verification context before resolving the obligation.",
        checklist: [
          "Reported end date is plausible and recorded.",
          "Stripe subscription cancellation state is visible.",
          "Final billing period and payment records were checked.",
          "Audit event links the user report to admin review.",
        ],
        route,
        risk: risk === "low" || risk === "medium" ? "high" : risk,
        requiresManualDecision: true,
      };
    case "privacy_deletion":
      return {
        label: "Privacy deletion review",
        headline: "Decide what can be erased and what must remain under a documented hold.",
        detail: "Resolving this review records an operator decision only. It does not delete account data or override active billing, dispute, verification, or legal retention obligations.",
        checklist: [
          "Confirm the request belongs to the account holder.",
          "Review active billing, employment, dispute, and legal-hold records.",
          "Identify provider grants and private files eligible for revocation or deletion.",
          "Record the retention basis and the separate execution work still required.",
        ],
        route,
        risk: "high",
        requiresManualDecision: true,
      };
    default:
      return {
        label: "Review evidence",
        headline: "Inspect linked records before closing this admin item.",
        detail: item.description || "Use the linked entity, audit history, and available notes before resolving or dismissing this item.",
        checklist: [
          "Linked entity record was inspected.",
          "Relevant audit events were checked.",
          "Resolution note explains the decision.",
        ],
        route,
        risk,
        requiresManualDecision: true,
      };
  }
}
