import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("admin fee query contract", () => {
  it("uses a deterministic order matching the production indexes", () => {
    const router = readFileSync(resolve(process.cwd(), "server", "routers", "admin.ts"), "utf8");
    const listFees = router.slice(
      router.indexOf("listFees: adminProcedure"),
      router.indexOf("listOverdueVerifications: adminProcedure"),
    );

    expect(listFees).toContain(
      ".orderBy(desc(successFees.createdAt), desc(successFees.id))",
    );
    expect(listFees).toContain("adminTimestampIdCursorSchema.optional()");
    expect(listFees).toContain("lt(successFees.createdAt, input.cursor.timestamp)");
    expect(listFees).toContain("lt(successFees.id, input.cursor.id)");
    expect(listFees).toContain("COUNT(*)");
    expect(listFees).not.toContain(".offset(");
  });

  it("runs the production query-plan audit in container CI", () => {
    const workflow = readFileSync(resolve(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");

    expect(workflow).toContain("--entrypoint node hire-ai:ci dist/database-query-plan-audit.js");
  });

  it("uses stable keyset cursors and filtered totals for payment history", () => {
    const router = readFileSync(resolve(process.cwd(), "server", "routers", "admin.ts"), "utf8");
    const listPayments = router.slice(
      router.indexOf("listPayments: adminProcedure"),
      router.indexOf("addNote: adminProcedure"),
    );

    expect(listPayments).toContain("adminTimestampIdCursorSchema.optional()");
    expect(listPayments).toContain("z.enum([\"all\", \"pending\", \"paid\", \"failed\", \"refunded\"])");
    expect(listPayments).toContain("lt(feePayments.createdAt, input.cursor.timestamp)");
    expect(listPayments).toContain("lt(feePayments.id, input.cursor.id)");
    expect(listPayments).toContain(".orderBy(desc(feePayments.createdAt), desc(feePayments.id))");
    expect(listPayments).toContain("COUNT(*)");
    expect(listPayments).not.toContain(".offset(");
  });

  it("keeps fee and payment page cursors attached to their active filters", () => {
    const panel = readFileSync(resolve(process.cwd(), "client", "src", "pages", "AdminPanel.tsx"), "utf8");

    expect(panel).toContain("status: feeStatusFilter, limit: 50");
    expect(panel).toContain("status: paymentStatusFilter");
    expect(panel).toContain("setFeeCursorHistory([undefined])");
    expect(panel).toContain("setPaymentCursorHistory([undefined])");
    expect(panel).toContain("setReviewCursorHistory([undefined])");
    expect(panel).toContain('testId="admin-fees"');
    expect(panel).toContain('testId="admin-payments"');
    expect(panel).toContain('testId="admin-reviews"');
    expect(panel).toContain('data-testid={`${testId}-next-page`}');
  });
});
