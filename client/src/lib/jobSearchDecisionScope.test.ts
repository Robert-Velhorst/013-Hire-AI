import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("job search decision query scope", () => {
  it("loads decisions only for the bounded visible job result set", () => {
    const page = readFileSync(resolve(process.cwd(), "client", "src", "pages", "JobSearch.tsx"), "utf8");
    const router = readFileSync(resolve(process.cwd(), "server", "routers.ts"), "utf8");
    const procedure = router.slice(
      router.indexOf("listDecisions: protectedProcedure"),
      router.indexOf("getOperatingLedger: protectedProcedure")
    );

    expect(page).toContain("jobIds: visibleJobIds");
    expect(page).toContain("visibleJobIds.length > 0");
    expect(procedure).toContain(".max(250)");
    expect(procedure).toContain("getUserApplicationDecisionsForJobs(ctx.user.id, input.jobIds)");
    expect(procedure).not.toContain("getUserApplicationDecisions(ctx.user.id)");
  });
});
