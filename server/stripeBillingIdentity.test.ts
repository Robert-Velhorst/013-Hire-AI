import { describe, expect, it } from "vitest";
import {
  transitionStripeInvoicePaymentStatus,
  validateStripeCustomerIdentity,
  validateStripeInvoiceIdentity,
  validateStripeSubscriptionIdentity,
} from "./stripeBillingIdentity";

const fee = {
  stripeCustomerId: "cus_123",
  stripePriceId: "price_123",
  monthlyFeeAmount: 2500,
  currency: "EUR",
};

const validInvoice = {
  customer: "cus_123",
  currency: "eur",
  amount: 2500,
  lines: {
    has_more: false,
    data: [
      {
        price: { id: "price_123", currency: "eur", unit_amount: 2500 },
        quantity: 1,
        amount: 2500,
        currency: "eur",
      },
    ],
  },
};

describe("Stripe fee billing identity", () => {
  it("accepts invoices only when customer, currency, amount, quantity, and price agree", () => {
    expect(validateStripeInvoiceIdentity(fee, validInvoice)).toBeNull();
    expect(
      validateStripeInvoiceIdentity(fee, {
        ...validInvoice,
        customer: "cus_other",
      })
    ).toBe("customer_mismatch");
    expect(
      validateStripeInvoiceIdentity(fee, { ...validInvoice, currency: "USD" })
    ).toBe("currency_mismatch");
    expect(
      validateStripeInvoiceIdentity(fee, { ...validInvoice, amount: 2600 })
    ).toBe("amount_mismatch");
    expect(
      validateStripeInvoiceIdentity(fee, {
        ...validInvoice,
        lines: { data: [], has_more: false },
      })
    ).toBe("invoice_price_mismatch");
  });

  it("fails closed when customer mappings or complete invoice lines are absent", () => {
    expect(validateStripeCustomerIdentity(null, "cus_123")).toBe(
      "missing_customer_mapping"
    );
    expect(
      validateStripeInvoiceIdentity(fee, { ...validInvoice, customer: null })
    ).toBe("missing_customer_mapping");
    expect(
      validateStripeInvoiceIdentity(fee, {
        ...validInvoice,
        lines: { data: validInvoice.lines.data, has_more: true },
      })
    ).toBe("incomplete_invoice_lines");
  });

  it("validates subscription price and quantity before accepting lifecycle events", () => {
    const subscription = {
      customer: { id: "cus_123" },
      items: {
        data: [
          {
            price: { id: "price_123", currency: "eur", unit_amount: 2500 },
            quantity: 1,
          },
        ],
      },
    };
    expect(validateStripeSubscriptionIdentity(fee, subscription)).toBeNull();
    expect(
      validateStripeSubscriptionIdentity(fee, {
        ...subscription,
        items: {
          data: [
            {
              price: { id: "price_other", currency: "eur", unit_amount: 2500 },
              quantity: 1,
            },
          ],
        },
      })
    ).toBe("subscription_items_mismatch");
  });

  it("keeps payment transitions monotonic and does not undo refunds", () => {
    expect(transitionStripeInvoicePaymentStatus("failed", "paid")).toBe("paid");
    expect(transitionStripeInvoicePaymentStatus("paid", "failed")).toBe("paid");
    expect(transitionStripeInvoicePaymentStatus("refunded", "paid")).toBe(
      "refunded"
    );
    expect(transitionStripeInvoicePaymentStatus(null, "failed")).toBe("failed");
  });
});
