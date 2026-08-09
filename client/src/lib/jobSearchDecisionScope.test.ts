import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("job search decision query scope", () => {
  it("loads decisions for visible jobs in bounded chunks", () => {
    const page = readFileSync(resolve(process.cwd(), "client", "src", "pages", "JobSearch.tsx"), "utf8");
    const router = readFileSync(resolve(process.cwd(), "server", "routers.ts"), "utf8");
    const procedure = router.slice(
      router.indexOf("listDecisions: protectedProcedure"),
      router.indexOf("getOperatingLedger: protectedProcedure")
    );

    expect(page).toContain("visibleJobIds.slice(index, index + 250)");
    expect(page).toContain("jobIds.length > 0");
    expect(page).toContain("trpc.useQueries");
    expect(procedure).toContain(".max(250)");
    expect(procedure).toContain("getUserApplicationDecisionsForJobs(ctx.user.id, input.jobIds)");
    expect(procedure).not.toContain("getUserApplicationDecisions(ctx.user.id)");
  });
});
