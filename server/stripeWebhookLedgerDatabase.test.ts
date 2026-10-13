import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  selectLimit: vi.fn(),
  insertValues: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: mocks.getDb }));

import { claimStripeWebhookEvent } from "./stripeWebhookLedger";

describe("Stripe webhook database claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockResolvedValue({
      select: () => ({ from: () => ({ where: () => ({ limit: mocks.selectLimit }) }) }),
      insert: () => ({ values: mocks.insertValues }),
    });
    mocks.selectLimit.mockResolvedValue([]);
    mocks.insertValues.mockResolvedValue(undefined);
  });

  it("treats only a unique event-id race as a duplicate", async () => {
    mocks.insertValues.mockRejectedValueOnce(Object.assign(new Error("duplicate"), {
      code: "ER_DUP_ENTRY",
      errno: 1062,
    }));

    await expect(claimStripeWebhookEvent("evt_claim_race", "invoice.paid"))
      .resolves.toEqual({ claimed: false, duplicate: true });
  });

  it("propagates database outages instead of acknowledging the event as handled", async () => {
    const databaseError = Object.assign(new Error("database unavailable"), {
      code: "ECONNRESET",
    });
    mocks.insertValues.mockRejectedValueOnce(databaseError);

    await expect(claimStripeWebhookEvent("evt_claim_db_error", "invoice.paid"))
      .rejects.toBe(databaseError);
  });
});
