import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getUserActiveMonthlyFeeTotalsByCurrency,
  getUserFeePaymentPage,
  getUserPaidTotalsByCurrency,
} from "./db";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("bounded currency-correct payment history", () => {
  it("returns stable empty results without a configured database", async () => {
    await expect(getUserFeePaymentPage(998_101, { limit: 500 })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    await expect(getUserPaidTotalsByCurrency(998_101)).resolves.toEqual([]);
    await expect(getUserActiveMonthlyFeeTotalsByCurrency(998_101)).resolves.toEqual([]);
  });

  it("enforces ownership, stable cursors, and paid-only currency groups", () => {
    const database = source("server/db.ts");
    const paymentFunctions = database.slice(
      database.indexOf("export async function getUserFeePaymentPage"),
      database.indexOf("export async function getUserSuccessFeesForApplications")
    );

    expect(paymentFunctions).toContain("eq(feePayments.userId, userId)");
    expect(paymentFunctions).toContain("desc(feePayments.createdAt), desc(feePayments.id)");
    expect(paymentFunctions).toContain(".limit(limit + 1)");
    expect(paymentFunctions).toContain('eq(feePayments.status, "paid")');
    expect(paymentFunctions).toContain(".groupBy(normalizedCurrency)");
    expect(paymentFunctions).toContain("getUserActiveMonthlyFeeTotalsByCurrency");
  });

  it("pages Billing history and never sums unlike currencies in the browser", () => {
    const billing = source("client/src/pages/Billing.tsx");
    const router = source("server/routers/successFees.ts");

    expect(billing).toContain("successFees.getPaymentPage.useInfiniteQuery");
    expect(billing).toContain("successFees.getPaymentSummary.useQuery");
    expect(billing).toContain("Load older payments");
    expect(billing).toContain("paidByCurrency.map");
    expect(billing).toContain("monthlyByCurrency.map");
    expect(billing).not.toContain("payments.filter(p => p.status === \"paid\").reduce");
    expect(billing).not.toContain("feeSummary?.monthlyFeeCents");
    expect(router).not.toContain("getPaymentHistory: protectedProcedure");
    expect(router).toContain("limit: z.number().int().min(1).max(100).default(50)");
  });
});
