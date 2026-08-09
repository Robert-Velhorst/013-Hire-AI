import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProfilesWithAutonomousPreferences: vi.fn(),
  runScheduledAutonomousForUser: vi.fn(),
}));

vi.mock("./db", () => ({
  getProfilesWithAutonomousPreferences: mocks.getProfilesWithAutonomousPreferences,
}));

vi.mock("./autonomousService", () => ({
  AUTONOMOUS_RUN_FAILURE: "Autonomous work could not complete. Review the operating ledger before retrying.",
  runScheduledAutonomousForUser: mocks.runScheduledAutonomousForUser,
}));

import { AutonomousScheduler } from "./autonomousScheduler";

describe("AutonomousScheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("carries evidence-gated external actions into scheduler status", async () => {
    mocks.getProfilesWithAutonomousPreferences.mockResolvedValue([
      {
        userId: 17,
        preferences: JSON.stringify({
          autonomousEnabled: true,
          scanFrequency: "daily",
        }),
      },
    ]);
    mocks.runScheduledAutonomousForUser.mockResolvedValue({
      queuedApplicationRecords: 1,
      queuedReviewRecords: 2,
      queuedManualRecords: 0,
      queuedFollowUps: 1,
      skippedDuplicateFollowUps: 1,
      skippedResumeEvidenceActions: 2,
      skippedProfileReadinessActions: 3,
      skippedEvidenceGatedActions: 3,
      skippedEmptySourceActions: 2,
      inboxReauthorizationRequired: 1,
      failedActions: 0,
    });

    const scheduler = new AutonomousScheduler();
    await scheduler.runDueUsers();

    expect(scheduler.getStatus()).toMatchObject({
      usersRun: 1,
      jobsQueued: 3,
      followUpDraftsQueued: 1,
      duplicateFollowUpsSkipped: 1,
      resumeEvidenceBlockedActions: 2,
      profileReadinessBlockedActions: 3,
      evidenceGatedActions: 3,
      emptySourceActionsSkipped: 2,
      inboxReauthorizationRequired: 1,
      failedActions: 0,
    });
    expect(scheduler.getUserStatus(17)).toMatchObject({
      jobsQueued: 3,
      resumeEvidenceBlockedActions: 2,
      profileReadinessBlockedActions: 3,
      evidenceGatedActions: 3,
      emptySourceActionsSkipped: 2,
      inboxReauthorizationRequired: 1,
    });
  });

  it("resets evidence-gated action totals for each scheduler cycle", async () => {
    mocks.getProfilesWithAutonomousPreferences.mockResolvedValue([
      {
        userId: 17,
        preferences: JSON.stringify({
          autonomousEnabled: true,
          scanFrequency: "daily",
        }),
      },
    ]);
    mocks.runScheduledAutonomousForUser
      .mockResolvedValueOnce({
        queuedApplicationRecords: 0,
        queuedReviewRecords: 0,
        queuedManualRecords: 0,
        queuedFollowUps: 0,
        skippedDuplicateFollowUps: 0,
        skippedResumeEvidenceActions: 1,
        skippedProfileReadinessActions: 2,
        skippedEvidenceGatedActions: 2,
        skippedEmptySourceActions: 1,
        inboxReauthorizationRequired: 1,
        failedActions: 0,
      })
      .mockResolvedValueOnce(null);

    const scheduler = new AutonomousScheduler();
    await scheduler.runDueUsers();
    expect(scheduler.getStatus().evidenceGatedActions).toBe(2);
    expect(scheduler.getStatus().resumeEvidenceBlockedActions).toBe(1);
    expect(scheduler.getStatus().profileReadinessBlockedActions).toBe(2);
    expect(scheduler.getStatus().emptySourceActionsSkipped).toBe(1);
    expect(scheduler.getStatus().inboxReauthorizationRequired).toBe(1);

    await scheduler.runDueUsers();
    expect(scheduler.getStatus().evidenceGatedActions).toBe(0);
    expect(scheduler.getStatus().resumeEvidenceBlockedActions).toBe(0);
    expect(scheduler.getStatus().profileReadinessBlockedActions).toBe(0);
    expect(scheduler.getStatus().emptySourceActionsSkipped).toBe(0);
    expect(scheduler.getStatus().inboxReauthorizationRequired).toBe(0);
  });

  it("does not expose a worker exception through scheduler status", async () => {
    mocks.getProfilesWithAutonomousPreferences.mockResolvedValue([
      {
        userId: 18,
        preferences: JSON.stringify({ autonomousEnabled: true, scanFrequency: "daily" }),
      },
    ]);
    mocks.runScheduledAutonomousForUser.mockRejectedValue(
      new Error("Connector failed with Bearer autonomous-worker-secret")
    );

    const scheduler = new AutonomousScheduler();
    await scheduler.runDueUsers();

    expect(scheduler.getStatus().errors).toEqual([
      "User 18: Autonomous work could not complete. Review the operating ledger before retrying.",
    ]);
    expect(JSON.stringify(scheduler.getStatus())).not.toContain("autonomous-worker-secret");
  });

  it("processes enrolled users in bounded keyset pages", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      userId: index + 1,
      preferences: JSON.stringify({ autonomousEnabled: true, scanFrequency: "daily" }),
    }));
    mocks.getProfilesWithAutonomousPreferences
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([{
        userId: 101,
        preferences: JSON.stringify({ autonomousEnabled: true, scanFrequency: "daily" }),
      }]);
    mocks.runScheduledAutonomousForUser.mockResolvedValue(null);

    const scheduler = new AutonomousScheduler();
    await scheduler.runDueUsers();

    expect(mocks.getProfilesWithAutonomousPreferences).toHaveBeenNthCalledWith(1, 0, 100);
    expect(mocks.getProfilesWithAutonomousPreferences).toHaveBeenNthCalledWith(2, 100, 100);
    expect(mocks.runScheduledAutonomousForUser).toHaveBeenCalledTimes(101);
    expect(scheduler.getStatus().enrolledUsers).toBe(101);
  });
});
