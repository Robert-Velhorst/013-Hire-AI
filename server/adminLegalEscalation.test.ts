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
    getDb: vi.fn(),
    mockDb,
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
  getDb: mocks.getDb,
  getAdminReviewEvidenceSnapshot: vi.fn(),
  listAdminReviewItems: vi.fn(),
  resolveAdminReviewItem: vi.fn(),
}));

vi.mock("./stripeClient", () => ({
  getStripeClient: vi.fn(() => ({ subscriptions: { update: mocks.stripeUpdate } })),
}));

import { adminRouter } from "./routers/admin";

function createAdminContext(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `legal-admin-${userId}`,
      name: "Legal Admin",
      email: `legal-admin-${userId}@example.local`,
      loginMethod: "test",
      role: "admin",
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

function seedEscalation() {
  const disputedFee = {
    id: 91,
    userId: 500,
    status: "active",
    lifecycleStatus: "active",
    stripeSubscriptionId: "sub_disputed",
    notes: "Prior fee note",
  };
  const relatedActiveFee = {
    id: 92,
    userId: 500,
    status: "active",
    lifecycleStatus: "active",
    stripeSubscriptionId: "sub_related",
    notes: null,
  };
  mocks.selectResults.splice(0, mocks.selectResults.length,
    [{ userId: 500 }],
    [{ id: 500, accountStatus: "active" }],
    [disputedFee],
    [disputedFee, relatedActiveFee],
    [],
    [],
    [{ holdType: "account" }, { holdType: "legal" }],
    [],
    [{ holdType: "account" }],
  );
}

describe("admin legal escalation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertedRows.length = 0;
    seedEscalation();
    mocks.getDb.mockResolvedValue(mocks.mockDb);
  });

  it("commits account containment, fee changes, audit, review, and provider commands atomically", async () => {
    mocks.stripeUpdate.mockRejectedValue(new Error("provider unavailable"));
    const caller = adminRouter.createCaller(createAdminContext(70));

    const result = await caller.flagLegalEscalation({
      feeId: 91,
      reason: "Required employment verification remained unresolved.",
    });

    expect(result).toMatchObject({ success: true, billingSynchronization: "queued" });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.stripeUpdate).not.toHaveBeenCalled();
    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "disputed" }));
    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: "suspended",
    }));
    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      notes: expect.stringContaining("success fee #91"),
    }));
    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      accountStatus: "suspended",
      sessionVersion: expect.anything(),
    }));
    expect(mocks.insertedRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ successFeeId: 91, action: "pause", status: "pending" }),
      expect.objectContaining({ successFeeId: 92, action: "pause", status: "pending" }),
      expect.objectContaining({
        entityType: "success_fee",
        entityId: 92,
        action: "success_fee_suspended_for_legal_escalation",
        riskLevel: "critical",
      }),
      expect.objectContaining({ action: "legal_escalation_flagged", riskLevel: "critical" }),
      expect.objectContaining({ category: "legal_escalation", priority: "critical" }),
    ]));
  });

  it("does not enqueue duplicate pauses when the account and fees are already contained", async () => {
    seedEscalation();
    mocks.selectResults[1] = [{ id: 500, accountStatus: "suspended" }];
    mocks.selectResults[2] = [{ id: 91, userId: 500, status: "disputed", lifecycleStatus: "active", stripeSubscriptionId: "sub_disputed", notes: "Prior fee note" }];
    mocks.selectResults[3] = [];
    mocks.selectResults[4] = [{ id: 801 }];
    mocks.selectResults[5] = [{ id: 802 }];
    mocks.selectResults[6] = [{ holdType: "account" }, { holdType: "legal" }];
    const caller = adminRouter.createCaller(createAdminContext(70));

    const result = await caller.flagLegalEscalation({ feeId: 91, reason: "Still under review." });

    expect(result.billingSynchronization).toBe("not_required");
    expect(mocks.insertedRows.some(row => row.action === "pause")).toBe(false);
    expect(mocks.stripeUpdate).not.toHaveBeenCalled();
  });
});
