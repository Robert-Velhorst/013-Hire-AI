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

  it("runs at most three enrolled users concurrently", async () => {
    mocks.getProfilesWithAutonomousPreferences.mockResolvedValue(
      Array.from({ length: 7 }, (_, index) => ({
        userId: index + 1,
        preferences: JSON.stringify({ autonomousEnabled: true, scanFrequency: "daily" }),
      }))
    );
    let active = 0;
    let maximumActive = 0;
    let releaseWorkers!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseWorkers = resolve;
    });
    mocks.runScheduledAutonomousForUser.mockImplementation(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await gate;
      active -= 1;
      return null;
    });

    const scheduler = new AutonomousScheduler();
    const cycle = scheduler.runDueUsers();
    await vi.waitFor(() => expect(mocks.runScheduledAutonomousForUser).toHaveBeenCalledTimes(3));
    expect(maximumActive).toBe(3);

    releaseWorkers();
    await cycle;
    expect(mocks.runScheduledAutonomousForUser).toHaveBeenCalledTimes(7);
    expect(maximumActive).toBe(3);
  });

  it("continues the bounded page after one user run fails", async () => {
    mocks.getProfilesWithAutonomousPreferences.mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({
        userId: index + 21,
        preferences: JSON.stringify({ autonomousEnabled: true, scanFrequency: "daily" }),
      }))
    );
    mocks.runScheduledAutonomousForUser.mockImplementation(async (userId: number) => {
      if (userId === 22) throw new Error("Bearer provider-secret");
      return null;
    });

    const scheduler = new AutonomousScheduler();
    await scheduler.runDueUsers();

    expect(mocks.runScheduledAutonomousForUser).toHaveBeenCalledTimes(5);
    expect(scheduler.getStatus().errors).toEqual([
      "User 22: Autonomous work could not complete. Review the operating ledger before retrying.",
    ]);
    expect(JSON.stringify(scheduler.getStatus())).not.toContain("provider-secret");
  });
});
