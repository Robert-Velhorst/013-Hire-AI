import { beforeEach, describe, expect, it, vi } from "vitest";
import { disconnectConnectorAccess } from "./connectorDisconnect";
import {
  getConnectorAuthorization,
  listUserConnectorAccounts,
  upsertConnectorAuthorization,
  upsertUserConnectorAccount,
} from "./db";
import * as connectorOAuth from "./connectorOAuth";

async function connect(
  userId: number,
  provider: "dropbox" | "linkedin" | "gmail" | "google_drive"
) {
  await upsertUserConnectorAccount({
    userId,
    provider,
    status: "connected",
    lastVerifiedAt: new Date(),
  });
  await upsertConnectorAuthorization({
    userId,
    provider,
    encryptedAccessToken: "encrypted-token",
  });
}

describe("connector disconnect cleanup", () => {
  beforeEach(() => {
    vi.spyOn(connectorOAuth, "decryptConnectorToken").mockReturnValue(
      "decrypted-token"
    );
  });

  it("deletes the local grant after provider revocation succeeds", async () => {
    const userId = 99671;
    await connect(userId, "dropbox");
    const revoker = vi.fn(async () => ({
      status: "revoked" as const,
      detail: "Dropbox OAuth access was revoked.",
    }));

    const result = await disconnectConnectorAccess(userId, "dropbox", revoker);

    expect(result.providerRevocation.status).toBe("revoked");
    expect(revoker).toHaveBeenCalledWith("dropbox", "decrypted-token");
    expect(await getConnectorAuthorization(userId, "dropbox")).toBeNull();
  });

  it("deletes local credentials and returns manual provider cleanup guidance", async () => {
    const userId = 99672;
    await connect(userId, "linkedin");
    const revoker = vi.fn(async () => ({
      status: "manual_required" as const,
      detail: "Remove Hire.AI from LinkedIn permitted services.",
    }));

    const result = await disconnectConnectorAccess(userId, "linkedin", revoker);

    expect(result.providerRevocation.status).toBe("manual_required");
    expect(await getConnectorAuthorization(userId, "linkedin")).toBeNull();
  });

  it("retains the encrypted grant for retry when provider revocation fails", async () => {
    const userId = 99673;
    await connect(userId, "dropbox");
    const revoker = vi.fn(async () => {
      throw new Error("provider unavailable");
    });

    const result = await disconnectConnectorAccess(userId, "dropbox", revoker);

    expect(result.account.status).toBe("disabled");
    expect(result.providerRevocation.status).toBe("failed");
    expect(await getConnectorAuthorization(userId, "dropbox")).not.toBeNull();
  });

  it("cleans and disables both Google connectors after project-wide revocation", async () => {
    const userId = 99674;
    await connect(userId, "gmail");
    await connect(userId, "google_drive");
    const revoker = vi.fn(async () => ({
      status: "revoked" as const,
      detail: "Google OAuth access was revoked.",
    }));

    await disconnectConnectorAccess(userId, "gmail", revoker);

    expect(await getConnectorAuthorization(userId, "gmail")).toBeNull();
    expect(await getConnectorAuthorization(userId, "google_drive")).toBeNull();
    expect(
      (await listUserConnectorAccounts(userId))
        .filter(
          account =>
            account.provider === "gmail" || account.provider === "google_drive"
        )
        .every(account => account.status === "disabled")
    ).toBe(true);
  });
});
