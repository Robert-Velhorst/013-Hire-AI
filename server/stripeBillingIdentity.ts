export type StripeFeeIdentity = {
  stripeCustomerId: string | null;
  stripePriceId: string | null;
  monthlyFeeAmount: number;
  currency: string;
};

type StripePrice = {
  id?: string | null;
  currency?: string | null;
  unit_amount?: number | null;
};

type StripeLine = {
  amount?: number | null;
  currency?: string | null;
  quantity?: number | null;
  price?: StripePrice | string | null;
  pricing?: { price_details?: { price?: string | StripePrice | null } } | null;
};

function stripeObjectId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" && id.length > 0 ? id : null;
  }
  return null;
}

function linePrice(line: StripeLine): StripePrice | null {
  const value = line.price ?? line.pricing?.price_details?.price;
  return value && typeof value === "object" ? value : null;
}

export function validateStripeCustomerIdentity(
  expectedCustomerId: string | null,
  providerCustomer: unknown
): string | null {
  const customerId = stripeObjectId(providerCustomer);
  if (!expectedCustomerId || !customerId) return "missing_customer_mapping";
  return expectedCustomerId === customerId ? null : "customer_mismatch";
}

export function validateStripePriceLine(
  fee: StripeFeeIdentity,
  lines: { data?: StripeLine[]; has_more?: boolean } | null | undefined
): string | null {
  if (!fee.stripePriceId || !Number.isSafeInteger(fee.monthlyFeeAmount) || fee.monthlyFeeAmount <= 0) {
    return "incomplete_fee_price_mapping";
  }
  if (!lines || !Array.isArray(lines.data) || lines.has_more) return "incomplete_invoice_lines";

  const matches = lines.data.filter(line => stripeObjectId(line.price) === fee.stripePriceId ||
    stripeObjectId(line.pricing?.price_details?.price) === fee.stripePriceId);
  if (matches.length !== 1) return "invoice_price_mismatch";

  const line = matches[0];
  const price = linePrice(line);
  if (!price || price.id !== fee.stripePriceId) return "invoice_price_mismatch";
  if ((line.currency ?? price.currency ?? "").toUpperCase() !== fee.currency.toUpperCase()) {
    return "currency_mismatch";
  }
  if (line.quantity !== 1 || line.amount !== fee.monthlyFeeAmount || price.unit_amount !== fee.monthlyFeeAmount) {
    return "amount_mismatch";
  }
  return null;
}

export function validateStripeInvoiceIdentity(
  fee: StripeFeeIdentity,
  input: {
    customer?: unknown;
    currency?: string | null;
    amount?: number | null;
    lines?: { data?: StripeLine[]; has_more?: boolean } | null;
  }
): string | null {
  const customerError = validateStripeCustomerIdentity(fee.stripeCustomerId, input.customer);
  if (customerError) return customerError;
  if ((input.currency ?? "").toUpperCase() !== fee.currency.toUpperCase()) return "currency_mismatch";
  if (input.amount !== fee.monthlyFeeAmount) return "amount_mismatch";
  return validateStripePriceLine(fee, input.lines);
}

export function validateStripeSubscriptionIdentity(
  fee: StripeFeeIdentity,
  input: {
    customer?: unknown;
    items?: { data?: Array<{ price?: StripePrice | string | null; quantity?: number | null }> } | null;
  }
): string | null {
  const customerError = validateStripeCustomerIdentity(fee.stripeCustomerId, input.customer);
  if (customerError) return customerError;
  if (!fee.stripePriceId || !Number.isSafeInteger(fee.monthlyFeeAmount) || fee.monthlyFeeAmount <= 0) {
    return "incomplete_fee_price_mapping";
  }
  const items = input.items?.data;
  if (!Array.isArray(items) || items.length !== 1) return "subscription_items_mismatch";
  const [item] = items;
  const price = item.price && typeof item.price === "object" ? item.price : null;
  if (!price || price.id !== fee.stripePriceId || item.quantity !== 1) return "subscription_items_mismatch";
  if ((price.currency ?? "").toUpperCase() !== fee.currency.toUpperCase()) return "currency_mismatch";
  if (price.unit_amount !== fee.monthlyFeeAmount) return "amount_mismatch";
  return null;
}

export function transitionStripeInvoicePaymentStatus(
  existing: "pending" | "paid" | "failed" | "refunded" | null,
  incoming: "paid" | "failed"
): "pending" | "paid" | "failed" | "refunded" {
  if (existing === "refunded") return "refunded";
  if (existing === "paid" && incoming === "failed") return "paid";
  return incoming;
}
