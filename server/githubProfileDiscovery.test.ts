import { describe, expect, it, vi } from "vitest";
import {
  discoverGitHubProfile,
  mergeGitHubSkills,
  type GitHubProfileDiscoveryDependencies,
} from "./githubProfileDiscovery";

const now = new Date("2026-07-13T12:00:00.000Z");

function dependencies(): GitHubProfileDiscoveryDependencies {
  return {
    getConnectorAuthorization: vi.fn().mockResolvedValue({
      encryptedAccessToken: "encrypted-github-token",
      accessTokenExpiresAt: new Date("2026-07-13T13:00:00.000Z"),
    }),
    getUserConnectorAccount: vi.fn().mockResolvedValue({
      userId: 18,
      provider: "github",
      status: "connected",
      consentScopes: JSON.stringify(["profile.basic.read", "repositories.metadata.read"]),
      externalAccountLabel: null,
      connectionRequestedAt: now,
      lastVerifiedAt: now,
      disconnectedAt: null,
    }),
    upsertConnectorAuthorization: vi.fn().mockResolvedValue(undefined),
    upsertUserConnectorAccount: vi.fn().mockResolvedValue(undefined),
    decryptConnectorToken: vi.fn().mockReturnValue("github-access-token"),
    encryptConnectorToken: vi.fn((value: string) => `encrypted-${value}`),
    getConnectorOAuthConfig: vi.fn().mockReturnValue({ provider: "github" }),
    refreshConnectorAccessToken: vi.fn(),
  } as unknown as GitHubProfileDiscoveryDependencies;
}

describe("GitHub profile discovery", () => {
  it("reads only public profile and owned public repository metadata", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        login: "octavia",
        html_url: "https://github.com/octavia",
        name: "Octavia Example",
        bio: "Platform engineer",
        public_repos: 4,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { name: "platform", html_url: "https://github.com/octavia/platform", language: "TypeScript", stargazers_count: 4, fork: false, archived: false },
        { name: "docs", html_url: "https://github.com/octavia/docs", language: "TypeScript", stargazers_count: 0, fork: false, archived: true },
        { name: "fork", html_url: "https://github.com/octavia/fork", language: "Go", stargazers_count: 0, fork: true, archived: false },
        { name: "data", html_url: "https://github.com/octavia/data", language: "Python", stargazers_count: 2, fork: false, archived: false },
      ]), { status: 200 }));
    const deps = dependencies();

    const result = await discoverGitHubProfile(18, { fetcher, now, dependencies: deps });

    expect(result).toMatchObject({
      username: "octavia",
      profileUrl: "https://github.com/octavia",
      suggestedSkills: ["Python", "TypeScript"],
    });
    expect(result.repositories.map((repository) => repository.name)).toEqual(["platform", "data"]);
    expect(fetcher.mock.calls[1][0]).toContain("/users/octavia/repos?");
    expect(fetcher.mock.calls[1][0]).toContain("type=owner");
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer github-access-token");
    expect(deps.upsertUserConnectorAccount).toHaveBeenCalledWith(expect.objectContaining({
      provider: "github",
      lastVerifiedAt: now,
    }));
  });

  it("rejects stale connector consent before making an external request", async () => {
    const deps = dependencies();
    (deps.getUserConnectorAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: 18,
      provider: "github",
      status: "connected",
      consentScopes: JSON.stringify(["profile.basic.read"]),
      lastVerifiedAt: new Date("2026-06-01T00:00:00.000Z"),
    });
    const fetcher = vi.fn();

    await expect(discoverGitHubProfile(18, { fetcher, now, dependencies: deps }))
      .rejects.toThrow("freshly authorized");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("renews an expiring GitHub grant before reading public profile metadata", async () => {
    const deps = dependencies();
    (deps.getConnectorAuthorization as ReturnType<typeof vi.fn>).mockResolvedValue({
      encryptedAccessToken: "expired-access-token",
      encryptedRefreshToken: "encrypted-refresh-token",
      accessTokenExpiresAt: new Date("2026-07-13T11:59:00.000Z"),
    });
    (deps.decryptConnectorToken as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce("expired-access-token")
      .mockReturnValueOnce("github-refresh-token");
    (deps.refreshConnectorAccessToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      accessToken: "renewed-github-token",
      refreshToken: "renewed-github-refresh-token",
      expiresAt: new Date("2026-07-13T13:00:00.000Z"),
      tokenType: "Bearer",
      grantedScopes: ["read:user"],
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        login: "octavia",
        html_url: "https://github.com/octavia",
        public_repos: 0,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    await discoverGitHubProfile(18, { fetcher, now, dependencies: deps });

    expect(deps.refreshConnectorAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "github" }),
      "github-refresh-token",
      fetcher
    );
    expect(deps.upsertConnectorAuthorization).toHaveBeenCalledWith(expect.objectContaining({
      provider: "github",
      encryptedAccessToken: "encrypted-renewed-github-token",
      encryptedRefreshToken: "encrypted-renewed-github-refresh-token",
    }));
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer renewed-github-token");
  });

  it("does not treat a GitHub grant without expiry metadata as permanent access", async () => {
    const deps = dependencies();
    (deps.getConnectorAuthorization as ReturnType<typeof vi.fn>).mockResolvedValue({
      encryptedAccessToken: "expired-access-token",
      encryptedRefreshToken: "encrypted-refresh-token",
      accessTokenExpiresAt: null,
    });
    (deps.decryptConnectorToken as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce("expired-access-token")
      .mockReturnValueOnce("github-refresh-token");
    (deps.refreshConnectorAccessToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      accessToken: "renewed-github-token",
      refreshToken: null,
      expiresAt: new Date("2026-07-13T13:00:00.000Z"),
      tokenType: "Bearer",
      grantedScopes: ["read:user"],
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        login: "octavia",
        html_url: "https://github.com/octavia",
        public_repos: 0,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    await discoverGitHubProfile(18, { fetcher, now, dependencies: deps });

    expect(deps.refreshConnectorAccessToken).toHaveBeenCalled();
    expect(deps.upsertConnectorAuthorization).toHaveBeenCalledWith(expect.objectContaining({
      encryptedRefreshToken: "encrypted-refresh-token",
    }));
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer renewed-github-token");
  });

  it("marks the connector for reauthorization when GitHub rejects its grant", async () => {
    const deps = dependencies();
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));

    await expect(discoverGitHubProfile(18, { fetcher, now, dependencies: deps }))
      .rejects.toThrow("authorization is no longer valid");
    expect(deps.upsertUserConnectorAccount).toHaveBeenCalledWith(expect.objectContaining({
      provider: "github",
      status: "needs_reauth",
      lastVerifiedAt: now,
    }));
  });

  it("merges source-supported skills without duplicate casing", () => {
    expect(mergeGitHubSkills("React, typescript", ["TypeScript", "Python"]))
      .toBe("React, typescript, Python");
  });
});
