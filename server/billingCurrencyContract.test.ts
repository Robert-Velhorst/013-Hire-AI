import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BILLING_CURRENCY,
  MIN_MONTHLY_SALARY,
  SUPPORTED_BILLING_CURRENCIES,
} from "@shared/billing";

describe("billing currency contract", () => {
  it("defines a bounded shared currency set and minimum", () => {
    expect(SUPPORTED_BILLING_CURRENCIES).toEqual(["USD", "EUR", "GBP", "CAD", "AUD"]);
    expect(DEFAULT_BILLING_CURRENCY).toBe("USD");
    expect(MIN_MONTHLY_SALARY).toBe(300);
  });

  it("wires the shared contract through reporting and presentation", () => {
    const router = readFileSync(resolve(process.cwd(), "server/routers/successFees.ts"), "utf8");
    const dialog = readFileSync(resolve(process.cwd(), "client/src/components/ReportHireDialog.tsx"), "utf8");
    const billing = readFileSync(resolve(process.cwd(), "client/src/pages/Billing.tsx"), "utf8");

    expect(router).toContain("z.enum(SUPPORTED_BILLING_CURRENCIES)");
    expect(dialog).toContain("SUPPORTED_BILLING_CURRENCIES.map");
    expect(dialog).toContain("formatBillingSalary");
    expect(billing).toContain("formatBillingCurrency(fee.monthlyFeeAmount, fee.currency, locale)");
    expect(billing).not.toContain("${(fee.monthlyFeeAmount / 100).toFixed(2)}");
  });
});
