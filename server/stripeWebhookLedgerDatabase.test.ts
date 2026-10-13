import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectLimit = vi.fn();
  const insertValues = vi.fn();
  const updateWhere = vi.fn();
  const db: Record<string, any> = {};
  db.select = vi.fn(() => ({
    from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(() => ({ for: vi.fn(selectLimit) })) })) })),
  }));
  db.insert = vi.fn(() => ({ values: insertValues }));
  db.update = vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) }));
  db.transaction = vi.fn(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db));
  return { getDb: vi.fn(), db, selectLimit, insertValues, updateWhere };
});

vi.mock("./db", () => ({ getDb: mocks.getDb }));

import { claimStripeWebhookEvent } from "./stripeWebhookLedger";

describe("Stripe webhook database claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockResolvedValue(mocks.db);
    mocks.selectLimit.mockResolvedValue([]);
    mocks.insertValues.mockResolvedValue(undefined);
    mocks.updateWhere.mockResolvedValue([{ affectedRows: 1 }]);
    mocks.db.transaction.mockImplementation(async (callback: (tx: typeof mocks.db) => Promise<unknown>) => callback(mocks.db));
  });

  it("claims a new event within a transaction", async () => {
    await expect(claimStripeWebhookEvent("evt_new", "invoice.paid"))
      .resolves.toEqual({ claimed: true, duplicate: false });
    expect(mocks.db.transaction).toHaveBeenCalledOnce();
    expect(mocks.insertValues).toHaveBeenCalledWith({
      stripeEventId: "evt_new",
      eventType: "invoice.paid",
      status: "processing",
    });
  });

  it("reclaims a failed event while holding the ledger row lock", async () => {
    mocks.selectLimit.mockResolvedValueOnce([{
      id: 1,
      eventType: "invoice.paid",
      status: "failed",
      updatedAt: new Date(),
    }]);
    await expect(claimStripeWebhookEvent("evt_retry", "invoice.paid"))
      .resolves.toEqual({ claimed: true, duplicate: false });
    expect(mocks.updateWhere).toHaveBeenCalledOnce();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("reclaims stale processing events but leaves fresh processing events alone", async () => {
    mocks.selectLimit.mockResolvedValueOnce([{
      id: 2,
      eventType: "invoice.paid",
      status: "processing",
      updatedAt: new Date(Date.now() - 11 * 60 * 1000),
    }]);
    await expect(claimStripeWebhookEvent("evt_stale", "invoice.paid"))
      .resolves.toEqual({ claimed: true, duplicate: false });

    mocks.selectLimit.mockResolvedValueOnce([{
      id: 3,
      eventType: "invoice.paid",
      status: "processing",
      updatedAt: new Date(),
    }]);
    await expect(claimStripeWebhookEvent("evt_fresh", "invoice.paid"))
      .resolves.toEqual({ claimed: false, duplicate: true });
  });

  it("treats only a unique event-id race as a duplicate", async () => {
    mocks.insertValues.mockRejectedValueOnce(Object.assign(new Error("duplicate"), {
      code: "ER_DUP_ENTRY",
      errno: 1062,
    }));
    await expect(claimStripeWebhookEvent("evt_claim_race", "invoice.paid"))
      .resolves.toEqual({ claimed: false, duplicate: true });
  });

  it("rejects a reused Stripe event ID with a conflicting event type", async () => {
    mocks.selectLimit.mockResolvedValueOnce([{
      id: 4,
      eventType: "invoice.payment_failed",
      status: "processed",
      updatedAt: new Date(),
    }]);
    await expect(claimStripeWebhookEvent("evt_conflict", "invoice.paid"))
      .rejects.toThrow("conflicting event types");
  });

  it("propagates database outages instead of acknowledging the event as handled", async () => {
    const databaseError = Object.assign(new Error("database unavailable"), { code: "ECONNRESET" });
    mocks.insertValues.mockRejectedValueOnce(databaseError);
    await expect(claimStripeWebhookEvent("evt_claim_db_error", "invoice.paid"))
      .rejects.toBe(databaseError);
  });
});
