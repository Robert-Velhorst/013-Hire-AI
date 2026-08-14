import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getUserSuccessFeePage, getUserSuccessFeesForApplications, getUserSuccessFeeSummary } from "./db";
import type { TrpcContext } from "./_core/context";
import { successFeesRouter } from "./routers/successFees";

function createContext(): TrpcContext {
  return {
    user: {
      id: 987_654,
      openId: "success-fee-pagination",
      name: "Pagination User",
      email: "pagination@example.local",
      loginMethod: "test",
      role: "user",
      stripeCustomerId: null,
      accountStatus: "active",
      tosAcceptedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("success-fee operating window", () => {
  it("returns stable empty operating results without a configured database", async () => {
    await expect(getUserSuccessFeePage(987_654, { limit: 500 })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    await expect(getUserSuccessFeesForApplications(987_654, [1, 1, -1, 2])).resolves.toEqual([]);
    await expect(getUserSuccessFeeSummary(987_654)).resolves.toEqual({
      activeFees: 0,
      suspendedFees: 0,
      pausedFees: 0,
      disputedFees: 0,
      pendingVerification: 0,
      overdueVerifications: 0,
      dueSoonVerifications: 0,
      monthlyFeeCents: 0,
      nextVerificationDue: null,
      actionableFee: null,
    });
  });

  it("wires bounded fee reads to their intended product surfaces", () => {
    const router = readFileSync(resolve(process.cwd(), "server/routers/successFees.ts"), "utf8");
    const applications = readFileSync(resolve(process.cwd(), "client/src/pages/Applications.tsx"), "utf8");
    const billing = readFileSync(resolve(process.cwd(), "client/src/pages/Billing.tsx"), "utf8");

    expect(router).toContain("listMyFeePage: protectedProcedure");
    expect(router).toContain("applicationIds: z.array(z.number().int().positive()).max(250)");
    expect(router).not.toContain("getMyFees: protectedProcedure");
    expect(applications).toContain("trpc.successFees.listForApplications.useQuery");
    expect(applications).not.toContain("trpc.successFees.getMyFees.useQuery");
    expect(billing).toContain("trpc.successFees.listMyFeePage.useInfiniteQuery");
    expect(billing).toContain("trpc.successFees.getMyFeeSummary.useQuery");
    expect(billing).toContain("Load older arrangements");
  });

  it("accepts the pagination direction added by tRPC infinite queries", async () => {
    const caller = successFeesRouter.createCaller(createContext());

    await expect(caller.listMyFeePage({ limit: 50, direction: "forward" })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    await expect(caller.getPaymentPage({ limit: 50, direction: "forward" })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("keeps the cursor and application indexes aligned with migration 0048", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle/schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0048_success_fee_operating_indexes.sql"),
      "utf8"
    );
    for (const indexName of [
      "success_fees_user_created_id_idx",
      "success_fees_user_application_created_idx",
      "success_fees_user_status_due_id_idx",
    ]) {
      expect(schema).toContain(indexName);
      expect(migration).toContain(indexName);
    }
    expect(migration).toContain("DROP INDEX `success_fees_user_created_idx`");
  });
});
