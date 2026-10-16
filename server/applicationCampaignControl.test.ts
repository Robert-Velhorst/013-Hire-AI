import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { getUserOperatingLedger } from "./applicationCampaigns";
import { runAutonomousForUser, runScheduledAutonomousForUser } from "./autonomousService";
import {
  getAuditEventsForUser,
  getUserByOpenId,
  getUserApplications,
  upsertUser,
  transitionApplicationCampaignStatus,
  upsertUserProfile,
} from "./db";
import { appRouter } from "./routers";

function createContext(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `campaign-user-${userId}`,
      name: "Campaign User",
      email: `campaign-${userId}@example.local`,
      loginMethod: "test",
      role: "user",
      stripeCustomerId: null,
      accountStatus: "active",
      tosAcceptedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

async function createEligibleTestUser(label: string) {
  const openId = `campaign-user-${label}`;
  await upsertUser({
    openId,
    email: `campaign-${label}@example.local`,
    accountStatus: "active",
    tosAcceptedAt: new Date(),
  });
  const user = await getUserByOpenId(openId);
  if (!user) throw new Error("Unable to create campaign test user.");
  return user.id;
}

describe("application campaign control", () => {
  it("persists a user pause through ledger resync and records the control decision", async () => {
    const userId = await createEligibleTestUser("99501");
    await upsertUserProfile({
      userId,
      skills: "React, TypeScript",
      experience: "Five years of remote product engineering.",
      desiredJobTypes: "Frontend Engineer",
      desiredLocations: "Remote",
      resumeUrl: "https://example.com/resume.pdf",
    });
    const caller = appRouter.createCaller(createContext(userId));

    const paused = await caller.applications.setCampaignStatus({ status: "paused" });
    const ledger = await caller.applications.getOperatingLedger();
    const audits = await getAuditEventsForUser(userId, 10);

    expect(paused.campaign.status).toBe("paused");
    expect(ledger.campaign.status).toBe("paused");
    expect(ledger.blockers).toContain("Campaign is paused");
    expect(ledger.nextActions).toContain("Resume the paused campaign before autonomous work can run.");
    expect(audits.some((event) =>
      event.action === "application_campaign_status_changed" &&
      event.source === "applications.setCampaignStatus" &&
      event.afterState?.includes('"status":"paused"')
    )).toBe(true);
  });

  it("requires a restart reason and explicit criteria review before resuming", async () => {
    const userId = await createEligibleTestUser("99503");
    await upsertUserProfile({
      userId,
      skills: "React, TypeScript",
      experience: "Five years of remote product engineering.",
      desiredJobTypes: "Frontend Engineer",
      desiredLocations: "Remote",
      resumeUrl: "https://example.com/resume.pdf",
    });
    const caller = appRouter.createCaller(createContext(userId));
    await caller.applications.setCampaignStatus({ status: "paused" });

    await expect(
      caller.applications.setCampaignStatus({ status: "active" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.applications.setCampaignStatus({
        status: "active",
        reason: "My employment has ended and I am ready to look again.",
        criteriaConfirmed: false,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const resumed = await caller.applications.setCampaignStatus({
      status: "active",
      reason: "My employment has ended and I am ready to look again.",
      criteriaConfirmed: true,
    });
    const audits = await getAuditEventsForUser(userId, 10);

    expect(resumed.campaign.status).toBe("active");
    expect(audits.some((event) =>
      event.action === "application_campaign_status_changed" &&
      event.afterState?.includes("My employment has ended and I am ready to look again.")
    )).toBe(true);
  });

  it("does not allow an active status write to bypass restart confirmation", async () => {
    const userId = await createEligibleTestUser("99504");
    await upsertUserProfile({
      userId,
      skills: "React, TypeScript",
      experience: "Five years of remote product engineering.",
      desiredJobTypes: "Frontend Engineer",
      desiredLocations: "Remote",
      resumeUrl: "https://example.com/resume.pdf",
    });
    const caller = appRouter.createCaller(createContext(userId));

    await expect(
      caller.applications.setCampaignStatus({ status: "active" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await caller.applications.getOperatingLedger()).campaign.status).toBe("active");
  });

  it("blocks both manual and scheduled autonomous runs while the campaign is paused", async () => {
    const userId = await createEligibleTestUser("99502");
    await upsertUserProfile({
      userId,
      skills: "React, TypeScript, Node.js",
      experience: "Five years building production web applications.",
      desiredJobTypes: "Frontend Engineer",
      desiredLocations: "Remote",
      resumeUrl: "https://example.com/resume.pdf",
      preferences: JSON.stringify({
        autonomousEnabled: true,
        minMatchScore: 0,
        dailyApplicationLimit: 2,
      }),
    });
    await getUserOperatingLedger(userId);
    await transitionApplicationCampaignStatus({ userId, status: "paused" });

    await expect(runAutonomousForUser(userId)).rejects.toThrow("paused job-search campaign");
    await expect(runScheduledAutonomousForUser(userId, 0)).resolves.toBeNull();
    expect(await getUserApplications(userId)).toHaveLength(0);
  });
});
