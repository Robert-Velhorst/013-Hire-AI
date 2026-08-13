import { describe, expect, it } from "vitest";
import {
  acquireConnectorRefreshLease,
  releaseConnectorRefreshLease,
  upsertConnectorAuthorization,
} from "./db";

describe("connector refresh leases", () => {
  it("allows one owner and protects a successor from stale release", async () => {
    const userId = 91_070;
    await upsertConnectorAuthorization({
      userId,
      provider: "gmail",
      encryptedAccessToken: "encrypted-access",
      encryptedRefreshToken: "encrypted-refresh",
    });

    await expect(acquireConnectorRefreshLease(userId, "gmail", "first", 60_000)).resolves.toBe(true);
    await expect(acquireConnectorRefreshLease(userId, "gmail", "second", 60_000)).resolves.toBe(false);
    await expect(releaseConnectorRefreshLease(userId, "gmail", "stale")).resolves.toBe(false);
    await expect(releaseConnectorRefreshLease(userId, "gmail", "first")).resolves.toBe(true);
    await expect(acquireConnectorRefreshLease(userId, "gmail", "second", 60_000)).resolves.toBe(true);
    await expect(releaseConnectorRefreshLease(userId, "gmail", "second")).resolves.toBe(true);
  });
});
