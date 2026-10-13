import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { adminRouter } from "./routers/admin";

const mocks = vi.hoisted(() => {
  const selectLimit = vi.fn();
  const updateWhere = vi.fn();
  const insertValues = vi.fn();
  const selectResults: unknown[][] = [];
  const updateSet = vi.fn(() => ({
    where: updateWhere,
  }));
  const makeSelect = () => {
    const query: any = {};
    query.from = vi.fn(() => query);
    query.where = vi.fn(() => query);
    query.limit = vi.fn(() => query);
    query.for = vi.fn(() => Promise.resolve(selectResults.shift() ?? []));
    query.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(selectResults.shift() ?? []).then(resolve, reject);
    return query;
  };
  const tx = {
    select: vi.fn(makeSelect),
    update: vi.fn(() => ({ set: updateSet })),
    insert: vi.fn(() => ({ values: insertValues })),
  };
  const mockDb = {
    select: vi.fn(makeSelect),
    update: vi.fn(() => ({
      set: updateSet,
    })),
    transaction: vi.fn(async (operation: (value: typeof tx) => Promise<unknown>) => operation(tx)),
  };

  return {
    mockDb,
    selectLimit,
    selectResults,
    updateWhere,
    createAdminReviewItem: vi.fn(),
    createAuditEvent: vi.fn(),
    getDb: vi.fn(),
    listActiveAdminReviewItemsForEntity: vi.fn(),
    listAdminReviewItems: vi.fn(),
    resolveAdminReviewItem: vi.fn(),
  };
});

vi.mock("./db", () => ({
  createAdminReviewItem: mocks.createAdminReviewItem,
  createAuditEvent: mocks.createAuditEvent,
  getDb: mocks.getDb,
  listActiveAdminReviewItemsForEntity: mocks.listActiveAdminReviewItemsForEntity,
  listAdminReviewItems: mocks.listAdminReviewItems,
  resolveAdminReviewItem: mocks.resolveAdminReviewItem,
}));

vi.mock("./stripeClient", () => ({
  getStripeClient: vi.fn(() => ({})),
}));

function createAdminContext(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `admin-${userId}`,
      name: "Admin User",
      email: `admin-${userId}@example.local`,
      loginMethod: "test",
      role: "admin",
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

describe("admin verification review lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockResolvedValue(mocks.mockDb);
    mocks.selectResults.splice(0, mocks.selectResults.length,
      [{ id: 7001, userId: 42, successFeeId: 88, status: "pending" }],
      [{ id: 88, userId: 42, status: "suspended", lifecycleStatus: "active", stripeSubscriptionId: "sub_88" }],
      [{ id: 7001, userId: 42, successFeeId: 88, status: "pending" }],
      [],
      [],
    );
    mocks.updateWhere.mockResolvedValue([{ affectedRows: 1 }]);
    mocks.listActiveAdminReviewItemsForEntity.mockResolvedValue([
      {
        id: 901,
        userId: 42,
        entityType: "verification",
        entityId: 7001,
        category: "verification_overdue",
        status: "open",
      },
    ]);
    mocks.resolveAdminReviewItem.mockResolvedValue({ success: true });
  });

  it("resolves the active verification review handoff when approved", async () => {
    const caller = adminRouter.createCaller(createAdminContext(7));

    const result = await caller.reviewVerification({
      verificationId: 7001,
      approved: true,
      notes: "Looks valid.",
    });

    expect(result).toEqual({ success: true, approved: true });
    expect(mocks.listActiveAdminReviewItemsForEntity).toHaveBeenCalledWith(42, "verification", 7001);
    expect(mocks.listAdminReviewItems).not.toHaveBeenCalled();
    expect(mocks.resolveAdminReviewItem).toHaveBeenCalledTimes(1);
    expect(mocks.resolveAdminReviewItem).toHaveBeenCalledWith(
      901,
      7,
      "resolved",
      expect.stringContaining("approved")
    );
    expect(mocks.createAdminReviewItem).not.toHaveBeenCalled();
  });

  it("resolves the submitted review handoff before opening rejected-verification follow-up", async () => {
    const caller = adminRouter.createCaller(createAdminContext(7));

    const result = await caller.reviewVerification({
      verificationId: 7001,
      approved: false,
      notes: "Document is not current.",
    });

    expect(result).toEqual({ success: true, approved: false });
    expect(mocks.listActiveAdminReviewItemsForEntity).toHaveBeenCalledWith(42, "verification", 7001);
    expect(mocks.listAdminReviewItems).not.toHaveBeenCalled();
    expect(mocks.resolveAdminReviewItem).toHaveBeenCalledTimes(1);
    expect(mocks.resolveAdminReviewItem).toHaveBeenCalledWith(
      901,
      7,
      "resolved",
      expect.stringContaining("Document is not current.")
    );
    expect(mocks.createAdminReviewItem).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      entityType: "verification",
      entityId: 7001,
      category: "verification_overdue",
      priority: "high",
      title: "Rejected verification needs user follow-up",
      description: "Document is not current.",
    }));
  });
});
