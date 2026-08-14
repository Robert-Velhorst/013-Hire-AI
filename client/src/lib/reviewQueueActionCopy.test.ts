import { describe, expect, it } from "vitest";
import { translate } from "@/contexts/LocaleContext";
import { getReviewQueueActionCopy } from "./reviewQueueActionCopy";
import { getReviewQueueActionSummary } from "./operatingReviewQueue";

describe("review queue action copy", () => {
  it("resolves structured action variants to localized presentation keys", () => {
    const summary = getReviewQueueActionSummary("job_decision", {
      applicationId: 42,
      decision: "review",
      reviewRequired: true,
    });
    const copy = getReviewQueueActionCopy(summary);

    expect(summary.copyId).toBe("job_decision_blocked_linked");
    expect(translate("nl", copy.label)).toBe("Vacaturebesluit");
    expect(translate("nl", copy.detail)).toContain("autonome uitvoering");
    expect(translate("nl", copy.cta)).toBe("Sollicitatieregister openen");
  });

  it("keeps recorded evidence detail separate from localized fallback copy", () => {
    const summary = getReviewQueueActionSummary("evidence_gate", {
      detail: "Recorded provider evidence remains verbatim.",
    });

    expect(summary.detailOverride).toBe("Recorded provider evidence remains verbatim.");
    expect(translate("nl", getReviewQueueActionCopy(summary).detail)).toContain("bewijs");
  });
});
