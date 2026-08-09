import { describe, expect, it } from "vitest";
import {
  formatApplicationDecision,
  formatApprovalType,
  getApprovalDecisionNote,
  getOperatingReviewQueueCounts,
  getReviewQueueControlSummary,
  getReviewQueueActionSummary,
  getReviewDecisionResolutionCopy,
  getReviewRiskBadgeClass,
} from "./operatingReviewQueue";

describe("operating review queue helpers", () => {
  it("formats known approval and decision types", () => {
    expect(formatApprovalType("application_submission")).toBe("Application submission");
    expect(formatApprovalType("follow_up_send")).toBe("Follow-up send");
    expect(formatApplicationDecision("manual_apply")).toBe("Manual apply");
  });

  it("falls back to readable labels for unknown tokens", () => {
    expect(formatApprovalType("custom_screening_answer")).toBe("Custom Screening Answer");
    expect(formatApplicationDecision("needs_recruiter_note")).toBe("Needs Recruiter Note");
  });

  it("maps risk levels to stable badge tones", () => {
    expect(getReviewRiskBadgeClass("critical")).toContain("red");
    expect(getReviewRiskBadgeClass("high")).toContain("orange");
    expect(getReviewRiskBadgeClass("medium")).toContain("amber");
    expect(getReviewRiskBadgeClass("low")).toContain("emerald");
    expect(getReviewRiskBadgeClass(null)).toContain("slate");
  });

  it("creates explicit dashboard approval audit notes", () => {
    expect(getApprovalDecisionNote("offer_attribution", "approved")).toBe(
      "Approved offer attribution from the dashboard review queue."
    );
    expect(getApprovalDecisionNote("billing_action", "rejected")).toBe(
      "Rejected billing action from the dashboard review queue."
    );
  });

  it("creates auditable review decision resolution notes", () => {
    expect(getReviewDecisionResolutionCopy({
      decision: "manual_apply",
      reviewReason: "External ATS requires a tailored answer.",
      matchScore: 86,
    }, "save")).toBe(
      "Saved from the review queue for later user review. Previous decision: manual apply. Match score: 86%. Review context: External ATS requires a tailored answer."
    );

    expect(getReviewDecisionResolutionCopy({
      decision: "review",
      decisionReason: "Company duplicate needs inspection.",
    }, "ignore")).toBe(
      "Ignored from the review queue after user review. Previous decision: review. Review context: Company duplicate needs inspection."
    );
  });

  it("summarizes all operating review queue sources", () => {
    expect(getOperatingReviewQueueCounts({
      queues: {
        pendingApprovals: [{ id: 1 }, { id: 2 }],
        reviewDecisions: [{ id: 3 }],
        adminReviews: [{ id: 4 }],
        interviewScheduling: [{ applicationId: 5 }],
        interviewPreparationNeeded: [{ applicationId: 9 }],
        interviewOutcomesNeeded: [{ applicationId: 10 }],
        inboxResponseCandidates: [{ id: 11 }],
        employerResponsesNeedingReply: [{ applicationId: 6 }],
        followUpsDue: [{ applicationId: 7 }],
        approvedFollowUpsReadyToSend: [{ followUpId: 8 }],
        followUpDeliveryReconciliation: [{ followUpId: 12 }],
        evidenceGates: [{ id: "profile-core-evidence" }],
        successFeeCompliance: [{ successFeeId: 9 }],
        connectorReadiness: [{ id: "gmail" }],
      },
      readiness: {
        blockers: [{ key: "resume" }],
        warnings: [{ key: "salary" }, { key: "links" }],
      },
    })).toEqual({
      pendingApprovals: 2,
      reviewDecisions: 1,
      interviewScheduling: 1,
      interviewPreparationNeeded: 1,
      interviewOutcomesNeeded: 1,
      inboxResponseCandidates: 1,
      employerResponsesNeedingReply: 1,
      followUpsDue: 1,
      approvedFollowUpsReadyToSend: 1,
      followUpDeliveryReconciliation: 1,
      evidenceGates: 1,
      successFeeCompliance: 1,
      connectorReadiness: 1,
      adminReviews: 0,
      profileBlockers: 1,
      profileWarnings: 2,
      total: 17,
    });
  });

  it("only counts admin reviews for admin-capable ledgers", () => {
    expect(getOperatingReviewQueueCounts({
      canReviewAdminItems: false,
      queues: {
        adminReviews: [{ id: 1 }],
      },
    }).adminReviews).toBe(0);

    expect(getOperatingReviewQueueCounts({
      canReviewAdminItems: true,
      queues: {
        adminReviews: [{ id: 1 }],
      },
    }).adminReviews).toBe(1);
  });

  it("describes approval gates as blocked external actions with linked ledger routes", () => {
    expect(getReviewQueueActionSummary("approval", {
      approvalType: "application_submission",
      entityType: "application",
      entityId: 42,
      riskLevel: "high",
    })).toMatchObject({
      label: "Approval gate",
      cta: "Open linked ledger",
      route: "/applications?applicationId=42",
      risk: "high",
      approvalGated: true,
      externalAction: "blocked_until_approved",
    });
  });

  it("routes approved follow-up handoffs back to the application ledger", () => {
    expect(getReviewQueueActionSummary("send_handoff", {
      applicationId: 7,
      riskLevel: "medium",
    })).toMatchObject({
      label: "Approved delivery",
      cta: "Open delivery",
      route: "/applications?applicationId=7&action=send-follow-up",
      approvalGated: false,
      externalAction: "approved_delivery",
    });
  });

  it("routes review-required job decisions to the linked application ledger when available", () => {
    expect(getReviewQueueActionSummary("job_decision", {
      applicationId: 42,
      decision: "review",
      reviewRequired: 1,
      riskLevel: "high",
    })).toMatchObject({
      cta: "Open application ledger",
      route: "/applications?applicationId=42",
      risk: "high",
      approvalGated: true,
      externalAction: "blocked_until_approved",
    });
  });

  it("keeps manual-apply decisions as manual handoffs without claiming silent execution", () => {
    expect(getReviewQueueActionSummary("job_decision", {
      decision: "manual_apply",
      riskLevel: "medium",
    })).toMatchObject({
      cta: "Review job",
      route: "/jobs",
      approvalGated: false,
      externalAction: "manual_handoff",
    });
  });

  it("keeps follow-up drafting approval-gated", () => {
    expect(getReviewQueueActionSummary("follow_up", {
      applicationId: 9,
    })).toMatchObject({
      label: "Follow-up due",
      cta: "Draft follow-up",
      route: "/applications?applicationId=9&action=follow-up",
      risk: "medium",
      approvalGated: true,
      externalAction: "blocked_until_approved",
    });
  });

  it("uses exact ledger metrics when rendered queues are bounded", () => {
    const counts = getOperatingReviewQueueCounts({
      metrics: {
        pendingApprovals: 105,
        inboxResponseCandidates: 103,
        followUpsDue: 12,
      },
      queues: {
        pendingApprovals: Array.from({ length: 5 }),
        inboxResponseCandidates: Array.from({ length: 5 }),
        followUpsDue: Array.from({ length: 5 }),
      },
    });

    expect(counts).toMatchObject({
      pendingApprovals: 105,
      inboxResponseCandidates: 103,
      followUpsDue: 12,
      total: 220,
    });
  });

  it("blocks the queue on uncertain mailbox delivery before a new send handoff", () => {
    const summary = getReviewQueueControlSummary({
      queues: {
        followUpDeliveryReconciliation: [{ followUpId: 8 }],
        approvedFollowUpsReadyToSend: [{ followUpId: 9 }],
      },
    });

    expect(summary).toMatchObject({
      status: "blocked",
      label: "Delivery verification",
      section: "delivery-reconciliation",
      risk: "high",
      externalAction: "delivery_reconciliation",
    });
  });

  it("routes interview outcome work to the exact completed interview", () => {
    expect(getReviewQueueActionSummary("interview_outcome", {
      applicationId: 9,
      interviewId: 17,
    })).toMatchObject({
      label: "Interview outcome",
      cta: "Record outcome",
      route: "/applications?applicationId=9&action=record-interview-outcome&interviewId=17",
      risk: "medium",
      approvalGated: false,
      externalAction: "none",
    });
  });

  it("keeps inbox response candidates internal until the user confirms their classification", () => {
    expect(getReviewQueueActionSummary("inbox_response_candidate", {
      applicationId: 9,
      suggestedResponseType: "interview_invite",
    })).toMatchObject({
      label: "Inbox response candidate",
      cta: "Review inbox candidate",
      route: "/review-queue",
      risk: "medium",
      approvalGated: false,
      externalAction: "none",
    });
  });

  it("routes connector readiness to profile evidence without external side effects", () => {
    expect(getReviewQueueActionSummary("connector_readiness", {
      id: "inbox-response-monitoring",
      label: "Inbox response monitoring",
      detail: "Connect Gmail or Outlook before monitoring replies.",
      riskLevel: "medium",
    })).toMatchObject({
      label: "Connector readiness",
      cta: "Open profile connectors",
      route: "/profile",
      risk: "medium",
      approvalGated: false,
      externalAction: "none",
    });
  });

  it("describes evidence gates as evidence-blocked external work", () => {
    expect(getReviewQueueActionSummary("evidence_gate", {
      id: "profile-core-evidence",
      label: "Evidence blocked",
      detail: "Add resume and work evidence before application submission can run.",
      severity: "high",
      route: "/profile",
    })).toMatchObject({
      label: "Evidence gate",
      cta: "Resolve evidence",
      route: "/profile",
      risk: "high",
      approvalGated: false,
      externalAction: "blocked_until_evidence",
    });
  });

  it("routes success-fee compliance by available ledger context", () => {
    expect(getReviewQueueActionSummary("success_fee", {
      applicationId: 11,
      priority: "critical",
    })).toMatchObject({
      route: "/applications?applicationId=11",
      cta: "Open offer ledger",
      risk: "critical",
    });

    expect(getReviewQueueActionSummary("success_fee", {
      priority: "high",
    })).toMatchObject({
      route: "/billing",
      cta: "Open billing",
      risk: "high",
    });
  });

  it("prioritizes pending approvals as the top review queue control", () => {
    const summary = getReviewQueueControlSummary({
      queues: {
        pendingApprovals: [{ id: 1 }],
        approvedFollowUpsReadyToSend: [{ followUpId: 2 }],
        successFeeCompliance: [{ type: "offer_attribution" }],
      },
    });

    expect(summary).toMatchObject({
      status: "blocked",
      label: "Approval gate",
      section: "approvals",
      risk: "high",
      approvalGated: true,
      externalAction: "blocked_until_approved",
    });
  });

  it("surfaces approved follow-up handoffs before routine drafting", () => {
    const summary = getReviewQueueControlSummary({
      queues: {
        approvedFollowUpsReadyToSend: [{ followUpId: 2 }],
        followUpsDue: [{ applicationId: 3 }],
      },
    });

    expect(summary).toMatchObject({
      status: "handoff",
      section: "send-handoffs",
      externalAction: "approved_delivery",
      approvalGated: false,
    });
  });

  it("surfaces evidence gates before connector setup and lower-priority queue work", () => {
    const summary = getReviewQueueControlSummary({
      queues: {
        evidenceGates: [{ id: "profile-core-evidence" }],
        connectorReadiness: [{ id: "gmail" }],
        followUpsDue: [{ applicationId: 3 }],
      },
    });

    expect(summary).toMatchObject({
      status: "blocked",
      section: "evidence-gates",
      count: 1,
      approvalGated: false,
      externalAction: "blocked_until_evidence",
    });
  });

  it("surfaces persisted inbox candidates before employer-reply drafting", () => {
    const summary = getReviewQueueControlSummary({
      queues: {
        inboxResponseCandidates: [{ id: 5 }],
        employerResponsesNeedingReply: [{ applicationId: 3 }],
      },
    });

    expect(summary).toMatchObject({
      status: "attention",
      section: "inbox-response-candidates",
      count: 1,
      approvalGated: false,
      externalAction: "none",
    });
  });

  it("keeps admin review count hidden from non-admin control state", () => {
    const nonAdmin = getReviewQueueControlSummary({
      canReviewAdminItems: false,
      queues: {
        adminReviews: [{ id: 1 }],
      },
    });
    const admin = getReviewQueueControlSummary({
      canReviewAdminItems: true,
      queues: {
        adminReviews: [{ id: 1 }],
      },
    });

    expect(nonAdmin.status).toBe("clear");
    expect(admin).toMatchObject({
      status: "blocked",
      section: "admin-reviews",
      approvalGated: true,
    });
  });

  it("describes employment-ended admin reviews as billing and verification control work", () => {
    expect(getReviewQueueActionSummary("admin_review", {
      category: "employment_ended",
      priority: "high",
    })).toMatchObject({
      label: "Admin review",
      route: "/admin",
      risk: "high",
      approvalGated: true,
      externalAction: "blocked_until_approved",
    });
    expect(getReviewQueueActionSummary("admin_review", {
      category: "employment_ended",
    }).detail).toContain("subscription cancellation");
  });

  it("surfaces connector readiness before lower-priority queue work", () => {
    const summary = getReviewQueueControlSummary({
      queues: {
        connectorReadiness: [{ id: "gmail" }],
        followUpsDue: [{ applicationId: 3 }],
      },
    });

    expect(summary).toMatchObject({
      status: "attention",
      section: "connector-readiness",
      count: 1,
      approvalGated: false,
      externalAction: "none",
    });
  });

  it("returns clear audit control when no queue work exists", () => {
    const summary = getReviewQueueControlSummary({
      queues: {},
      readiness: { blockers: [], warnings: [] },
    });

    expect(summary).toMatchObject({
      status: "clear",
      section: "audit",
      count: 0,
      approvalGated: false,
    });
  });
});
