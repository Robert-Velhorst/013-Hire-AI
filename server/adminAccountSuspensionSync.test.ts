import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => {
  const updateWhere = vi.fn();
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const stripeUpdate = vi.fn();
  const insertedRows: Record<string, unknown>[] = [];
  const selectResults: unknown[][] = [];
  const select = vi.fn(() => {
    const value = selectResults.shift() ?? [];
    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      for: vi.fn(() => chain),
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(value).then(resolve, reject),
    };
    return chain;
  });
  const insertValues = vi.fn((value: Record<string, unknown>) => {
    insertedRows.push(value);
    return Promise.resolve();
  });
  const mockTx = {
    select,
    update: vi.fn(() => ({ set: updateSet })),
    insert: vi.fn(() => ({ values: (value: Record<string, unknown>) => Object.assign(insertValues(value), { onDuplicateKeyUpdate: vi.fn(() => insertValues.mock.results.at(-1)?.value) }) })),
  };
  const transaction = vi.fn(async (operation: (tx: typeof mockTx) => Promise<unknown>) => operation(mockTx));
  const mockDb = {
    transaction,
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
    stripeUpdate,
    insertedRows,
    selectResults,
    transaction,
    insertValues,
    select,
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
    mocks.insertedRows.length = 0;
    mocks.selectResults.splice(0, mocks.selectResults.length,
      [{ id: 88, accountStatus: "active" }],
      [{
        id: 211,
        userId: 88,
        status: "active",
        lifecycleStatus: "active",
        stripeSubscriptionId: "sub_account_211",
        notes: null,
      }],
      [],
      [{ holdType: "account" }],
    );
    mocks.getDb.mockResolvedValue(mocks.mockDb);
    mocks.getAdminMemoryFallback.mockResolvedValue(null);
    mocks.stripeUpdate.mockResolvedValue({ id: "sub_account_211" });
    mocks.updateWhere.mockResolvedValue([{ affectedRows: 1 }]);
  });

  it("commits local suspension, revocation, audit, and an idempotent Stripe command together", async () => {
    const caller = adminRouter.createCaller(createAdminContext(17));

    await expect(caller.suspendUser({
      userId: 88,
      reason: "Verification remains overdue after review.",
    })).resolves.toEqual({ success: true, billingSynchronization: "queued" });

    expect(mocks.stripeUpdate).not.toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ accountStatus: "suspended" }));
    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "suspended" }));
    expect(mocks.insertedRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        successFeeId: 211,
        stripeSubscriptionId: "sub_account_211",
        action: "pause",
        status: "pending",
        commandKey: expect.any(String),
      }),
      expect.objectContaining({ action: "user_suspended", actor: "admin" }),
      expect.objectContaining({ category: "legal_escalation", priority: "critical" }),
    ]));
  });

  it("commits local containment without calling an unavailable Stripe provider", async () => {
    mocks.stripeUpdate.mockRejectedValueOnce(new Error("provider unavailable"));
    const caller = adminRouter.createCaller(createAdminContext(17));

    await expect(caller.suspendUser({
      userId: 88,
      reason: "Verification remains overdue after review.",
    })).resolves.toMatchObject({ success: true, billingSynchronization: "queued" });

    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ accountStatus: "suspended" }));
    expect(mocks.stripeUpdate).not.toHaveBeenCalled();
    expect(mocks.insertedRows.some(row => row.action === "user_suspended")).toBe(true);
    expect(mocks.insertedRows.some(row => row.action === "pause")).toBe(true);
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

    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.mockDb.update).not.toHaveBeenCalled();
    expect(mocks.stripeUpdate).not.toHaveBeenCalled();
  });
});
