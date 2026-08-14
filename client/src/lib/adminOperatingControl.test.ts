import { describe, expect, it } from "vitest";
import { getAdminOperatingControlAction } from "./adminOperatingControl";
import { getAdminOperatingActionCopy } from "./adminOperatingCopy";
import type { AdminOperatingSummary } from "./adminOperatingSummary";

const baseSummary: AdminOperatingSummary = {
  status: "clear",
  presentationId: "clear",
  totalOpenWork: 0,
  criticalItems: 0,
  highRiskItems: 0,
  overdueVerifications: 0,
  graceExpiredVerifications: 0,
  pendingVerifications: 0,
  failedPayments: 0,
  legalEscalations: 0,
  offerAttributionReviews: 0,
  employmentEndedReviews: 0,
  monthlyRevenueUsd: 0,
};

function summary(overrides: Partial<AdminOperatingSummary>): AdminOperatingSummary {
  return { ...baseSummary, ...overrides };
}

describe("admin operating control", () => {
  it("prioritizes legal escalation above other admin work", () => {
    const action = getAdminOperatingControlAction(summary({
      legalEscalations: 1,
      failedPayments: 2,
      totalOpenWork: 3,
    }));

    expect(action.id).toBe("review_legal");
    expect(action.tab).toBe("review");
    expect(action.risk).toBe("critical");
    expect(action.approvalGated).toBe(true);
    expect(action.count).toBe(1);
    expect(getAdminOperatingActionCopy("en", action).headline).toContain("1 legal escalation requires");
    expect(getAdminOperatingActionCopy("nl", action).headline).toContain("1 juridische escalatie vereist");
  });

  it("routes failed payments to the payments tab without taking billing action", () => {
    const action = getAdminOperatingControlAction(summary({
      failedPayments: 2,
      totalOpenWork: 2,
    }));

    expect(action.id).toBe("review_failed_payments");
    expect(action.tab).toBe("payments");
    expect(getAdminOperatingActionCopy("en", action).cta).toBe("Open payments");
    expect(getAdminOperatingActionCopy("nl", action).cta).toBe("Betalingen openen");
    expect(action.approvalGated).toBe(true);
  });

  it("keeps grace-expired verification work gated and routed to overdue", () => {
    const action = getAdminOperatingControlAction(summary({
      graceExpiredVerifications: 1,
      overdueVerifications: 4,
      totalOpenWork: 4,
    }));

    expect(action.id).toBe("review_grace_expired_verifications");
    expect(action.tab).toBe("overdue");
    expect(getAdminOperatingActionCopy("en", action).detail).toContain("before suspension");
  });

  it("routes offer attribution review before billing setup", () => {
    const action = getAdminOperatingControlAction(summary({
      offerAttributionReviews: 3,
      totalOpenWork: 3,
    }));

    expect(action.id).toBe("review_offer_attribution");
    expect(action.tab).toBe("review");
    expect(getAdminOperatingActionCopy("en", action).detail).toContain("before any success-fee");
  });

  it("routes employment-ended reports to final obligation review", () => {
    const action = getAdminOperatingControlAction(summary({
      employmentEndedReviews: 2,
      totalOpenWork: 2,
    }));

    expect(action.id).toBe("review_employment_ended");
    expect(action.tab).toBe("review");
    expect(action.risk).toBe("high");
    expect(getAdminOperatingActionCopy("en", action).detail).toContain("subscription cancellation");
  });

  it("uses pending verifications when no higher-risk item exists", () => {
    const action = getAdminOperatingControlAction(summary({
      pendingVerifications: 5,
      totalOpenWork: 5,
    }));

    expect(action.id).toBe("review_pending_verifications");
    expect(action.tab).toBe("verifications");
    expect(action.risk).toBe("medium");
  });

  it("returns a monitor action when the queue is clear", () => {
    const action = getAdminOperatingControlAction(baseSummary);

    expect(action.id).toBe("monitor");
    expect(action.tab).toBe("overview");
    expect(action.approvalGated).toBe(false);
  });

  it("uses singular copy for one generic review item", () => {
    const action = getAdminOperatingControlAction(summary({
      totalOpenWork: 1,
    }));

    expect(action.id).toBe("open_review_queue");
    expect(getAdminOperatingActionCopy("en", action).headline).toContain("1 admin item is waiting");
  });
});
