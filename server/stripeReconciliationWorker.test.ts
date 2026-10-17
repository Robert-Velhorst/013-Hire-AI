import { afterEach, describe, expect, it, vi } from "vitest";
import type { stripeReconciliationCommands } from "../drizzle/schema";
import {
  executeStripeReconciliationCommand,
  getStripeCommandRetryDelayMs,
  isStripeCommandStillDesired,
  StripeReconciliationWorker,
} from "./stripeReconciliationWorker";
import { getStripeClient } from "./stripeClient";

type Command = typeof stripeReconciliationCommands.$inferSelect;

function command(action: Command["action"]): Command {
  return {
    id: 7,
    successFeeId: 9,
    stripeSubscriptionId: "sub_test_9",
    commandKey: "f80bcd02-50b5-4ddb-a99e-1974e1dbfb6a",
    action,
    status: "processing",
    attemptCount: 2,
    lastErrorCode: null,
    nextAttemptAt: new Date(),
    lastAttemptAt: new Date(),
    leaseId: "lease-test",
    leaseExpiresAt: new Date(Date.now() + 60_000),
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("Stripe reconciliation worker policy", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("does not start polling unless Stripe billing is explicitly enabled", () => {
    vi.useFakeTimers();
    vi.stubEnv("STRIPE_ENABLED", "false");
    const worker = new StripeReconciliationWorker();

    worker.start();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses bounded exponential backoff", () => {
    expect(getStripeCommandRetryDelayMs(1)).toBe(30_000);
    expect(getStripeCommandRetryDelayMs(2)).toBe(60_000);
    expect(getStripeCommandRetryDelayMs(99)).toBe(6 * 60 * 60 * 1000);
  });

  it("reuses the persisted idempotency key for provider retries", async () => {
    const update = vi.fn().mockResolvedValue({ id: "sub_test_9" });
    const stripe = { subscriptions: { update, cancel: vi.fn() } } as unknown as ReturnType<typeof getStripeClient>;
    const item = command("pause");

    await executeStripeReconciliationCommand(item, stripe);
    await executeStripeReconciliationCommand(item, stripe);

    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenNthCalledWith(1, "sub_test_9", {
      pause_collection: { behavior: "void" },
    }, { idempotencyKey: item.commandKey });
    expect(update).toHaveBeenNthCalledWith(2, "sub_test_9", {
      pause_collection: { behavior: "void" },
    }, { idempotencyKey: item.commandKey });
  });

  it("does not apply provider commands that contradict committed local authority", () => {
    expect(isStripeCommandStillDesired("pause", "suspended", "active")).toBe(true);
    expect(isStripeCommandStillDesired("resume", "active", "active")).toBe(true);
    expect(isStripeCommandStillDesired("resume", "active", "suspended")).toBe(false);
    expect(isStripeCommandStillDesired("cancel", "ended", "active")).toBe(true);
    expect(isStripeCommandStillDesired("pause", "active", "active")).toBe(false);
  });
});
