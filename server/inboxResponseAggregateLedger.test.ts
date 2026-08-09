import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("inbox-response aggregate ledger wiring", () => {
  it("uses the bounded page and exact count in the operating ledger", () => {
    const campaigns = readFileSync(resolve(process.cwd(), "server/applicationCampaigns.ts"), "utf8");
    expect(campaigns).toContain("getPendingInboxResponseCandidatePage(userId)");
    expect(campaigns).not.toContain("listPendingInboxResponseCandidates(userId)");
    expect(campaigns).toContain("inboxResponseCandidatePage.total");
    expect(campaigns).toContain("inboxResponseCandidateScope");
  });
});
