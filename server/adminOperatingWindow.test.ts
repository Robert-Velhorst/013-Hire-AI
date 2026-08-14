import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getAdminOperatingSummary } from "../client/src/lib/adminOperatingSummary";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("bounded admin operating windows", () => {
  it("uses exact aggregates instead of visible-window lengths", () => {
    const summary = getAdminOperatingSummary({
      reviewQueue: [],
      overdue: [],
      pendingVerifications: [],
      payments: [],
      aggregates: {
        reviewTotal: 180,
        criticalItems: 4,
        highRiskItems: 12,
        overdueVerifications: 30,
        graceExpiredVerifications: 2,
        pendingVerifications: 25,
        failedPayments: 2,
        legalEscalations: 1,
        offerAttributionReviews: 7,
        employmentEndedReviews: 3,
      },
    });

    expect(summary.totalOpenWork).toBe(237);
    expect(summary.criticalItems).toBe(4);
    expect(summary.offerAttributionReviews).toBe(7);
  });

  it("bounds every global admin queue and computes exact aggregate counts", () => {
    const router = source("server/routers/admin.ts");
    const database = source("server/db.ts");

    expect(router).toContain("getOperatingCounts: adminProcedure");
    expect(router).toContain("getReviewQueue: adminProcedure");
    expect(router).toContain("limit: z.number().int().min(1).max(100).default(100)");
    expect(router).toContain("memoryFallback.overdue.slice(0, 100)");
    expect(router).toContain("memoryFallback.pendingVerifications.slice(0, 100)");
    expect(router).toContain(".limit(100)");
    expect(router).toContain("reviewTotal: sql<number>`COUNT(*)`");
    expect(router).toContain("failedPayments: sql<number>");
    expect(database).toContain("requestedLimit = 100");
    expect(database).toContain(".slice(0, limit) as AdminReviewItem[]");
  });

  it("shows exact totals and refreshes aggregate state in the admin interface", () => {
    const admin = source("client/src/pages/AdminPanel.tsx");
    expect(admin).toContain("trpc.admin.getOperatingCounts.useQuery");
    expect(admin).toContain("aggregates: operatingCounts");
    expect(admin).toContain("refetchOperatingCounts()");
    expect(admin).toContain('ff("showingNewestFees"');
    expect(admin).toContain('ff("showingOldestOverdue"');
    expect(admin).toContain('ff("showingNewestPayments"');
  });
});
