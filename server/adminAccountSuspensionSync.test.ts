import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => {
  const updateWhere = vi.fn();
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const stripeUpdate = vi.fn();
  const selectWhere = vi.fn();
  const mockDb = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: selectWhere })),
    })),
    update: vi.fn(() => ({ set: updateSet })),
  };

  return {
    createAdminReviewItem: vi.fn(),
    createAuditEvent: vi.fn(),
    getAdminMemoryFallback: vi.fn(),
    getAdminReviewEvidenceSnapshot: vi.fn(),
    getDb: vi.fn(),
    listAdminReviewItems: vi.fn(),
    mockDb,
    resolveAdminReviewItem: vi.fn(),
    selectWhere,
    stripeUpdate,
    updateSet,
    updateWhere,
  };
});

vi.mock("./db", () => ({
  createAdminReviewItem: mocks.createAdminReviewItem,
  createAuditEvent: mocks.createAuditEvent,
  getAdminMemoryFallback: mocks.getAdminMemoryFallback,
  getAdminReviewEvidenceSnapshot: mocks.getAdminReviewEvidenceSnapshot,
  getDb: mocks.getDb,
  listAdminReviewItems: mocks.listAdminReviewItems,
  resolveAdminReviewItem: mocks.resolveAdminReviewItem,
}));

vi.mock("./stripeClient", () => ({
  getStripeClient: vi.fn(() => ({
    subscriptions: { update: mocks.stripeUpdate },
  })),
}));

import { adminRouter } from "./routers/admin";

function createAdminContext(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `suspension-admin-${userId}`,
      name: "Suspension Admin",
      email: `suspension-admin-${userId}@example.local`,
      loginMethod: "test",
      role: "admin",
      stripeCustomerId: null,
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

describe("admin account suspension Stripe synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockResolvedValue(mocks.mockDb);
    mocks.getAdminMemoryFallback.mockResolvedValue(null);
    mocks.selectWhere.mockResolvedValue([{
      id: 211,
      userId: 88,
      status: "active",
      stripeSubscriptionId: "sub_account_211",
      notes: null,
    }]);
    mocks.stripeUpdate.mockResolvedValue({ id: "sub_account_211" });
    mocks.updateWhere.mockResolvedValue([{ affectedRows: 1 }]);
  });

  it("pauses active subscriptions before suspending the account and fee ledger", async () => {
    const caller = adminRouter.createCaller(createAdminContext(17));

    await expect(caller.suspendUser({
      userId: 88,
      reason: "Verification remains overdue after review.",
    })).resolves.toEqual({ success: true });

    expect(mocks.stripeUpdate).toHaveBeenCalledWith("sub_account_211", {
      pause_collection: { behavior: "void" },
    });
    expect(mocks.updateSet).toHaveBeenCalledWith({ accountStatus: "suspended" });
    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "suspended" }));
    expect(mocks.createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "user",
      entityId: 88,
      action: "user_suspended",
    }));
  });

  it("does not suspend the account or fees when Stripe cannot pause billing", async () => {
    mocks.stripeUpdate.mockRejectedValueOnce(new Error("provider unavailable"));
    const caller = adminRouter.createCaller(createAdminContext(17));

    await expect(caller.suspendUser({
      userId: 88,
      reason: "Verification remains overdue after review.",
    })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Stripe could not synchronize this suspension. The local account and fee statuses were not changed.",
    });

    expect(mocks.mockDb.update).not.toHaveBeenCalled();
    expect(mocks.createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "user",
      entityId: 88,
      action: "user_suspension_blocked_stripe_sync",
      riskLevel: "critical",
    }));
    expect(mocks.createAdminReviewItem).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "user",
      entityId: 88,
      category: "payment_failed",
      priority: "critical",
    }));
  });

  it("prevents an administrator from suspending their own active session", async () => {
    const caller = adminRouter.createCaller(createAdminContext(17));

    await expect(caller.suspendUser({
      userId: 17,
      reason: "Self suspension should require another administrator.",
    })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "An administrator cannot suspend their own account.",
    });

    expect(mocks.mockDb.select).not.toHaveBeenCalled();
    expect(mocks.mockDb.update).not.toHaveBeenCalled();
    expect(mocks.stripeUpdate).not.toHaveBeenCalled();
  });
});
