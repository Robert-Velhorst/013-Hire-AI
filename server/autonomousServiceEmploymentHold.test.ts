import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserProfile: vi.fn(),
  getAutonomousUserEligibility: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getUserProfile: mocks.getUserProfile,
    getAutonomousUserEligibility: mocks.getAutonomousUserEligibility,
  };
});

import { getAutonomousRunState } from "./db";
import { runScheduledAutonomousForUser } from "./autonomousService";
import { cancelAutonomousRunForEmploymentHold } from "./autonomousRunCancellation";

describe("autonomous employment hold cancellation", () => {
  beforeEach(() => {
    mocks.getUserProfile.mockReset();
    mocks.getAutonomousUserEligibility.mockReset().mockResolvedValue({ eligible: true });
  });

  it("releases an acquired run lease as skipped when hire is reported during preflight", async () => {
    const userId = 190091;
    let releaseProfile!: (value: { preferences: string }) => void;
    mocks.getUserProfile
      .mockResolvedValueOnce({ preferences: JSON.stringify({ autonomousEnabled: true }) })
      .mockImplementationOnce(() => new Promise((resolve) => {
        releaseProfile = resolve;
      }));

    const run = runScheduledAutonomousForUser(userId, 0);
    await vi.waitFor(() => expect(mocks.getUserProfile).toHaveBeenCalledTimes(2));

    expect(cancelAutonomousRunForEmploymentHold(userId)).toBe(true);
    releaseProfile({ preferences: JSON.stringify({ autonomousEnabled: true }) });

    await expect(run).resolves.toBeNull();
    await expect(getAutonomousRunState(userId)).resolves.toMatchObject({
      lastStatus: "skipped",
      lastOutcomeDetail: "Job search paused after a reported hire.",
    });
  });

  it("does not claim to cancel a run after its cancellation signal already fired", async () => {
    const userId = 190092;
    let releaseProfile!: (value: undefined) => void;
    mocks.getUserProfile.mockImplementationOnce(() => new Promise((resolve) => {
      releaseProfile = resolve;
    }));

    const run = runScheduledAutonomousForUser(userId, 0);
    await vi.waitFor(() => expect(mocks.getUserProfile).toHaveBeenCalledOnce());

    expect(cancelAutonomousRunForEmploymentHold(userId)).toBe(true);
    expect(cancelAutonomousRunForEmploymentHold(userId)).toBe(false);
    releaseProfile(undefined);
    await expect(run).resolves.toBeNull();
  });
});
