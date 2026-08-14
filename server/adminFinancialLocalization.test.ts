import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatAdminFinancialCopy,
  getAdminFinancialCopy,
  getAdminFinancialStatusCopy,
} from "../client/src/lib/adminFinancialCopy";

describe("admin financial workflow localization", () => {
  it("presents stable financial controls and statuses in English and Dutch", () => {
    expect(getAdminFinancialCopy("nl", "allSuccessFees")).toBe("Alle succesvergoedingen");
    expect(getAdminFinancialCopy("nl", "confirmEscalation")).toBe("Escalatie bevestigen");
    expect(getAdminFinancialCopy("nl", "retentionPreview")).toBe("Voorbeeld van bewaring en wissing");
    expect(getAdminFinancialCopy("nl", "finalizeErasure")).toBe("Wissing afronden");
    expect(getAdminFinancialStatusCopy("nl", "pending_verification")).toBe("Openstaande verificatie");
    expect(getAdminFinancialStatusCopy("nl", "private_object_delete")).toBe("Priveobject verwijderen");
    expect(getAdminFinancialStatusCopy("nl", "provider_evidence")).toBe("provider evidence");
    expect(formatAdminFinancialCopy("nl", "daysCount", { count: 12 })).toBe("12 dagen");
  });

  it("wires locale presentation through the database-backed admin workflows", () => {
    const admin = readFileSync(resolve(process.cwd(), "client/src/pages/AdminPanel.tsx"), "utf8");

    expect(admin).toContain('fc("allSuccessFees")');
    expect(admin).toContain('fc("pendingVerificationReviews")');
    expect(admin).toContain('fc("operatingReviewQueue")');
    expect(admin).toContain('fc("paymentHistory")');
    expect(admin).toContain('fc("updateFeeStatus")');
    expect(admin).toContain('fc("legalEscalation")');
    expect(admin).toContain('fc("addAdminNote")');
    expect(admin).toContain('fc(reviewDialog.status === "resolved" ? "recordPrivacyReview" : "closePrivacyRequest")');
    expect(admin).toContain("getAdminReviewEvidenceSummary(item, locale)");
    expect(admin).toContain('fc("reviewEvidenceTitle")');
    expect(admin).toContain('fc("retentionPreview")');
    expect(admin).toContain('fc("externalCleanupConfirmation")');
    expect(admin).toContain('fc("databaseErasureConfirmation")');
    expect(admin).toContain('ff("actorVia"');
    expect(admin).toContain("statusLabel(fee.status)");
    expect(admin).toContain('locale === "nl" ? "nl-NL" : "en-US"');
    expect(admin).toContain('notes: ff("autoSuspendedNote"');
    expect(admin).toContain('notes: fc("rejectionEvidenceNote")');
    expect(admin).not.toContain(">All Success Fees<");
    expect(admin).not.toContain(">Pending Verification Reviews<");
    expect(admin).not.toContain(">Payment History<");
    expect(admin).not.toContain(">Update Fee Status<");
    expect(admin).not.toContain(">Flag for Legal Escalation<");
    expect(admin).not.toContain(">Resolve Review Item<");
    expect(admin).not.toContain(">Review Evidence<");
    expect(admin).not.toContain(">Retention and erasure preview<");
    expect(admin).not.toContain(">Linked application<");
    expect(admin).not.toContain(">Decision and policy<");
  });
});
