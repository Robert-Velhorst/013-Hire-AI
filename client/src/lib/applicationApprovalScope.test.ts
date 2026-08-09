import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("application approval query scope", () => {
  it("loads approvals only for the bounded interactive application window", () => {
    const page = readFileSync(resolve(process.cwd(), "client", "src", "pages", "Applications.tsx"), "utf8");
    const router = readFileSync(resolve(process.cwd(), "server", "routers.ts"), "utf8");
    const procedure = router.slice(
      router.indexOf("listApprovals: protectedProcedure"),
      router.indexOf("resolveApproval: protectedProcedure")
    );

    expect(page).toContain("applicationIds: approvalApplicationIds");
    expect(page).toContain("approvalApplicationIds.length > 0");
    expect(page).toContain(")).slice(0, 250)");
    expect(procedure).toContain(".max(250)");
    expect(procedure).toContain("listUserApplicationApprovalsForApplications(ctx.user.id, input.applicationIds)");
    expect(procedure).not.toContain("listUserApplicationApprovals(ctx.user.id");
  });
});
