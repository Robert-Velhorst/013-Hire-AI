import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("autonomous plan preview scope", () => {
  it("routes preview planning through bounded operating queries", () => {
    const router = readFileSync(resolve(process.cwd(), "server", "routers.ts"), "utf8");
    const campaigns = readFileSync(resolve(process.cwd(), "server", "applicationCampaigns.ts"), "utf8");
    const route = router.slice(
      router.indexOf("plan: protectedProcedure", router.indexOf("automation: router")),
      router.indexOf("run: protectedProcedure", router.indexOf("automation: router"))
    );
    const preview = campaigns.slice(
      campaigns.indexOf("export async function getUserAutonomousPlanPreview"),
      campaigns.indexOf("export async function getUserOperatingLedger")
    );

    expect(route).toContain("getUserAutonomousPlanPreview(ctx.user.id, input || {})");
    expect(route).not.toContain("getUserApplications(ctx.user.id)");
    expect(route).not.toContain("getUserApplicationDecisions(ctx.user.id)");
    expect(route).not.toContain("listUserApplicationApprovals(ctx.user.id");
    expect(preview).toContain("getUserOperatingApplicationWindow(userId)");
    expect(preview).toContain("getUserApplicationsForJobs(userId, jobIds)");
    expect(preview).toContain("getUserApplicationDecisionsForJobs(userId, jobIds)");
    expect(preview).toContain("countUserAutonomousPreparationsSince(userId, startOfToday)");
    expect(preview).toContain("getUserOperatingApplicationApprovals(");
  });
});
