import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("admin operational queue wiring", () => {
  it("loads admin-only cursor pages and renders navigation for the signal region", () => {
    const adminPage = readFileSync(
      resolve(process.cwd(), "client", "src", "pages", "AdminPanel.tsx"),
      "utf8"
    );
    const adminRouter = readFileSync(
      resolve(process.cwd(), "server", "routers", "admin.ts"),
      "utf8"
    );

    expect(adminRouter).toContain("getOperationalFailures: adminProcedure");
    expect(adminRouter).toContain("getOperationalFailureMonitoringPage(input?.limit ?? 20, input?.cursor)");
    expect(adminRouter).toContain('cursor: z.object({ id: z.number().int().positive() }).strict().optional()');
    expect(adminPage).toContain("trpc.admin.getOperationalFailures.useQuery");
    expect(adminPage).toContain("{ limit: 50, ...(failureCursor ? { cursor: failureCursor } : {}) }");
    expect(adminPage).toContain("operationalFailures?.signals.length ? operationalFailures.signals.map((signal)");
    expect(adminPage).toContain('data-testid="admin-runtime-failure-signals"');
    expect(adminPage).toContain('testId="admin-failures"');
    expect(adminPage).toContain('`${testId}-next-page`');
    expect(adminPage).toContain('`${testId}-previous-page`');
    expect(adminPage).toContain("refetchInterval: 30_000");
    expect(adminPage).toContain('ac("runtimeFailureSignals")');
    expect(adminPage).toContain('dateTimeFormatter.format(new Date(signal.lastOccurredAt))');
    expect(adminPage).not.toContain(">Runtime failure signals<");
  });

  it("uses cursor pages for each financial queue rather than truncating displayed arrays", () => {
    const adminPage = readFileSync(
      resolve(process.cwd(), "client", "src", "pages", "AdminPanel.tsx"),
      "utf8"
    );
    const adminRouter = readFileSync(
      resolve(process.cwd(), "server", "routers", "admin.ts"),
      "utf8"
    );

    for (const procedure of [
      "getSuccessFeeHolds",
      "getStripeReconciliationStatus",
      "getStripeWebhookIssues",
    ]) {
      expect(adminRouter).toContain(`${procedure}: adminProcedure`);
      expect(adminPage).toContain(`trpc.admin.${procedure}.useQuery`);
    }
    expect(adminPage).toContain("stripeWebhookIssues?.items.map(event");
    expect(adminPage).toContain("successFeeHolds?.items.map((hold)");
    expect(adminPage).toContain('testId="admin-stripe-commands"');
    expect(adminPage).toContain('testId="admin-stripe-webhooks"');
    expect(adminPage).toContain('testId="admin-success-fee-holds"');
    expect(adminPage).toContain("stripeReconciliation.commandTotal");
    expect(adminPage).not.toContain("stripeWebhookIssues?.map(event");
    expect(adminPage).not.toContain("successFeeHolds?.map((hold)");
  });
});
