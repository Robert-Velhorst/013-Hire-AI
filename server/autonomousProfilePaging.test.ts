import { describe, expect, it, vi } from "vitest";

vi.unmock("./db");

import {
  getProfilesWithAutonomousPreferences,
  patchUserProfilePreferences,
  upsertUserProfile,
} from "./db";

describe("autonomous profile paging", () => {
  it("bounds and keyset-pages enabled standalone profiles", async () => {
    const baseUserId = 8_200_000;
    for (let index = 0; index < 103; index += 1) {
      await upsertUserProfile({
        userId: baseUserId + index,
        preferences: JSON.stringify({ autonomousEnabled: true, scanFrequency: "daily" }),
      });
    }
    await upsertUserProfile({
      userId: baseUserId + 103,
      preferences: JSON.stringify({ autonomousEnabled: false }),
    });
    await upsertUserProfile({ userId: baseUserId + 104, preferences: "not-json" });

    const firstPage = await getProfilesWithAutonomousPreferences(baseUserId - 1, 100);
    const secondPage = await getProfilesWithAutonomousPreferences(firstPage[99].userId, 100);

    expect(firstPage).toHaveLength(100);
    expect(firstPage[0].userId).toBe(baseUserId);
    expect(secondPage.map((profile) => profile.userId)).toEqual([
      baseUserId + 100,
      baseUserId + 101,
      baseUserId + 102,
    ]);

    await patchUserProfilePreferences(baseUserId + 101, { autonomousEnabled: false });
    await expect(getProfilesWithAutonomousPreferences(baseUserId + 99, 100))
      .resolves.toEqual([
        expect.objectContaining({ userId: baseUserId + 100 }),
        expect.objectContaining({ userId: baseUserId + 102 }),
      ]);
  });

  it("caps caller-controlled page sizes", async () => {
    const baseUserId = 8_300_000;
    for (let index = 0; index < 260; index += 1) {
      await upsertUserProfile({
        userId: baseUserId + index,
        preferences: JSON.stringify({ autonomousEnabled: true }),
      });
    }

    await expect(getProfilesWithAutonomousPreferences(baseUserId - 1, 10_000))
      .resolves.toHaveLength(250);
  });
});
