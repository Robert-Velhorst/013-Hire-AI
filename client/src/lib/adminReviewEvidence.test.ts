import { describe, expect, it } from "vitest";
import { getAdminReviewEvidenceSummary } from "./adminReviewEvidence";

describe("admin review evidence summary", () => {
  it("keeps application review evidence inside the admin panel", () => {
    const summary = getAdminReviewEvidenceSummary({
      category: "application_review",
      entityType: "application",
      entityId: 42,
      priority: "high",
    });

    expect(summary.label).toBe("Application proof");
    expect(summary.route).toBe("/admin");
    expect(summary.checklist).toContain("Claims made are supported by profile evidence.");
    expect(summary.requiresManualDecision).toBe(true);
  });

  it("raises offer attribution to high-risk billing proof", () => {
    const summary = getAdminReviewEvidenceSummary({
      category: "offer_attribution",
      entityType: "application",
      entityId: 7,
      priority: "low",
    });

    expect(summary.label).toBe("Offer attribution");
    expect(summary.risk).toBe("high");
    expect(summary.headline).toContain("success-fee billing");
    expect(summary.checklist).toEqual(expect.arrayContaining([
      "Offer can be traced to a Hire.AI-sourced application or follow-up.",
      "User consent and success-fee terms are auditable.",
    ]));
  });

  it("keeps legal escalation critical regardless of item priority", () => {
    const summary = getAdminReviewEvidenceSummary({
      category: "legal_escalation",
      entityType: "success_fee",
      entityId: 9,
      priority: "medium",
    });

    expect(summary.risk).toBe("critical");
    expect(summary.checklist).toContain("Terms acceptance and success-fee obligation are traceable.");
  });

  it("explains employment-ended proof as a final billing review", () => {
    const summary = getAdminReviewEvidenceSummary({
      category: "employment_ended",
      entityType: "success_fee",
      entityId: 31,
      priority: "medium",
    });

    expect(summary.label).toBe("Employment end proof");
    expect(summary.risk).toBe("high");
    expect(summary.headline).toContain("closing success-fee obligations");
    expect(summary.checklist).toEqual(expect.arrayContaining([
      "Stripe subscription cancellation state is visible.",
      "Audit event links the user report to admin review.",
    ]));
  });

  it("keeps privacy deletion as a high-risk decision without claiming erasure", () => {
    const summary = getAdminReviewEvidenceSummary({
      category: "privacy_deletion",
      entityType: "user",
      entityId: 81,
      priority: "medium",
    });

    expect(summary.label).toBe("Privacy deletion review");
    expect(summary.risk).toBe("high");
    expect(summary.detail).toContain("does not delete account data");
    expect(summary.checklist).toContain(
      "Record the retention basis and the separate execution work still required."
    );
  });

  it("falls back to generic linked-record review copy", () => {
    const summary = getAdminReviewEvidenceSummary({
      category: "unknown",
      description: "Review custom queue item.",
    });

    expect(summary.label).toBe("Review evidence");
    expect(summary.detail).toBe("Review custom queue item.");
    expect(summary.route).toBe("/admin");
  });

  it("localizes generated policy guidance while preserving recorded descriptions", () => {
    const privacy = getAdminReviewEvidenceSummary({
      category: "privacy_deletion",
      entityType: "user",
      entityId: 81,
      priority: "medium",
    }, "nl");
    const custom = getAdminReviewEvidenceSummary({
      category: "custom",
      description: "Provider evidence remains verbatim.",
    }, "nl");

    expect(privacy.label).toBe("Beoordeling privacyverwijdering");
    expect(privacy.headline).toContain("gedocumenteerde bewaarplicht");
    expect(privacy.risk).toBe("high");
    expect(custom.label).toBe("Beoordelingsbewijs");
    expect(custom.detail).toBe("Provider evidence remains verbatim.");
  });
});
