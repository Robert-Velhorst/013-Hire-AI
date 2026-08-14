import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("follow-up pagination wiring", () => {
  it("uses the paged route in Applications while retaining complete internal history", () => {
    const router = readFileSync(resolve(process.cwd(), "server", "routers.ts"), "utf8");
    const page = readFileSync(resolve(process.cwd(), "client", "src", "pages", "Applications.tsx"), "utf8");
    const service = readFileSync(resolve(process.cwd(), "server", "applicationFeatures.ts"), "utf8");

    expect(router).toContain("getFollowUpPage: protectedProcedure");
    expect(router).not.toContain("getFollowUps: protectedProcedure");
    expect(page).toContain("trpc.applications.getFollowUpPage.useInfiniteQuery");
    expect(page).toContain('t("loadEarlierFollowUps")');
    expect(page).not.toContain("followUps.slice(0, 3)");
    expect(service).toContain("export async function getFollowUps(applicationId: number, userId: number)");
    expect(service).toContain("const followUpsForApplication = await getFollowUps(applicationId, userId)");
  });
});
