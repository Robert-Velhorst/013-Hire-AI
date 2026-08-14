import { describe, expect, it } from "vitest";
import { getAdminOperatingSummary } from "./adminOperatingSummary";
import { getAdminOperatingSummaryCopy } from "./adminOperatingCopy";

describe("admin operating summary", () => {
  it("prioritizes legal escalations as critical manual review", () => {
    const summary = getAdminOperatingSummary({
      stats: { monthlyRevenueUsd: 5000 },
      reviewQueue: [{ priority: "critical", category: "legal_escalation" }],
      overdue: [],
      pendingVerifications: [],
      payments: [],
    });

    expect(summary.status).toBe("critical");
    expect(summary.legalEscalations).toBe(1);
    expect(summary.presentationId).toBe("critical_legal");
    expect(getAdminOperatingSummaryCopy("en", summary).nextAction).toContain("legal escalation");
    expect(getAdminOperatingSummaryCopy("nl", summary).nextAction).toContain("juridische escalaties");
  });

  it("flags failed payments and grace-expired verification work", () => {
    const summary = getAdminOperatingSummary({
      overdue: [{ graceExpired: true, daysOverdue: 20 }],
      pendingVerifications: [],
      reviewQueue: [],
      payments: [{ status: "failed" }, { status: "paid" }],
    });

    expect(summary.status).toBe("critical");
    expect(summary.failedPayments).toBe(1);
    expect(summary.graceExpiredVerifications).toBe(1);
    expect(summary.totalOpenWork).toBe(2);
  });

  it("surfaces offer attribution before billing setup", () => {
    const summary = getAdminOperatingSummary({
      reviewQueue: [{ priority: "high", category: "offer_attribution" }],
      overdue: [],
      pendingVerifications: [],
      payments: [],
    });

    expect(summary.status).toBe("attention");
    expect(summary.offerAttributionReviews).toBe(1);
    expect(summary.presentationId).toBe("attention_offer");
  });

  it("surfaces employment-ended reports as high-risk final review", () => {
    const summary = getAdminOperatingSummary({
      reviewQueue: [{ priority: "medium", category: "employment_ended" }],
      overdue: [],
      pendingVerifications: [],
      payments: [],
    });

    expect(summary.status).toBe("attention");
    expect(summary.employmentEndedReviews).toBe(1);
    expect(summary.highRiskItems).toBe(1);
    expect(summary.presentationId).toBe("attention_employment_ended");
  });

  it("uses pending verifications as watch state", () => {
    const summary = getAdminOperatingSummary({
      pendingVerifications: [{ id: 1 }, { id: 2 }],
      reviewQueue: [],
      overdue: [],
      payments: [],
    });

    expect(summary.status).toBe("watch");
    expect(summary.pendingVerifications).toBe(2);
    expect(summary.totalOpenWork).toBe(2);
    expect(summary.presentationId).toBe("watch");
  });

  it("reports clear state when no admin work exists", () => {
    const summary = getAdminOperatingSummary({
      stats: { monthlyRevenueUsd: 1200 },
      pendingVerifications: [],
      reviewQueue: [],
      overdue: [],
      payments: [],
    });

    expect(summary.status).toBe("clear");
    expect(summary.totalOpenWork).toBe(0);
    expect(summary.monthlyRevenueUsd).toBe(1200);
    expect(summary.presentationId).toBe("clear");
  });
});
