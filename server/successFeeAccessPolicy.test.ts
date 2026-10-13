import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { successFeesRouter } from "./routers/successFees";

function createContext(tosAcceptedAt: Date | null = null): TrpcContext {
  return {
    user: {
      id: 99401,
      openId: "success-fee-no-terms",
      name: "No Terms User",
      email: "no-terms@example.local",
      loginMethod: "test",
      role: "user",
      stripeCustomerId: null,
      accountStatus: "active",
      tosAcceptedAt,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("success-fee access policy", () => {
  it("blocks billing, proof, and employment-status mutations until terms are accepted", async () => {
    const caller = successFeesRouter.createCaller(createContext());
    const actions = [
      () => caller.reportHire({ employerName: "Example", jobTitle: "Engineer", monthlySalary: 5000, currency: "USD", startDate: "2026-07-13", offerLetterBase64: "cHJvb2Y=", offerLetterMimeType: "application/pdf", offerLetterFileName: "offer.pdf", termsAccepted: true }),
      () => caller.retryBillingCheckout({ successFeeId: 1, confirmBillingSetup: true }),
      () => caller.submitVerification({ successFeeId: 1, documentBase64: "cHJvb2Y=", documentMimeType: "application/pdf", documentFileName: "proof.pdf", documentType: "employment_letter" }),
      () => caller.reportEmploymentEnded({ successFeeId: 1, endDate: "2026-07-13T00:00:00.000Z" }),
    ];

    for (const action of actions) {
      await expect(action()).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("Accept the Terms of Service") });
    }
  });

  it("rejects an invalid hire start date before any proof or billing work", async () => {
    const caller = successFeesRouter.createCaller(createContext(new Date()));

    await expect(caller.reportHire({
      employerName: "Example",
      jobTitle: "Engineer",
      monthlySalary: 5000,
      currency: "USD",
      startDate: "2026-02-30",
      offerLetterBase64: "proof",
      offerLetterMimeType: "application/pdf",
      offerLetterFileName: "offer.pdf",
      termsAccepted: true,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
