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
    expect(listFees).toContain("const feeWindow = await db");
    expect(listFees).toContain(".where(inArray(successFees.id, feeWindow.map((fee) => fee.id)))");
    expect(listFees.match(/\.offset\(input\.offset\)/g)).toHaveLength(1);
  });

  it("runs the production query-plan audit in container CI", () => {
    const workflow = readFileSync(resolve(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");

    expect(workflow).toContain("--entrypoint node hire-ai:ci dist/database-query-plan-audit.js");
  });
});
