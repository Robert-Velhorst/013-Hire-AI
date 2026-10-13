import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const feeSelectLimit = vi.fn();
  const userSelectLimit = vi.fn();
  const paymentSelectLimit = vi.fn();
  const insertValues = vi.fn();
  const feeUpdateWhere = vi.fn();
  const paymentUpdateWhere = vi.fn();
  const eventUpdateWhere = vi.fn();
  const transactionRollback = vi.fn();
  const mockDb: Record<string, any> = {};
  mockDb.select = vi.fn(() => ({
    from: vi.fn((table: Record<PropertyKey, unknown>) => {
      const name = table[Symbol.for("drizzle:Name")];
      const limit =
        name === "users"
          ? userSelectLimit
          : name === "fee_payments"
            ? paymentSelectLimit
            : feeSelectLimit;
      return {
        where: vi.fn(() => ({ limit: vi.fn(() => ({ for: vi.fn(limit) })) })),
      };
    }),
  }));
  mockDb.insert = vi.fn(() => ({ values: insertValues }));
  mockDb.update = vi.fn((table: Record<PropertyKey, unknown>) => {
    const name = table[Symbol.for("drizzle:Name")];
    const where =
      name === "success_fees"
        ? feeUpdateWhere
        : name === "fee_payments"
          ? paymentUpdateWhere
          : eventUpdateWhere;
    return { set: vi.fn(() => ({ where })) };
  });
  mockDb.transaction = vi.fn(
    async (callback: (tx: typeof mockDb) => Promise<void>) => {
      try {
        return await callback(mockDb);
      } catch (error) {
        transactionRollback();
        throw error;
      }
    }
  );

  return {
    mockDb,
    feeSelectLimit,
    userSelectLimit,
    paymentSelectLimit,
    insertValues,
    feeUpdateWhere,
    paymentUpdateWhere,
    eventUpdateWhere,
    transactionRollback,
    getDb: vi.fn(),
    retrieveSubscription: vi.fn(),
    listInvoiceLineItems: vi.fn(),
    claimStripeWebhookEvent: vi.fn(),
    failStripeWebhookEvent: vi.fn(),
    quarantineStripeWebhookEvent: vi.fn(),
  };
});

vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./stripeWebhookLedger", () => ({
  claimStripeWebhookEvent: mocks.claimStripeWebhookEvent,
  failStripeWebhookEvent: mocks.failStripeWebhookEvent,
  quarantineStripeWebhookEvent: mocks.quarantineStripeWebhookEvent,
}));
vi.mock("./stripeClient", () => ({
  getStripeClient: vi.fn(() => ({
    subscriptions: { retrieve: mocks.retrieveSubscription },
    invoices: { listLineItems: mocks.listInvoiceLineItems },
  })),
}));

import { registerStripeWebhook } from "./stripeWebhook";

const fee = {
  id: 701,
  userId: 81,
  employerName: "Example Employer",
  jobTitle: "Remote Engineer",
  status: "active",
  stripeSubscriptionId: "sub_failed_701",
  stripePriceId: "price_failed_701",
  monthlyFeeAmount: 25000,
  currency: "usd",
};

function invoice(id: string, status: "paid" | "failed") {
  return {
    id,
    subscription: "sub_failed_701",
    customer: "cus_failed_701",
    amount_paid: 25000,
    amount_due: 25000,
    currency: "usd",
    status_transitions: { paid_at: 1_784_217_600 },
    period_start: 1_784_217_600,
    period_end: 1_786_809_600,
    lines: {
      data: [
        {
          price: {
            id: "price_failed_701",
            currency: "usd",
            unit_amount: 25000,
          },
          quantity: 1,
          amount: 25000,
          currency: "usd",
        },
      ],
      has_more: false,
    },
    metadata: { testStatus: status },
  };
}

async function postWebhook(
  event: Record<string, unknown>,
  headers: Record<string, string> = {}
) {
  const app = express();
  registerStripeWebhook(app);
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Webhook test server did not bind to a TCP port.");

  try {
    return await fetch(`http://127.0.0.1:${address.port}/api/stripe/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(event),
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  }
}

describe("Stripe payment webhook transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    mocks.getDb.mockResolvedValue(mocks.mockDb);
    mocks.claimStripeWebhookEvent.mockResolvedValue({ claimed: true });
    mocks.retrieveSubscription.mockResolvedValue({
      id: "sub_checkout_701",
      customer: "cus_failed_701",
      items: {
        data: [
          {
            price: {
              id: "price_failed_701",
              currency: "usd",
              unit_amount: 25000,
            },
            quantity: 1,
          },
        ],
      },
    });
    mocks.listInvoiceLineItems.mockResolvedValue({ data: [], has_more: false });
    mocks.feeSelectLimit.mockResolvedValue([fee]);
    mocks.userSelectLimit.mockResolvedValue([
      { stripeCustomerId: "cus_failed_701" },
    ]);
    mocks.paymentSelectLimit.mockResolvedValue([]);
    mocks.insertValues.mockResolvedValue([{ insertId: 1 }]);
    mocks.feeUpdateWhere.mockResolvedValue([{ affectedRows: 1 }]);
    mocks.paymentUpdateWhere.mockResolvedValue([{ affectedRows: 1 }]);
    mocks.eventUpdateWhere.mockResolvedValue([{ affectedRows: 1 }]);
    mocks.mockDb.transaction.mockImplementation(
      async (callback: (tx: typeof mocks.mockDb) => Promise<void>) => {
        try {
          return await callback(mocks.mockDb);
        } catch (error) {
          mocks.transactionRollback();
          throw error;
        }
      }
    );
  });

  afterEach(() => vi.unstubAllEnvs());

  it("rejects invalid signatures before claiming or mutating the event", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "configured-for-test");
    const response = await postWebhook(
      {
        id: "evt_invalid_signature_701",
        type: "invoice.payment_failed",
        data: { object: {} },
      },
      { "stripe-signature": "invalid-signature" }
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      "Webhook signature verification failed."
    );
    expect(mocks.claimStripeWebhookEvent).not.toHaveBeenCalled();
  });

  it("rejects unsigned events in production when the webhook secret is absent", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await postWebhook({
      id: "evt_unsigned_701",
      type: "invoice.paid",
      data: { object: {} },
    });
    expect(response.status).toBe(400);
    expect(mocks.claimStripeWebhookEvent).not.toHaveBeenCalled();
  });

  it("commits failed payment, fee suspension, audit, review, and event completion in one transaction", async () => {
    const response = await postWebhook({
      id: "evt_payment_failure_701",
      type: "invoice.payment_failed",
      data: { object: invoice("in_failed_701", "failed") },
    });

    expect(response.status).toBe(200);
    expect(mocks.mockDb.transaction).toHaveBeenCalledOnce();
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        successFeeId: 701,
        userId: 81,
        amount: 25000,
        status: "failed",
        stripeInvoiceId: "in_failed_701",
      })
    );
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "stripe_payment_failed",
        entityType: "success_fee",
        entityId: 701,
      })
    );
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "payment_failed",
        priority: "high",
        title: "Stripe payment failed",
      })
    );
    expect(mocks.eventUpdateWhere).toHaveBeenCalledOnce();
    expect(mocks.failStripeWebhookEvent).not.toHaveBeenCalled();
  });

  it("updates the existing invoice row from failed to paid without inserting a duplicate", async () => {
    mocks.paymentSelectLimit.mockResolvedValueOnce([
      {
        id: 901,
        successFeeId: 701,
        userId: 81,
        amount: 25000,
        currency: "usd",
        stripeInvoiceId: "in_retry_701",
        status: "failed",
        paidAt: null,
      },
    ]);

    const response = await postWebhook({
      id: "evt_retry_paid_701",
      type: "invoice.paid",
      data: { object: invoice("in_retry_701", "paid") },
    });

    expect(response.status).toBe(200);
    expect(mocks.paymentUpdateWhere).toHaveBeenCalledOnce();
    expect(mocks.insertValues).not.toHaveBeenCalledWith(
      expect.objectContaining({ stripeInvoiceId: "in_retry_701" })
    );
  });

  it("rolls back payment state when a later audit write fails", async () => {
    mocks.insertValues.mockImplementation(
      async (values: Record<string, unknown>) => {
        if (values.action === "stripe_payment_failed")
          throw new Error("audit storage unavailable");
        return [{ insertId: 1 }];
      }
    );
    const response = await postWebhook({
      id: "evt_audit_failure_701",
      type: "invoice.payment_failed",
      data: { object: invoice("in_audit_failure_701", "failed") },
    });

    expect(response.status).toBe(500);
    expect(mocks.transactionRollback).toHaveBeenCalledOnce();
    expect(mocks.eventUpdateWhere).not.toHaveBeenCalled();
    expect(mocks.failStripeWebhookEvent).toHaveBeenCalledWith(
      "evt_audit_failure_701",
      expect.any(Error)
    );
  });

  it("quarantines a mismatched Stripe customer without mutating billing state", async () => {
    mocks.userSelectLimit.mockResolvedValueOnce([
      { stripeCustomerId: "cus_other" },
    ]);

    const response = await postWebhook({
      id: "evt_customer_mismatch_701",
      type: "invoice.paid",
      data: { object: invoice("in_mismatch_701", "paid") },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      quarantined: true,
    });
    expect(mocks.insertValues).not.toHaveBeenCalled();
    expect(mocks.eventUpdateWhere).not.toHaveBeenCalled();
    expect(mocks.quarantineStripeWebhookEvent).toHaveBeenCalledWith(
      "evt_customer_mismatch_701",
      "customer_mismatch"
    );
    expect(mocks.failStripeWebhookEvent).not.toHaveBeenCalled();
  });

  it("loads remaining Stripe invoice lines before validating a paginated invoice", async () => {
    mocks.listInvoiceLineItems.mockResolvedValueOnce({
      data: [
        {
          id: "il_complete_701",
          price: {
            id: "price_failed_701",
            currency: "usd",
            unit_amount: 25000,
          },
          quantity: 1,
          amount: 25000,
          currency: "usd",
        },
      ],
      has_more: false,
    });
    const payload = invoice("in_paged_701", "paid");
    payload.lines = { data: [], has_more: true };

    const response = await postWebhook({
      id: "evt_paged_invoice_701",
      type: "invoice.paid",
      data: { object: payload },
    });

    expect(response.status).toBe(200);
    expect(mocks.listInvoiceLineItems).toHaveBeenCalledWith("in_paged_701", {
      limit: 100,
    });
  });

  it.each(["suspended", "disputed"] as const)(
    "does not let invoice recovery clear an existing %s hold",
    async status => {
      mocks.feeSelectLimit.mockResolvedValueOnce([{ ...fee, status }]);
      const response = await postWebhook({
        id: `evt_recovered_invoice_${status}_701`,
        type: "invoice.paid",
        data: { object: invoice(`in_recovered_${status}_701`, "paid") },
      });
      expect(response.status).toBe(200);
      expect(mocks.feeUpdateWhere).not.toHaveBeenCalled();
    }
  );

  it.each(["suspended", "disputed"] as const)(
    "does not let an active subscription update clear an existing %s hold",
    async status => {
      mocks.feeSelectLimit.mockResolvedValueOnce([{ ...fee, status }]);
      const response = await postWebhook({
        id: `evt_active_subscription_${status}_701`,
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_failed_701",
            customer: "cus_failed_701",
            status: "active",
            items: {
              data: [
                {
                  price: {
                    id: "price_failed_701",
                    currency: "usd",
                    unit_amount: 25000,
                  },
                  quantity: 1,
                },
              ],
            },
          },
        },
      });
      expect(response.status).toBe(200);
      expect(mocks.feeUpdateWhere).not.toHaveBeenCalled();
    }
  );

  it("validates and links a completed Checkout subscription atomically", async () => {
    mocks.feeSelectLimit.mockResolvedValueOnce([
      {
        ...fee,
        status: "pending_verification",
        stripeSubscriptionId: null,
        stripeCheckoutSessionId: null,
      },
    ]);
    const response = await postWebhook({
      id: "evt_checkout_completed_701",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_701",
          status: "complete",
          customer: "cus_failed_701",
          client_reference_id: "701",
          metadata: { successFeeId: "701" },
          subscription: "sub_checkout_701",
        },
      },
    });
    expect(response.status).toBe(200);
    expect(mocks.retrieveSubscription).toHaveBeenCalledWith("sub_checkout_701");
    expect(mocks.feeUpdateWhere).toHaveBeenCalledOnce();
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "stripe_checkout_subscription_linked",
        entityType: "success_fee",
        entityId: 701,
      })
    );
  });
});
