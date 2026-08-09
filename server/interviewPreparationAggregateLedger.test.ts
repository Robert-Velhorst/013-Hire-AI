import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("interview-preparation aggregate ledger wiring", () => {
  it("uses an exact bounded actionable page instead of user preparation history", () => {
    const campaigns = readFileSync(resolve(process.cwd(), "server/applicationCampaigns.ts"), "utf8");
    const features = readFileSync(resolve(process.cwd(), "server/applicationFeatures.ts"), "utf8");
    expect(campaigns).toContain("getUpcomingInterviewPreparationPage(userId)");
    expect(campaigns).not.toContain("listInterviewPreparationsForUser(userId)");
    expect(campaigns).toContain("interviewPreparationScope");
    expect(features).toContain("leftJoin(interviewPreparation, preparationJoin)");
    expect(features).toContain("isNull(interviewPreparation.id)");
  });
});
