import { describe, expect, it, vi } from "vitest";
import type { ConnectorAuthorization } from "../drizzle/schema";
import {
  getUsableConnectorAccessToken,
  type ConnectorAccessTokenDependencies,
} from "./connectorAccessToken";

function authorization(overrides: Partial<ConnectorAuthorization> = {}): ConnectorAuthorization {
  return {
    id: 1,
    userId: 7,
    provider: "gmail",
    encryptedAccessToken: "encrypted-old-access",
    encryptedRefreshToken: "encrypted-old-refresh",
    accessTokenExpiresAt: new Date("2026-08-14T11:59:00.000Z"),
    tokenType: "Bearer",
    grantedScopes: JSON.stringify([
      "https://www.googleapis.com/auth/gmail.metadata",
      "https://www.googleapis.com/auth/gmail.send",
    ]),
    refreshLeaseToken: null,
    refreshLeaseExpiresAt: null,
    createdAt: new Date("2026-08-01T12:00:00.000Z"),
    updatedAt: new Date("2026-08-01T12:00:00.000Z"),
    ...overrides,
  };
}

function dependencies(): ConnectorAccessTokenDependencies {
  return {
    decryptConnectorToken: vi.fn((token: string) => token === "encrypted-old-refresh" ? "old-refresh" : "old-access"),
    encryptConnectorToken: vi.fn((token: string) => `encrypted:${token}`),
    getConnectorOAuthConfig: vi.fn(() => ({ provider: "gmail" } as never)),
    refreshConnectorAccessToken: vi.fn(),
    acquireConnectorRefreshLease: vi.fn().mockResolvedValue(true),
    getConnectorAuthorization: vi.fn().mockResolvedValue(null),
    releaseConnectorRefreshLease: vi.fn().mockResolvedValue(true),
    upsertConnectorAuthorization: vi.fn(),
    createLeaseToken: vi.fn(() => "lease-token"),
    sleep: vi.fn().mockResolvedValue(undefined),
    currentTime: vi.fn(() => new Date("2026-08-14T12:00:00.000Z").getTime()),
  };
}

describe("shared connector access tokens", () => {
  it("coalesces concurrent refreshes and preserves stored scopes when the provider omits them", async () => {
    const deps = dependencies();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(deps.refreshConnectorAccessToken).mockImplementation(async () => {
      await pending;
      return {
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresAt: new Date("2026-08-14T13:00:00.000Z"),
        tokenType: "Bearer",
        grantedScopes: ["https://www.googleapis.com/auth/gmail.metadata"],
        scopeWasReturned: false,
      };
    });
    const input = {
      userId: 7,
      provider: "gmail" as const,
      authorization: authorization(),
      now: new Date("2026-08-14T12:00:00.000Z"),
      fetcher: vi.fn<typeof fetch>(),
      dependencies: deps,
    };

    const first = getUsableConnectorAccessToken(input);
    const second = getUsableConnectorAccessToken(input);
    release();

    await expect(Promise.all([first, second])).resolves.toEqual(["new-access", "new-access"]);
    expect(deps.refreshConnectorAccessToken).toHaveBeenCalledTimes(1);
    expect(deps.upsertConnectorAuthorization).toHaveBeenCalledWith(expect.objectContaining({
      encryptedRefreshToken: "encrypted:new-refresh",
      grantedScopes: JSON.stringify([
        "https://www.googleapis.com/auth/gmail.metadata",
        "https://www.googleapis.com/auth/gmail.send",
      ]),
    }));
  });

  it("removes a failed refresh from the coalescing map so a later attempt can recover", async () => {
    const deps = dependencies();
    vi.mocked(deps.refreshConnectorAccessToken)
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValueOnce({
        accessToken: "recovered-access",
        refreshToken: null,
        expiresAt: new Date("2026-08-14T13:00:00.000Z"),
        tokenType: "Bearer",
        grantedScopes: ["https://www.googleapis.com/auth/gmail.metadata"],
        scopeWasReturned: true,
      });
    const input = {
      userId: 8,
      provider: "gmail" as const,
      authorization: authorization({ userId: 8 }),
      now: new Date("2026-08-14T12:00:00.000Z"),
      fetcher: vi.fn<typeof fetch>(),
      dependencies: deps,
    };

    await expect(getUsableConnectorAccessToken(input)).rejects.toThrow("provider unavailable");
    await expect(getUsableConnectorAccessToken(input)).resolves.toBe("recovered-access");
    expect(deps.refreshConnectorAccessToken).toHaveBeenCalledTimes(2);
  });

  it("uses a valid access token without invoking the provider or persistence", async () => {
    const deps = dependencies();
    const token = await getUsableConnectorAccessToken({
      userId: 9,
      provider: "gmail",
      authorization: authorization({
        userId: 9,
        accessTokenExpiresAt: new Date("2026-08-14T13:00:01.000Z"),
      }),
      now: new Date("2026-08-14T12:00:00.000Z"),
      fetcher: vi.fn<typeof fetch>(),
      dependencies: deps,
    });

    expect(token).toBe("old-access");
    expect(deps.refreshConnectorAccessToken).not.toHaveBeenCalled();
    expect(deps.upsertConnectorAuthorization).not.toHaveBeenCalled();
  });

  it("waits for another instance and consumes its refreshed token", async () => {
    const deps = dependencies();
    vi.mocked(deps.acquireConnectorRefreshLease).mockResolvedValue(false);
    vi.mocked(deps.getConnectorAuthorization).mockResolvedValue(authorization({
      encryptedAccessToken: "encrypted-other-access",
      accessTokenExpiresAt: new Date("2026-08-14T13:00:00.000Z"),
    }));
    vi.mocked(deps.decryptConnectorToken).mockImplementation((token) =>
      token === "encrypted-other-access" ? "other-access" : "old-refresh"
    );

    await expect(getUsableConnectorAccessToken({
      userId: 10,
      provider: "gmail",
      authorization: authorization({ userId: 10 }),
      now: new Date("2026-08-14T12:00:00.000Z"),
      fetcher: vi.fn<typeof fetch>(),
      dependencies: deps,
    })).resolves.toBe("other-access");

    expect(deps.refreshConnectorAccessToken).not.toHaveBeenCalled();
    expect(deps.releaseConnectorRefreshLease).not.toHaveBeenCalled();
  });

  it("takes over an abandoned refresh lease after it becomes available", async () => {
    const deps = dependencies();
    vi.mocked(deps.acquireConnectorRefreshLease)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    vi.mocked(deps.getConnectorAuthorization).mockResolvedValue(null);
    vi.mocked(deps.refreshConnectorAccessToken).mockResolvedValue({
      accessToken: "takeover-access",
      refreshToken: null,
      expiresAt: new Date("2026-08-14T13:00:00.000Z"),
      tokenType: "Bearer",
      grantedScopes: [],
      scopeWasReturned: true,
    });

    await expect(getUsableConnectorAccessToken({
      userId: 11,
      provider: "gmail",
      authorization: authorization({ userId: 11 }),
      now: new Date("2026-08-14T12:00:00.000Z"),
      fetcher: vi.fn<typeof fetch>(),
      dependencies: deps,
    })).resolves.toBe("takeover-access");

    expect(deps.refreshConnectorAccessToken).toHaveBeenCalledTimes(1);
    expect(deps.releaseConnectorRefreshLease).toHaveBeenCalledWith(11, "gmail", "lease-token");
  });
});
