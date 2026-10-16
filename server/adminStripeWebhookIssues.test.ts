import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const updateValues: Record<string, unknown>[] = [];
  const insertedValues: Record<string, unknown>[] = [];
  const makeSelect = () => {
    const rows = selectResults.shift() ?? [];
    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      for: vi.fn(() => chain),
      then: (
        resolve: (value: unknown) => unknown,
        reject: (error: unknown) => unknown
      ) => Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  };
  const updateWhere = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
  const tx: Record<string, any> = {
    select: vi.fn(makeSelect),
    update: vi.fn(() => ({
      set: vi.fn((value: Record<string, unknown>) => {
        updateValues.push(value);
        return { where: updateWhere };
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((value: Record<string, unknown>) => {
        insertedValues.push(value);
        return Promise.resolve();
      }),
    })),
  };
  const db = {
    select: vi.fn(makeSelect),
    transaction: vi.fn(async (operation: (tx: typeof tx) => Promise<unknown>) =>
      operation(tx)
    ),
  };
  return {
    getDb: vi.fn(),
    db,
    tx,
    selectResults,
    updateValues,
    insertedValues,
    updateWhere,
    createAdminReviewItem: vi.fn(),
    createAuditEvent: vi.fn(),
    getAdminMemoryFallback: vi.fn(),
    getAdminReviewEvidenceSnapshot: vi.fn(),
    getOperationalFailureMonitoringSnapshot: vi.fn(),
    listActiveAdminReviewItemsForEntity: vi.fn(),
    listAdminReviewItems: vi.fn(),
    resolveAdminReviewItem: vi.fn(),
  };
});

vi.mock("./db", () => ({
  createAdminReviewItem: mocks.createAdminReviewItem,
  createAuditEvent: mocks.createAuditEvent,
  getDb: mocks.getDb,
  getAdminMemoryFallback: mocks.getAdminMemoryFallback,
  getAdminReviewEvidenceSnapshot: mocks.getAdminReviewEvidenceSnapshot,
  getOperationalFailureMonitoringSnapshot:
    mocks.getOperationalFailureMonitoringSnapshot,
  listActiveAdminReviewItemsForEntity:
    mocks.listActiveAdminReviewItemsForEntity,
  listAdminReviewItems: mocks.listAdminReviewItems,
  resolveAdminReviewItem: mocks.resolveAdminReviewItem,
}));
vi.mock("./stripeClient", () => ({
  getStripeClient: vi.fn(() => ({
    subscriptions: { cancel: vi.fn(), update: vi.fn() },
  })),
}));

import { adminRouter } from "./routers/admin";

function createAdminContext(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `stripe-admin-${userId}`,
      name: "Stripe Admin",
      email: `stripe-admin-${userId}@example.local`,
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

describe("admin Stripe webhook reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResults.length = 0;
    mocks.updateValues.length = 0;
    mocks.insertedValues.length = 0;
    mocks.getDb.mockResolvedValue(mocks.db);
  });

  it("lists only bounded failed and quarantined webhook ledger fields", async () => {
    const rows = [
      {
        id: 18,
        stripeEventId: "evt_review_18",
        eventType: "invoice.paid",
        status: "quarantined",
        errorMessage: "customer_mismatch",
        receivedAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    mocks.selectResults.push(rows, [{ count: rows.length }]);
    const caller = adminRouter.createCaller(createAdminContext(11));

    await expect(caller.getStripeWebhookIssues({ limit: 20 })).resolves.toEqual(
      {
        items: rows,
        total: 1,
        limit: 20,
        hasMore: false,
        nextCursor: null,
      }
    );
  });

  it("reopens a quarantined event transactionally and audits the responsible admin", async () => {
    mocks.selectResults.push([
      {
        id: 18,
        stripeEventId: "evt_review_18",
        eventType: "invoice.paid",
        status: "quarantined",
        errorMessage: "customer_mismatch",
      },
    ]);
    const caller = adminRouter.createCaller(createAdminContext(11));

    await expect(
      caller.reopenQuarantinedStripeWebhook({
        eventRowId: 18,
        confirmation: "REOPEN",
      })
    ).resolves.toEqual({ eventId: "evt_review_18", eventType: "invoice.paid" });

    expect(mocks.updateValues).toEqual([
      { status: "failed", processedAt: null },
    ]);
    expect(mocks.insertedValues).toEqual([
      expect.objectContaining({
        userId: 11,
        entityType: "user",
        entityId: 11,
        action: "stripe_webhook_quarantine_reopened",
        actor: "admin",
        riskLevel: "high",
        beforeState: expect.stringContaining("customer_mismatch"),
        afterState: expect.stringContaining('"resendRequired":true'),
      }),
    ]);
  });

  it("does not reopen events outside quarantine", async () => {
    mocks.selectResults.push([
      {
        id: 19,
        stripeEventId: "evt_done_19",
        eventType: "invoice.paid",
        status: "processed",
        errorMessage: null,
      },
    ]);
    const caller = adminRouter.createCaller(createAdminContext(11));

    await expect(
      caller.reopenQuarantinedStripeWebhook({
        eventRowId: 19,
        confirmation: "REOPEN",
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.updateValues).toHaveLength(0);
    expect(mocks.insertedValues).toHaveLength(0);
  });
});
