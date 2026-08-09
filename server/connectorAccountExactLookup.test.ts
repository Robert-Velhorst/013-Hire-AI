import { describe, expect, it } from "vitest";
import { getUserConnectorAccount, upsertUserConnectorAccount } from "./db";

describe("exact connector account lookup", () => {
  it("selects one provider for one owner without leaking adjacent accounts", async () => {
    const ownerId = 971_001;
    const otherUserId = 971_002;
    await Promise.all([
      upsertUserConnectorAccount({ userId: ownerId, provider: "gmail", status: "connected" }),
      upsertUserConnectorAccount({ userId: ownerId, provider: "dropbox", status: "needs_reauth" }),
      upsertUserConnectorAccount({ userId: otherUserId, provider: "gmail", status: "disabled" }),
    ]);

    await expect(getUserConnectorAccount(ownerId, "gmail")).resolves.toMatchObject({
      userId: ownerId,
      provider: "gmail",
      status: "connected",
    });
    await expect(getUserConnectorAccount(ownerId, "outlook")).resolves.toBeUndefined();
    await expect(getUserConnectorAccount(otherUserId, "gmail")).resolves.toMatchObject({
      userId: otherUserId,
      status: "disabled",
    });
  });
});
