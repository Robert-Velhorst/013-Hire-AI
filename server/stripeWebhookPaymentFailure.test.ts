import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectLimit = vi.fn();
  const insertValues = vi.fn();
  const updateWhere = vi.fn();
  const mockDb = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: selectLimit })),
      })),
    })),
    insert: vi.fn(() => ({ values: insertValues })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: updateWhere })),
    })),
  };

  return {
    mockDb,
    selectLimit,
    insertValues,
    updateWhere,
    getDb: vi.fn(),
    createAuditEvent: vi.fn(),
    createAdminReviewItem: vi.fn(),
    claimStripeWebhookEvent: vi.fn(),
    completeStripeWebhookEvent: vi.fn(),
    failStripeWebhookEvent: vi.fn(),
  };
});

vi.mock("./db", () => ({
  getDb: mocks.getDb,
  createAuditEvent: mocks.createAuditEvent,
  createAdminReviewItem: mocks.createAdminReviewItem,
}));

vi.mock("./stripeWebhookLedger", () => ({
  claimStripeWebhookEvent: mocks.claimStripeWebhookEvent,
  completeStripeWebhookEvent: mocks.completeStripeWebhookEvent,
  failStripeWebhookEvent: mocks.failStripeWebhookEvent,
}));

vi.mock("./stripeClient", () => ({ getStripeClient: vi.fn(() => ({})) }));

import { registerStripeWebhook } from "./stripeWebhook";

async function postWebhook(event: Record<string, unknown>, headers: Record<string, string> = {}) {
  const app = express();
  registerStripeWebhook(app);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Webhook test server did not bind to a TCP port.");

  try {
    return await fetch(`http://127.0.0.1:${address.port}/api/stripe/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(event),
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe("Stripe payment failure webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    mocks.getDb.mockResolvedValue(mocks.mockDb);
    mocks.claimStripeWebhookEvent.mockResolvedValue({ claimed: true });
    mocks.selectLimit.mockResolvedValue([{
      id: 701,
      userId: 81,
      employerName: "Example Employer",
      jobTitle: "Remote Engineer",
      status: "active",
      stripeSubscriptionId: "sub_failed_701",
    }]);
    mocks.insertValues.mockResolvedValue([{ insertId: 1 }]);
    mocks.updateWhere.mockResolvedValue([{ affectedRows: 1 }]);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("does not expose Stripe verification failures to callers", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "configured-for-test");

    const response = await postWebhook(
      { id: "evt_invalid_signature_701", type: "invoice.payment_failed", data: { object: {} } },
      { "stripe-signature": "invalid-signature" }
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Webhook signature verification failed.");
  });

  it("suspends the fee and opens an admin payment-failure review", async () => {
    const response = await postWebhook({
      id: "evt_payment_failure_701",
      type: "invoice.payment_failed",
      data: {
        object: {
          id: "in_failed_701",
          subscription: "sub_failed_701",
          amount_due: 25000,
          currency: "usd",
          period_start: 1_784_217_600,
          period_end: 1_786_809_600,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      successFeeId: 701,
      userId: 81,
      amount: 25000,
      status: "failed",
      stripeInvoiceId: "in_failed_701",
    }));
    expect(mocks.createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "success_fee",
      entityId: 701,
      action: "stripe_payment_failed",
      riskLevel: "high",
    }));
    expect(mocks.createAdminReviewItem).toHaveBeenCalledWith(expect.objectContaining({
      userId: 81,
      entityType: "success_fee",
      entityId: 701,
      category: "payment_failed",
      priority: "high",
      title: "Stripe payment failed",
    }));
    expect(mocks.completeStripeWebhookEvent).toHaveBeenCalledWith("evt_payment_failure_701");
  });

  it("records a past-due subscription transition and opens the recovery review", async () => {
    const response = await postWebhook({
      id: "evt_subscription_past_due_701",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_failed_701",
          status: "past_due",
        },
      },
    });

    expect(response.status).toBe(200);
    expect(mocks.createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "success_fee",
      entityId: 701,
      action: "stripe_subscription_status_updated",
      riskLevel: "high",
      afterState: expect.stringContaining('"suspended"'),
    }));
    expect(mocks.createAdminReviewItem).toHaveBeenCalledWith(expect.objectContaining({
      userId: 81,
      entityType: "success_fee",
      entityId: 701,
      category: "payment_failed",
      priority: "high",
    }));
    expect(mocks.completeStripeWebhookEvent).toHaveBeenCalledWith("evt_subscription_past_due_701");
  });

  it.each(["suspended", "disputed"] as const)(
    "does not let invoice recovery clear an existing %s hold",
    async status => {
      mocks.selectLimit.mockResolvedValueOnce([{
        id: 701,
        userId: 81,
        employerName: "Example Employer",
        jobTitle: "Remote Engineer",
        status,
        stripeSubscriptionId: "sub_failed_701",
      }]);

      const response = await postWebhook({
        id: `evt_recovered_invoice_${status}_701`,
        type: "invoice.paid",
        data: {
          object: {
            id: `in_recovered_${status}_701`,
            subscription: "sub_failed_701",
            amount_paid: 25000,
            currency: "usd",
            status_transitions: { paid_at: 1_784_217_600 },
            period_start: 1_784_217_600,
            period_end: 1_786_809_600,
          },
        },
      });

      expect(response.status).toBe(200);
      expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({
        successFeeId: 701,
        status: "paid",
        stripeInvoiceId: `in_recovered_${status}_701`,
      }));
      expect(mocks.updateWhere).not.toHaveBeenCalled();
      expect(mocks.createAuditEvent).not.toHaveBeenCalledWith(expect.objectContaining({
        action: "success_fee_activated_from_stripe_payment",
      }));
    }
  );

  it.each(["suspended", "disputed"] as const)(
    "does not let an active subscription update clear an existing %s hold",
    async status => {
      mocks.selectLimit.mockResolvedValueOnce([{
        id: 701,
        userId: 81,
        employerName: "Example Employer",
        jobTitle: "Remote Engineer",
        status,
        stripeSubscriptionId: "sub_failed_701",
      }]);

      const response = await postWebhook({
        id: `evt_recovered_subscription_${status}_701`,
        type: "customer.subscription.updated",
        data: { object: { id: "sub_failed_701", status: "active" } },
      });

      expect(response.status).toBe(200);
      expect(mocks.updateWhere).not.toHaveBeenCalled();
      expect(mocks.createAuditEvent).not.toHaveBeenCalledWith(expect.objectContaining({
        action: "stripe_subscription_status_updated",
      }));
    }
  );

  it("links a hosted Checkout subscription to the existing success-fee ledger", async () => {
    mocks.selectLimit.mockResolvedValueOnce([{
      id: 701,
      userId: 81,
      employerName: "Example Employer",
      jobTitle: "Remote Engineer",
      status: "pending_verification",
      stripeSubscriptionId: null,
    }]);

    const response = await postWebhook({
      id: "evt_checkout_completed_701",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_701",
          status: "complete",
          client_reference_id: "701",
          metadata: { successFeeId: "701" },
          subscription: "sub_checkout_701",
        },
      },
    });

    expect(response.status).toBe(200);
    expect(mocks.mockDb.update).toHaveBeenCalled();
    expect(mocks.createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "success_fee",
      entityId: 701,
      action: "stripe_checkout_subscription_linked",
      riskLevel: "critical",
    }));
    expect(mocks.completeStripeWebhookEvent).toHaveBeenCalledWith("evt_checkout_completed_701");
  });
});
