import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { successFeesRouter } from "./routers/successFees";

const mocks = vi.hoisted(() => {
  const selectLimit = vi.fn();
  const selectOrderLimit = vi.fn();
  const storagePut = vi.fn();
  const dismissOfferAttributionAdminReviews = vi.fn();
  const insertResult = [{ insertId: 88 }];
  const returningId = vi.fn().mockResolvedValue([{ id: 77 }]);
  Object.assign(insertResult, {
    $returningId: returningId,
  });
  const mockDb = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: selectLimit,
          orderBy: vi.fn(() => ({
            limit: selectOrderLimit,
          })),
        })),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn(() => insertResult) })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ affectedRows: 1 }]) })),
    })),
  };
  const stripe = {
    customers: { create: vi.fn() },
    products: { create: vi.fn().mockResolvedValue({ id: "prod_test" }) },
    prices: { create: vi.fn().mockResolvedValue({ id: "price_test" }) },
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({ id: "cs_test", url: "https://checkout.stripe.com/c/pay/cs_test" }),
        retrieve: vi.fn(),
      },
    },
  };

  return {
    mockDb,
    selectLimit,
    selectOrderLimit,
    storagePut,
    storageDelete: vi.fn(),
    returningId,
    getDb: vi.fn(),
    createAdminReviewItem: vi.fn(),
    createAuditEvent: vi.fn(),
    dismissOfferAttributionAdminReviews,
    getUserOfferAttributionReviews: vi.fn(),
    stripe,
  };
});

vi.mock("./db", () => ({
  getDb: mocks.getDb,
  createAdminReviewItem: mocks.createAdminReviewItem,
  createAuditEvent: mocks.createAuditEvent,
  dismissOfferAttributionAdminReviews: mocks.dismissOfferAttributionAdminReviews,
  getUserOfferAttributionReviews: mocks.getUserOfferAttributionReviews,
}));

vi.mock("./storage", () => ({
  storageDelete: mocks.storageDelete,
  storagePut: mocks.storagePut,
}));

vi.mock("./stripeClient", () => ({
  getStripeClient: vi.fn(() => mocks.stripe),
}));

function createContext(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `success-fee-eligibility-${userId}`,
      email: `success-fee-eligibility-${userId}@example.local`,
      name: "Success Fee Eligibility User",
      loginMethod: "test",
      role: "user",
      accountStatus: "active",
      tosAcceptedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("success fee report-hire eligibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockResolvedValue(mocks.mockDb);
    mocks.selectLimit.mockResolvedValue([{ id: 51, status: "pending" }]);
    mocks.selectOrderLimit.mockResolvedValue([]);
    mocks.dismissOfferAttributionAdminReviews.mockResolvedValue({ dismissedReviewIds: [] });
    mocks.returningId.mockResolvedValue([{ id: 77 }]);
    mocks.storageDelete.mockResolvedValue({ key: "offer-letters/removed-offer.pdf" });
  });

  it("rejects a linked application before uploading proof or creating billing state when no offer exists", async () => {
    const caller = successFeesRouter.createCaller(createContext(190091));

    await expect(caller.reportHire({
      employerName: "Example Employer",
      jobTitle: "Example Role",
      monthlySalary: 5000,
      currency: "USD",
      startDate: "2026-07-10",
      applicationId: 51,
      offerLetterBase64: "cHJvb2Y=",
      offerLetterMimeType: "text/plain",
      offerLetterFileName: "offer.txt",
      termsAccepted: true,
    })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("confirms offer acceptance"),
    });

    expect(mocks.storagePut).not.toHaveBeenCalled();
  });

  it("rejects a linked unaccepted offer before uploading proof or creating billing state", async () => {
    mocks.selectLimit.mockResolvedValue([{ id: 51, status: "offer" }]);
    const caller = successFeesRouter.createCaller(createContext(190093));

    await expect(caller.reportHire({
      employerName: "Example Employer",
      jobTitle: "Example Role",
      monthlySalary: 5000,
      currency: "USD",
      startDate: "2026-07-10",
      applicationId: 51,
      offerLetterBase64: "cHJvb2Y=",
      offerLetterMimeType: "text/plain",
      offerLetterFileName: "offer.txt",
      termsAccepted: true,
    })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("confirms offer acceptance"),
    });

    expect(mocks.storagePut).not.toHaveBeenCalled();
    expect(mocks.mockDb.insert).not.toHaveBeenCalled();
  });

  it("rejects a cancelled or rejected attribution before proof upload or success-fee creation", async () => {
    mocks.selectLimit.mockResolvedValue([{ id: 51, status: "accepted" }]);
    mocks.selectOrderLimit.mockResolvedValue([{ id: 77, status: "rejected" }]);
    const caller = successFeesRouter.createCaller(createContext(190092));

    await expect(caller.reportHire({
      employerName: "Example Employer",
      jobTitle: "Example Role",
      monthlySalary: 5000,
      currency: "USD",
      startDate: "2026-07-10",
      applicationId: 51,
      offerLetterBase64: "cHJvb2Y=",
      offerLetterMimeType: "text/plain",
      offerLetterFileName: "offer.txt",
      termsAccepted: true,
    })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("rejected or cancelled"),
    });

    expect(mocks.storagePut).not.toHaveBeenCalled();
    expect(mocks.mockDb.insert).not.toHaveBeenCalled();
  });

  it("rejects a duplicate hire report while the employer fee is suspended", async () => {
    mocks.selectLimit
      .mockResolvedValueOnce([{ id: 51, status: "accepted" }])
      .mockResolvedValueOnce([{ id: 77, status: "suspended" }]);
    mocks.selectOrderLimit.mockResolvedValueOnce([]);
    const caller = successFeesRouter.createCaller(createContext(190095));

    await expect(caller.reportHire({
      employerName: "Example Employer",
      jobTitle: "Example Role",
      monthlySalary: 5000,
      currency: "USD",
      startDate: "2026-07-10",
      applicationId: 51,
      offerLetterBase64: "cHJvb2Y=",
      offerLetterMimeType: "text/plain",
      offerLetterFileName: "offer.txt",
      termsAccepted: true,
    })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("unresolved"),
    });

    expect(mocks.storagePut).not.toHaveBeenCalled();
    expect(mocks.mockDb.insert).not.toHaveBeenCalled();
  });

  it("deletes an uploaded offer letter when the success-fee ledger insert fails", async () => {
    mocks.selectLimit
      .mockResolvedValueOnce([{ id: 51, status: "accepted" }])
      .mockResolvedValueOnce([]);
    mocks.selectOrderLimit.mockResolvedValueOnce([]);
    mocks.returningId.mockRejectedValueOnce(new Error("success fee insert failed"));
    const caller = successFeesRouter.createCaller(createContext(190096));

    await expect(caller.reportHire({
      employerName: "Example Employer",
      jobTitle: "Example Role",
      monthlySalary: 5000,
      currency: "USD",
      startDate: "2026-07-10",
      applicationId: 51,
      offerLetterBase64: Buffer.from("%PDF-1.4\nreport-hire-proof").toString("base64"),
      offerLetterMimeType: "application/pdf",
      offerLetterFileName: "offer.pdf",
      termsAccepted: true,
    })).rejects.toThrow("success fee insert failed");
    expect(mocks.storageDelete).toHaveBeenCalledWith(expect.stringMatching(
      /^offer-letters\/190096-[A-Za-z0-9_-]{12}-offer\.pdf$/
    ));
    expect(mocks.createAuditEvent).not.toHaveBeenCalled();
  });

  it("supersedes the source offer review when a linked accepted hire is reported", async () => {
    mocks.selectLimit
      .mockResolvedValueOnce([{ id: 51, status: "accepted" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 1, stripeCustomerId: "cus_test" }]);
    mocks.selectOrderLimit.mockResolvedValueOnce([{ id: 77, status: "pending" }]);
    mocks.dismissOfferAttributionAdminReviews.mockResolvedValue({ dismissedReviewIds: [901] });
    const caller = successFeesRouter.createCaller(createContext(190094));

    await expect(caller.reportHire({
      employerName: "Example Employer",
      jobTitle: "Example Role",
      monthlySalary: 5000,
      currency: "USD",
      startDate: "2026-07-10",
      applicationId: 51,
      offerLetterBase64: Buffer.from("%PDF-1.4\nreport-hire-proof").toString("base64"),
      offerLetterMimeType: "application/pdf",
      offerLetterFileName: "offer.pdf",
      termsAccepted: true,
    })).resolves.toMatchObject({
      feeId: 77,
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test",
      subscriptionStatus: "checkout_open",
    });

    expect(mocks.dismissOfferAttributionAdminReviews).toHaveBeenCalledWith(
      190094,
      51,
      expect.stringContaining("Superseded by the user's report-hire flow")
    );
    expect(mocks.createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "application",
      entityId: 51,
      action: "offer_attribution_review_superseded_by_hire_report",
      approvalId: 77,
    }));
  });

  it("reuses an open Checkout session instead of creating another subscription path", async () => {
    mocks.selectLimit.mockResolvedValueOnce([{
      id: 91,
      userId: 190096,
      applicationId: null,
      employerName: "Example Employer",
      jobTitle: "Example Role",
      monthlyFeeAmount: 25000,
      currency: "USD",
      stripePriceId: "price_existing",
      stripeSubscriptionId: null,
      stripeCheckoutSessionId: "cs_open_91",
      status: "pending_verification",
      termsAcceptedAt: new Date(),
    }]);
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValueOnce({
      id: "cs_open_91",
      status: "open",
      url: "https://checkout.stripe.com/c/pay/cs_open_91",
    });
    const caller = successFeesRouter.createCaller(createContext(190096));

    await expect(caller.retryBillingCheckout({ successFeeId: 91, confirmBillingSetup: true })).resolves.toMatchObject({
      feeId: 91,
      checkoutSource: "reused_open_session",
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_open_91",
    });

    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(mocks.stripe.products.create).not.toHaveBeenCalled();
    expect(mocks.createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "success_fee_checkout_reopened",
      riskLevel: "critical",
    }));
  });

  it("replaces an expired Checkout session using the existing price and no new fee", async () => {
    mocks.selectLimit
      .mockResolvedValueOnce([{
        id: 92,
        userId: 190097,
        applicationId: null,
        employerName: "Example Employer",
        jobTitle: "Example Role",
        monthlyFeeAmount: 25000,
        currency: "USD",
        stripePriceId: "price_existing",
        stripeSubscriptionId: null,
        stripeCheckoutSessionId: "cs_expired_92",
        status: "pending_verification",
        termsAcceptedAt: new Date(),
      }])
      .mockResolvedValueOnce([{ id: 190097, stripeCustomerId: "cus_existing" }]);
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValueOnce({ id: "cs_expired_92", status: "expired", url: null });
    mocks.stripe.checkout.sessions.create.mockResolvedValueOnce({
      id: "cs_replacement_92",
      url: "https://checkout.stripe.com/c/pay/cs_replacement_92",
    });
    const caller = successFeesRouter.createCaller(createContext(190097));

    await expect(caller.retryBillingCheckout({ successFeeId: 92, confirmBillingSetup: true })).resolves.toMatchObject({
      feeId: 92,
      checkoutSource: "replaced_expired_session",
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_replacement_92",
    });

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.products.create).not.toHaveBeenCalled();
    expect(mocks.stripe.prices.create).not.toHaveBeenCalled();
  });

  it("blocks recovery when Checkout completed but its webhook has not reconciled", async () => {
    mocks.selectLimit.mockResolvedValueOnce([{
      id: 93,
      userId: 190098,
      applicationId: null,
      employerName: "Example Employer",
      jobTitle: "Example Role",
      monthlyFeeAmount: 25000,
      currency: "USD",
      stripePriceId: "price_existing",
      stripeSubscriptionId: null,
      stripeCheckoutSessionId: "cs_complete_93",
      status: "pending_verification",
      termsAcceptedAt: new Date(),
    }]);
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValueOnce({ id: "cs_complete_93", status: "complete", url: null });
    const caller = successFeesRouter.createCaller(createContext(190098));

    await expect(caller.retryBillingCheckout({ successFeeId: 93, confirmBillingSetup: true })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("awaiting ledger reconciliation"),
    });

    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(mocks.createAdminReviewItem).toHaveBeenCalledWith(expect.objectContaining({
      title: "Completed Checkout awaits reconciliation",
      priority: "critical",
    }));
  });
});
