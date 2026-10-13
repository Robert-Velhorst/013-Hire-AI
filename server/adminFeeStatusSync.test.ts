import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => {
  const insertedRows: Record<string, unknown>[] = [];
  const selectResults: unknown[][] = [];
  const updateSet = vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ affectedRows: 1 }]) }));
  const makeSelect = () => {
    const value = selectResults.shift() ?? [];
    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      for: vi.fn(() => chain),
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(value).then(resolve, reject),
    };
    return chain;
  };
  const insertValues = vi.fn((value: Record<string, unknown>) => {
    insertedRows.push(value);
    return Promise.resolve();
  });
  const tx = {
    select: vi.fn(makeSelect),
    update: vi.fn(() => ({ set: updateSet })),
    insert: vi.fn(() => ({ values: (value: Record<string, unknown>) => Object.assign(insertValues(value), { onDuplicateKeyUpdate: vi.fn(() => insertValues.mock.results.at(-1)?.value) }) })),
  };
  const transaction = vi.fn(async (operation: (value: typeof tx) => Promise<unknown>) => operation(tx));
  const mockDb = {
    select: vi.fn(makeSelect),
    transaction,
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
    stripeCancel: vi.fn(),
    stripeUpdate: vi.fn(),
    insertedRows,
    selectResults,
    transaction,
    updateSet,
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
    subscriptions: { cancel: mocks.stripeCancel, update: mocks.stripeUpdate },
  })),
}));

import { adminRouter } from "./routers/admin";

function createAdminContext(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `billing-admin-${userId}`,
      name: "Billing Admin",
      email: `billing-admin-${userId}@example.local`,
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

function seedFee(status = "active") {
  mocks.selectResults.splice(0, mocks.selectResults.length,
    [{ userId: 77 }],
    [{ id: 77, accountStatus: "active" }],
    [{ id: 441, userId: 77, status, lifecycleStatus: "active", stripeSubscriptionId: "sub_fee_441", notes: "Existing note", endDate: null }],
    status === "suspended" ? [{ id: 330, holdType: "administrator" }] : [],
    status === "suspended" ? [{ id: 330, holdType: "administrator" }] : [],
    status === "suspended" ? [{ holdType: "administrator" }] : [],
  );
}

describe("admin success-fee Stripe reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertedRows.length = 0;
    seedFee();
    mocks.getDb.mockResolvedValue(mocks.mockDb);
    mocks.getAdminMemoryFallback.mockResolvedValue(null);
  });

  it.each([
    ["suspended", "pause"],
    ["disputed", "pause"],
    ["ended", "cancel"],
  ] as const)("commits %s locally and queues %s billing synchronization", async (status, action) => {
    mocks.stripeUpdate.mockRejectedValue(new Error("provider unavailable"));
    mocks.stripeCancel.mockRejectedValue(new Error("provider unavailable"));
    const caller = adminRouter.createCaller(createAdminContext(17));

    await expect(caller.updateFeeStatus({ feeId: 441, status, notes: "Reviewed." }))
      .resolves.toEqual({ success: true, billingSynchronization: "queued" });

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.stripeUpdate).not.toHaveBeenCalled();
    expect(mocks.stripeCancel).not.toHaveBeenCalled();
    expect(mocks.insertedRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        successFeeId: 441,
        stripeSubscriptionId: "sub_fee_441",
        action,
        status: "pending",
        commandKey: expect.any(String),
      }),
      expect.objectContaining({ action: "success_fee_status_updated" }),
    ]));
  });

  it("does not enqueue duplicate provider work when the status is unchanged", async () => {
    seedFee("suspended");
    const caller = adminRouter.createCaller(createAdminContext(17));

    await expect(caller.updateFeeStatus({ feeId: 441, status: "suspended" }))
      .resolves.toEqual({ success: true, billingSynchronization: "not_required" });

    expect(mocks.insertedRows.some(row => row.successFeeId === 441)).toBe(false);
  });
});
