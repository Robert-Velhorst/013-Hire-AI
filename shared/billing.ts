export const SUPPORTED_BILLING_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"] as const;

export type SupportedBillingCurrency = (typeof SUPPORTED_BILLING_CURRENCIES)[number];

export const DEFAULT_BILLING_CURRENCY: SupportedBillingCurrency = "USD";

export const MIN_MONTHLY_SALARY = 300;
