import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getUserAcceptedApplications } from "./db";

describe("accepted-offer operating reads", () => {
  it("returns a bounded empty result without a configured database", async () => {
    await expect(getUserAcceptedApplications(987_655, { limit: 500 })).resolves.toEqual([]);
  });

  it("wires the report-hire picker to accepted offers instead of general application history", () => {
    const router = readFileSync(resolve(process.cwd(), "server/routers.ts"), "utf8");
    const dialog = readFileSync(resolve(process.cwd(), "client/src/components/ReportHireDialog.tsx"), "utf8");

    expect(router).toContain("listAcceptedOffers: protectedProcedure");
    expect(router).toContain("includeApplicationId: input.applicationId");
    expect(dialog).toContain("trpc.applications.listAcceptedOffers.useQuery");
    expect(dialog).not.toContain("trpc.applications.list.useQuery");
  });

  it("keeps memory ownership checks exact and bounded", () => {
    const features = readFileSync(resolve(process.cwd(), "server/applicationFeatures.ts"), "utf8");
    expect(features).not.toContain("getUserApplications(userId)");
    expect(features.match(/getUserApplicationsByIds\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(features.match(/\.slice\(0, 500\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(features).toContain("offset += 500");
    expect(features).toContain("getMemoryUpcomingInterviewContexts(userId, now, 10)");
    expect(features).toContain("ownedUpcoming.length < requestedLimit");
  });
});
