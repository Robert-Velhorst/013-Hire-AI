import { formatCalendarDate } from "./calendarDate";

export interface EmploymentEndFeeLike {
  id?: number | null;
  employerName?: string | null;
  jobTitle?: string | null;
  status?: string | null;
  stripeSubscriptionId?: string | null;
  nextVerificationDue?: Date | string | null;
}

export interface EmploymentEndReportResultLike {
  success?: boolean | null;
  status?: string | null;
  endedAt?: Date | string | null;
  stripeSubscriptionCancelled?: boolean | null;
  approvalId?: number | null;
}

export interface EmploymentEndControlSummary {
  canReport: boolean;
  label: string;
  headline: string;
  detail: string;
  risk: "medium" | "high";
  checkpoints: string[];
}

export interface EmploymentEndCompletionSummary {
  label: string;
  headline: string;
  detail: string;
  checkpoints: Array<{
    label: string;
    state: "complete" | "pending_review" | "not_required";
  }>;
}

const REPORTABLE_STATUSES = new Set(["active", "pending_verification"]);

function formatDate(value?: Date | string | null) {
  if (!value) return "Not recorded";
  return formatCalendarDate(value) || "Not recorded";
}

export function getEmploymentEndControlSummary(
  fee: EmploymentEndFeeLike | null | undefined,
  endDate?: Date | string | null
): EmploymentEndControlSummary {
  const canReport = REPORTABLE_STATUSES.has(fee?.status || "");
  const hasSubscription = Boolean(fee?.stripeSubscriptionId);
  const endDateLabel = formatDate(endDate);

  if (!canReport) {
    return {
      canReport: false,
      label: "Not reportable",
      headline: "This success-fee record is not open for employment-ended reporting.",
      detail: "Only active or pending-verification success-fee records can enter the employment-ended review flow.",
      risk: "medium",
      checkpoints: [
        "Success-fee status is active or pending verification.",
        "Employment end date is recorded.",
        "Final billing and verification review will be opened for admin review.",
      ],
    };
  }

  return {
    canReport: true,
    label: "Final obligation review",
    headline: "Report employment ended and open final billing review.",
    detail: hasSubscription
      ? `Hire.AI will record ${endDateLabel} only after Stripe confirms cancellation of the linked subscription, then send the closure package to admin review.`
      : `Hire.AI will record ${endDateLabel} as the employment end date and send the closure package to admin review.`,
    risk: hasSubscription ? "high" : "medium",
    checkpoints: [
      "Employment end date is explicitly recorded.",
      hasSubscription
        ? "Linked Stripe subscription cancellation must be confirmed before the local fee ledger changes."
        : "No linked Stripe subscription is recorded for cancellation.",
      "Success-fee status will move to ended.",
      "Audit event and admin review item will be created for final billing and verification context.",
    ],
  };
}

export function getEmploymentEndCompletionSummary(
  result: EmploymentEndReportResultLike | null | undefined
): EmploymentEndCompletionSummary {
  const subscriptionState = result?.stripeSubscriptionCancelled
    ? "complete"
    : "not_required";

  return {
    label: "Closure recorded",
    headline: "Employment-ended report is now in admin review.",
    detail: "Hire.AI recorded the end of employment, updated the success-fee ledger, and preserved the review trail for final billing closure.",
    checkpoints: [
      {
        label: "Success-fee record moved to ended.",
        state: result?.success ? "complete" : "pending_review",
      },
      {
        label: result?.stripeSubscriptionCancelled
          ? "Linked subscription cancellation completed."
          : "No linked subscription cancellation was required.",
        state: subscriptionState,
      },
      {
        label: "Billing approval and audit event were recorded.",
        state: result?.approvalId ? "complete" : "pending_review",
      },
      {
        label: "Admin review remains open for final billing and verification context.",
        state: result?.status === "pending_admin_review" ? "pending_review" : "complete",
      },
    ],
  };
}
