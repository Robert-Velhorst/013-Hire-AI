import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { successFeesRouter } from "./routers/successFees";

const mocks = vi.hoisted(() => {
  const selectLimit = vi.fn();
  const insertValues = vi.fn();
  const mockDb = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: selectLimit,
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: insertValues,
    })),
  };

  return {
    mockDb,
    selectLimit,
    insertValues,
    createAdminReviewItem: vi.fn(),
    createAuditEvent: vi.fn(),
    getDb: vi.fn(),
    getUserOfferAttributionReviews: vi.fn(),
    storageDelete: vi.fn(),
    storagePut: vi.fn(),
  };
});

vi.mock("./db", () => ({
  createAdminReviewItem: mocks.createAdminReviewItem,
  createAuditEvent: mocks.createAuditEvent,
  getDb: mocks.getDb,
  getUserOfferAttributionReviews: mocks.getUserOfferAttributionReviews,
}));

vi.mock("./storage", () => ({
  storageDelete: mocks.storageDelete,
  storagePut: mocks.storagePut,
}));

vi.mock("./stripeClient", () => ({
  getStripeClient: vi.fn(() => ({})),
}));

function createContext(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `verification-user-${userId}`,
      name: "Verification User",
      email: `verification-${userId}@example.local`,
      loginMethod: "test",
      role: "user",
      stripeCustomerId: null,
      accountStatus: "active",
      tosAcceptedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("success fee verification submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockResolvedValue(mocks.mockDb);
    mocks.selectLimit.mockResolvedValue([{
      id: 44,
      userId: 99221,
      employerName: "LedgerWorks",
      nextVerificationDue: new Date("2026-07-01T00:00:00.000Z"),
    }]);
    mocks.insertValues.mockResolvedValue([{ insertId: 8801 }]);
    mocks.storagePut.mockResolvedValue({
      url: "https://storage.example.local/verifications/proof.txt",
    });
    mocks.storageDelete.mockResolvedValue({ key: "verifications/removed-proof.txt" });
  });

  it("creates audit and admin review handoff for submitted quarterly verification", async () => {
    const caller = successFeesRouter.createCaller(createContext(99221));
    const result = await caller.submitVerification({
      successFeeId: 44,
      documentBase64: Buffer.from("continued employment proof").toString("base64"),
      documentMimeType: "text/plain",
      documentFileName: "proof.txt",
      documentType: "employment_letter",
    });

    expect(result).toMatchObject({
      success: true,
      status: "pending_review",
      verificationId: 8801,
    });
    expect(mocks.createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      userId: 99221,
      entityType: "verification",
      entityId: 8801,
      action: "employment_verification_submitted",
      actor: "user",
      source: "successFees.submitVerification",
      riskLevel: "high",
    }));
    expect(mocks.createAuditEvent.mock.calls[0][0].afterState).toContain('"successFeeId":44');
    expect(mocks.createAdminReviewItem).toHaveBeenCalledWith(expect.objectContaining({
      userId: 99221,
      entityType: "verification",
      entityId: 8801,
      category: "verification_overdue",
      priority: "high",
      title: "Quarterly employment verification submitted",
    }));
  });

  it("deletes an uploaded proof when the verification ledger insert fails", async () => {
    mocks.insertValues.mockRejectedValueOnce(new Error("verification insert failed"));
    const caller = successFeesRouter.createCaller(createContext(99221));

    await expect(caller.submitVerification({
      successFeeId: 44,
      documentBase64: Buffer.from("continued employment proof").toString("base64"),
      documentMimeType: "text/plain",
      documentFileName: "proof.txt",
      documentType: "employment_letter",
    })).rejects.toThrow("verification insert failed");
    expect(mocks.storageDelete).toHaveBeenCalledWith(expect.stringMatching(
      /^verifications\/99221-[A-Za-z0-9_-]{12}-proof\.txt$/
    ));
    expect(mocks.createAuditEvent).not.toHaveBeenCalled();
  });
});
