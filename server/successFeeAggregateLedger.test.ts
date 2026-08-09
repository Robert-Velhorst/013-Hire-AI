import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getSuccessFeeComplianceSummary,
  getSuccessFeeComplianceSummaryFromAggregates,
} from "./successFeeCompliance";

describe("success-fee aggregate ledger", () => {
  it("preserves compliance summary semantics without hydrating fee history", () => {
    const now = new Date("2026-08-09T12:00:00Z");
    const fees = [
      { status: "active", nextVerificationDue: new Date("2026-08-08T12:00:00Z"), monthlyFeeAmount: 5000 },
      { status: "pending_verification", nextVerificationDue: new Date("2026-08-20T12:00:00Z"), monthlyFeeAmount: 4000 },
      { status: "disputed", nextVerificationDue: null, monthlyFeeAmount: 3000 },
    ];
    const hydrated = getSuccessFeeComplianceSummary(fees as any, [{ approval: { id: 1 } }], now);
    const aggregate = getSuccessFeeComplianceSummaryFromAggregates({
      activeFees: 2,
      suspendedFees: 0,
      pausedFees: 0,
      disputedFees: 1,
      pendingVerification: 1,
      overdueVerifications: 1,
      dueSoonVerifications: 1,
      monthlyFeeCents: 9000,
      nextVerificationDue: new Date("2026-08-08T12:00:00Z"),
    }, 1, now);
    expect(aggregate).toEqual(hydrated);
  });

  it("wires the operating ledger to exact aggregates and bounded action records", () => {
    const campaigns = readFileSync(resolve(process.cwd(), "server/applicationCampaigns.ts"), "utf8");
    expect(campaigns).toContain("getUserSuccessFeeSummary(userId)");
    expect(campaigns).toContain("getUserSuccessFeeOperatingItems(userId)");
    expect(campaigns).not.toContain("getUserSuccessFees(userId)");
    expect(campaigns).toContain("successFeeOperatingScope");
  });
});
