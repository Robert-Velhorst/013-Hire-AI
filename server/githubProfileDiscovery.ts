import { isConnectorAuthorizationStale } from "@shared/profileEvidence";
import { decryptConnectorToken, encryptConnectorToken, getConnectorOAuthConfig, refreshConnectorAccessToken } from "./connectorOAuth";
import { ConnectorAccessTokenError, getUsableConnectorAccessToken } from "./connectorAccessToken";
import {
  acquireConnectorRefreshLease,
  getConnectorAuthorization,
  getUserConnectorAccount,
  releaseConnectorRefreshLease,
  upsertConnectorAuthorization,
  upsertUserConnectorAccount,
} from "./db";
import { providerRequestInit, readProviderJson } from "./_core/providerRequest";

export type GitHubRepositoryCandidate = {
  name: string;
  description: string | null;
  url: string;
  language: string | null;
  updatedAt: string | null;
  stars: number;
};

export type GitHubProfileCandidate = {
  provider: "github";
  username: string;
  profileUrl: string;
  name: string | null;
  bio: string | null;
  location: string | null;
  company: string | null;
  blog: string | null;
  publicRepositoryCount: number;
  suggestedSkills: string[];
  repositories: GitHubRepositoryCandidate[];
};

const MAX_REPOSITORIES = 10;

type ConnectorAccount = NonNullable<Awaited<ReturnType<typeof getUserConnectorAccount>>>;

export type GitHubProfileDiscoveryDependencies = {
  acquireConnectorRefreshLease: typeof acquireConnectorRefreshLease;
  getConnectorAuthorization: typeof getConnectorAuthorization;
  getUserConnectorAccount: typeof getUserConnectorAccount;
  upsertConnectorAuthorization: typeof upsertConnectorAuthorization;
  upsertUserConnectorAccount: typeof upsertUserConnectorAccount;
  decryptConnectorToken: typeof decryptConnectorToken;
  encryptConnectorToken: typeof encryptConnectorToken;
  getConnectorOAuthConfig: typeof getConnectorOAuthConfig;
  refreshConnectorAccessToken: typeof refreshConnectorAccessToken;
  releaseConnectorRefreshLease: typeof releaseConnectorRefreshLease;
};

const defaults: GitHubProfileDiscoveryDependencies = {
  acquireConnectorRefreshLease,
  getConnectorAuthorization,
  getUserConnectorAccount,
  upsertConnectorAuthorization,
  upsertUserConnectorAccount,
  decryptConnectorToken,
  encryptConnectorToken,
  getConnectorOAuthConfig,
  refreshConnectorAccessToken,
  releaseConnectorRefreshLease,
};

function stringValue(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;
}

function httpUrlValue(value: unknown, maxLength: number) {
  const text = stringValue(value, maxLength);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function githubHeaders(accessToken: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "X-GitHub-Api-Version": "2026-03-10",
  };
}

function hasGitHubProfileConsent(account: ConnectorAccount | undefined) {
  try {
    const scopes = account?.consentScopes ? JSON.parse(account.consentScopes) : [];
    return Array.isArray(scopes) && scopes.includes("profile.basic.read");
  } catch {
    return false;
  }
}

async function getGitHubAccessToken(
  userId: number,
  now: Date,
  fetcher: typeof fetch,
  dependencies: GitHubProfileDiscoveryDependencies
) {
  const account = await dependencies.getUserConnectorAccount(userId, "github");
  if (
    !account ||
    account.status !== "connected" ||
    !hasGitHubProfileConsent(account) ||
    isConnectorAuthorizationStale(account.lastVerifiedAt, now)
  ) {
    throw new Error("GitHub must be freshly authorized with profile consent before profile discovery.");
  }

  const authorization = await dependencies.getConnectorAuthorization(userId, "github");
  if (!authorization) {
    await markGitHubAccessNeedsReauth(userId, account, dependencies);
    throw new Error("GitHub authorization is unavailable. Reauthorize before profile discovery.");
  }
  try {
    const accessToken = await getUsableConnectorAccessToken({
      userId,
      provider: "github",
      authorization,
      now,
      fetcher,
      dependencies,
    });
    return { account, accessToken };
  } catch (error) {
    if (error instanceof ConnectorAccessTokenError && error.reason === "expired") {
      await markGitHubAccessNeedsReauth(userId, account, dependencies);
      throw new Error("GitHub authorization has expired. Reauthorize before profile discovery.");
    }
    if (error instanceof ConnectorAccessTokenError && error.reason === "renewal_not_configured") {
      throw new Error("GitHub token renewal is not configured in this deployment.");
    }
    throw error;
  }
}

async function markGitHubAccessNeedsReauth(
  userId: number,
  account: ConnectorAccount,
  dependencies: GitHubProfileDiscoveryDependencies
) {
  await dependencies.upsertUserConnectorAccount({
    userId,
    provider: "github",
    status: "needs_reauth",
    consentScopes: account.consentScopes,
    externalAccountLabel: account.externalAccountLabel,
    connectionRequestedAt: account.connectionRequestedAt,
    lastVerifiedAt: account.lastVerifiedAt,
    disconnectedAt: null,
  });
}

function parseUser(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  const username = stringValue(value.login, 255);
  const profileUrl = httpUrlValue(value.html_url, 500);
  if (!username || !profileUrl) return null;
  return {
    username,
    profileUrl,
    name: stringValue(value.name, 255),
    bio: stringValue(value.bio, 2_000),
    location: stringValue(value.location, 255),
    company: stringValue(value.company, 255),
    blog: httpUrlValue(value.blog, 500),
    publicRepositoryCount: numberValue(value.public_repos),
  };
}

function parseRepositories(payload: unknown): GitHubRepositoryCandidate[] {
  if (!Array.isArray(payload)) return [];
  const seen = new Set<string>();
  const repositories: GitHubRepositoryCandidate[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    if (value.fork === true || value.archived === true) continue;
    const name = stringValue(value.name, 255);
    const url = httpUrlValue(value.html_url, 500);
    if (!name || !url || seen.has(url)) continue;
    seen.add(url);
    repositories.push({
      name,
      description: stringValue(value.description, 5_000),
      url,
      language: stringValue(value.language, 100),
      updatedAt: stringValue(value.updated_at, 100),
      stars: numberValue(value.stargazers_count),
    });
    if (repositories.length === MAX_REPOSITORIES) break;
  }
  return repositories;
}

export function mergeGitHubSkills(existingSkills: string | null | undefined, suggestedSkills: string[]) {
  const values = new Map<string, string>();
  for (const skill of [
    ...(existingSkills || "").split(/[,;\n]/),
    ...suggestedSkills,
  ]) {
    const normalized = skill.trim().toLocaleLowerCase();
    if (normalized && !values.has(normalized)) values.set(normalized, skill.trim());
  }
  return Array.from(values.values()).join(", ");
}

export async function discoverGitHubProfile(
  userId: number,
  options: { fetcher?: typeof fetch; now?: Date; dependencies?: GitHubProfileDiscoveryDependencies } = {}
): Promise<GitHubProfileCandidate> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? new Date();
  const dependencies = options.dependencies ?? defaults;
  const { account, accessToken } = await getGitHubAccessToken(userId, now, fetcher, dependencies);
  const headers = githubHeaders(accessToken);
  const userResponse = await fetcher(
    "https://api.github.com/user",
    providerRequestInit({ headers })
  );
  if (!userResponse.ok) {
    if (userResponse.status === 401 || userResponse.status === 403) {
      await markGitHubAccessNeedsReauth(userId, account, dependencies);
      throw new Error("GitHub authorization is no longer valid. Reauthorize before profile discovery.");
    }
    throw new Error("GitHub profile discovery is temporarily unavailable.");
  }
  const user = parseUser(await readProviderJson<unknown>(userResponse));
  if (!user) throw new Error("GitHub did not return a usable public profile.");

  // This public endpoint avoids requesting access to private repositories.
  const repositoriesResponse = await fetcher(
    `https://api.github.com/users/${encodeURIComponent(user.username)}/repos?` + new URLSearchParams({
      type: "owner",
      sort: "updated",
      direction: "desc",
      per_page: String(MAX_REPOSITORIES),
    }),
    providerRequestInit({ headers })
  );
  if (!repositoriesResponse.ok) {
    if (repositoriesResponse.status === 401 || repositoriesResponse.status === 403) {
      await markGitHubAccessNeedsReauth(userId, account, dependencies);
      throw new Error("GitHub authorization is no longer valid. Reauthorize before profile discovery.");
    }
    throw new Error("GitHub repository discovery is temporarily unavailable.");
  }
  const repositories = parseRepositories(await readProviderJson<unknown>(repositoriesResponse));
  const suggestedSkills = Array.from(new Set(
    repositories.flatMap((repository) => repository.language ? [repository.language] : [])
  )).sort((left, right) => left.localeCompare(right));

  await dependencies.upsertUserConnectorAccount({
    userId,
    provider: "github",
    status: "connected",
    consentScopes: account.consentScopes,
    externalAccountLabel: account.externalAccountLabel,
    connectionRequestedAt: account.connectionRequestedAt,
    lastVerifiedAt: now,
    disconnectedAt: null,
  });

  return { provider: "github", ...user, suggestedSkills, repositories };
}
