import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("interview-notification aggregate ledger wiring", () => {
  it("uses a joined exact page instead of validating a broad unread list", () => {
    const campaigns = readFileSync(resolve(process.cwd(), "server/applicationCampaigns.ts"), "utf8");
    const database = readFileSync(resolve(process.cwd(), "server/db.ts"), "utf8");
    expect(campaigns).toContain("getUnreadInterviewNotificationPage(userId)");
    expect(campaigns).not.toContain("listUnreadInterviewNotifications(userId, 100)");
    expect(campaigns).toContain("interviewNotificationScope");
    expect(database).toContain("eq(employerResponses.responseType, \"interview_invite\")");
    expect(database).toContain("eq(applications.status, \"interview\")");
  });
});
