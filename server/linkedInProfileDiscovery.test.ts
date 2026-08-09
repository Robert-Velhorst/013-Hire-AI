import { describe, expect, it, vi } from "vitest";
import {
  discoverLinkedInIdentity,
  type LinkedInProfileDiscoveryDependencies,
} from "./linkedInProfileDiscovery";

const now = new Date("2026-07-13T12:00:00.000Z");

function dependencies(): LinkedInProfileDiscoveryDependencies {
  return {
    getConnectorAuthorization: vi.fn().mockResolvedValue({
      encryptedAccessToken: "encrypted-linkedin-token",
      accessTokenExpiresAt: new Date("2026-07-14T12:00:00.000Z"),
    }),
    getUserConnectorAccount: vi.fn().mockResolvedValue({
      userId: 21,
      provider: "linkedin",
      status: "connected",
      consentScopes: JSON.stringify(["profile.basic.read"]),
      externalAccountLabel: null,
      connectionRequestedAt: now,
      lastVerifiedAt: now,
      disconnectedAt: null,
    }),
    upsertUserConnectorAccount: vi.fn().mockResolvedValue(undefined),
    decryptConnectorToken: vi.fn().mockReturnValue("linkedin-access-token"),
  } as unknown as LinkedInProfileDiscoveryDependencies;
}

describe("LinkedIn identity discovery", () => {
  it("reads only consented OIDC identity claims and refreshes account evidence", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      sub: "linked-in-subject",
      name: "Avery Example",
      email: "avery@example.test",
      email_verified: true,
    }), { status: 200 }));
    const deps = dependencies();

    const result = await discoverLinkedInIdentity(21, { fetcher, now, dependencies: deps });

    expect(result).toEqual({
      provider: "linkedin",
      name: "Avery Example",
      email: "avery@example.test",
      emailVerified: true,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.linkedin.com/v2/userinfo",
      expect.objectContaining({
        headers: { Authorization: "Bearer linkedin-access-token" },
        redirect: "error",
        signal: expect.any(AbortSignal),
      })
    );
    expect(deps.upsertUserConnectorAccount).toHaveBeenCalledWith(expect.objectContaining({
      provider: "linkedin",
      externalAccountLabel: "Avery Example <avery@example.test>",
      lastVerifiedAt: now,
    }));
  });

  it("rejects stale consent before reading LinkedIn data", async () => {
    const deps = dependencies();
    (deps.getUserConnectorAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: 21,
      provider: "linkedin",
      status: "connected",
      consentScopes: JSON.stringify(["profile.basic.read"]),
      lastVerifiedAt: new Date("2026-06-01T00:00:00.000Z"),
    });
    const fetcher = vi.fn();

    await expect(discoverLinkedInIdentity(21, { fetcher, now, dependencies: deps }))
      .rejects.toThrow("freshly authorized");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("marks the connector for reauthorization when LinkedIn rejects its grant", async () => {
    const deps = dependencies();
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));

    await expect(discoverLinkedInIdentity(21, { fetcher, now, dependencies: deps }))
      .rejects.toThrow("authorization is no longer valid");
    expect(deps.upsertUserConnectorAccount).toHaveBeenCalledWith(expect.objectContaining({
      provider: "linkedin",
      status: "needs_reauth",
      lastVerifiedAt: now,
    }));
  });

  it("rejects oversized LinkedIn identity metadata before refreshing account evidence", async () => {
    const deps = dependencies();
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", {
      status: 200,
      headers: { "content-length": String(1024 * 1024 + 1) },
    }));

    await expect(discoverLinkedInIdentity(21, { fetcher, now, dependencies: deps }))
      .rejects.toThrow("Outbound response exceeded");
    expect(deps.upsertUserConnectorAccount).not.toHaveBeenCalled();
  });

  it("does not treat a LinkedIn grant without expiry metadata as permanent access", async () => {
    const deps = dependencies();
    (deps.getConnectorAuthorization as ReturnType<typeof vi.fn>).mockResolvedValue({
      encryptedAccessToken: "encrypted-linkedin-token",
      accessTokenExpiresAt: null,
    });
    const fetcher = vi.fn();

    await expect(discoverLinkedInIdentity(21, { fetcher, now, dependencies: deps }))
      .rejects.toThrow("authorization has expired");
    expect(deps.upsertUserConnectorAccount).toHaveBeenCalledWith(expect.objectContaining({
      provider: "linkedin",
      status: "needs_reauth",
    }));
    expect(fetcher).not.toHaveBeenCalled();
  });
});
