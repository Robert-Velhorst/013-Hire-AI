import { isConnectorAuthorizationStale } from "@shared/profileEvidence";
import { decryptConnectorToken, encryptConnectorToken, getConnectorOAuthConfig, refreshConnectorAccessToken } from "./connectorOAuth";
import { ConnectorAccessTokenError, getUsableConnectorAccessToken } from "./connectorAccessToken";
import {
  acquireConnectorRefreshLease,
  findEmployerResponseSourceReferences,
  getConnectorAuthorization,
  getUserConnectorAccount,
  releaseConnectorRefreshLease,
  getUserInboxMatchApplications,
  upsertConnectorAuthorization,
  upsertUserConnectorAccount,
} from "./db";
import {
  outboundRequestSignal,
  OUTBOUND_TIMEOUT_MS,
  readBoundedResponseJson,
} from "./_core/outboundRequest";

export type InboxProvider = "gmail" | "outlook";
export type InboxResponseType = "rejection" | "interview_invite" | "offer" | "employer_question" | "other";

export type InboxResponseCandidate = {
  provider: InboxProvider;
  messageId: string;
  applicationId: number;
  company: string;
  jobTitle: string;
  sender: string | null;
  subject: string;
  preview: string;
  receivedAt: string;
  suggestedResponseType: InboxResponseType;
  confidence: "high" | "medium";
};

const MAX_MESSAGES = 50;
const GMAIL_DETAIL_CONCURRENCY = 5;
const MAX_INBOX_LIST_BYTES = 1024 * 1024;
const MAX_INBOX_MESSAGE_BYTES = 256 * 1024;
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const INBOX_RESPONSE_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

export type InboxResponseDiscoveryDependencies = {
  acquireConnectorRefreshLease: typeof acquireConnectorRefreshLease;
  findEmployerResponseSourceReferences: typeof findEmployerResponseSourceReferences;
  getConnectorAuthorization: typeof getConnectorAuthorization;
  getUserInboxMatchApplications: typeof getUserInboxMatchApplications;
  getUserConnectorAccount: typeof getUserConnectorAccount;
  upsertConnectorAuthorization: typeof upsertConnectorAuthorization;
  upsertUserConnectorAccount: typeof upsertUserConnectorAccount;
  decryptConnectorToken: typeof decryptConnectorToken;
  encryptConnectorToken: typeof encryptConnectorToken;
  getConnectorOAuthConfig: typeof getConnectorOAuthConfig;
  refreshConnectorAccessToken: typeof refreshConnectorAccessToken;
  releaseConnectorRefreshLease: typeof releaseConnectorRefreshLease;
};

const defaults: InboxResponseDiscoveryDependencies = {
  acquireConnectorRefreshLease,
  findEmployerResponseSourceReferences,
  getConnectorAuthorization,
  getUserInboxMatchApplications,
  getUserConnectorAccount,
  upsertConnectorAuthorization,
  upsertUserConnectorAccount,
  decryptConnectorToken,
  encryptConnectorToken,
  getConnectorOAuthConfig,
  refreshConnectorAccessToken,
  releaseConnectorRefreshLease,
};

function displayName(provider: InboxProvider) {
  return provider === "gmail" ? "Gmail" : "Outlook";
}

function parseScopes(value: string | null) {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.filter((scope): scope is string => typeof scope === "string") : [];
  } catch {
    return [];
  }
}

async function getInboxAccess(
  userId: number,
  provider: InboxProvider,
  now: Date,
  fetcher: typeof fetch,
  dependencies: InboxResponseDiscoveryDependencies
) {
  const account = await dependencies.getUserConnectorAccount(userId, provider);
  const requiredScope = provider === "gmail" ? "email.messages.read_recruiting" : "mail.messages.read_recruiting";
  if (
    !account ||
    account.status !== "connected" ||
    !parseScopes(account.consentScopes).includes(requiredScope) ||
    isConnectorAuthorizationStale(account.lastVerifiedAt, now)
  ) {
    throw new Error(`${displayName(provider)} must be freshly authorized with recruiting-message consent before inbox discovery.`);
  }
  const authorization = await dependencies.getConnectorAuthorization(userId, provider);
  if (!authorization) {
    await markInboxAccessNeedsReauth(userId, account, dependencies);
    throw new Error(`${displayName(provider)} authorization is unavailable. Reauthorize before inbox discovery.`);
  }
  try {
    const accessToken = await getUsableConnectorAccessToken({
      userId,
      provider,
      authorization,
      now,
      fetcher,
      dependencies,
    });
    return { accessToken, account };
  } catch (error) {
    if (error instanceof ConnectorAccessTokenError && error.reason === "expired") {
      await markInboxAccessNeedsReauth(userId, account, dependencies);
      throw new Error(`${displayName(provider)} authorization has expired. Reauthorize before inbox discovery.`);
    }
    if (error instanceof ConnectorAccessTokenError && error.reason === "renewal_not_configured") {
      throw new Error(`${displayName(provider)} token renewal is not configured in this deployment.`);
    }
    throw error;
  }
}

async function markInboxAccessVerified(
  userId: number,
  account: NonNullable<Awaited<ReturnType<typeof getUserConnectorAccount>>>,
  now: Date,
  dependencies: InboxResponseDiscoveryDependencies
) {
  await dependencies.upsertUserConnectorAccount({
    userId,
    provider: account.provider,
    status: "connected",
    consentScopes: account.consentScopes,
    externalAccountLabel: account.externalAccountLabel,
    connectionRequestedAt: account.connectionRequestedAt,
    lastVerifiedAt: now,
    disconnectedAt: null,
  });
}

async function markInboxAccessNeedsReauth(
  userId: number,
  account: NonNullable<Awaited<ReturnType<typeof getUserConnectorAccount>>>,
  dependencies: InboxResponseDiscoveryDependencies
) {
  await dependencies.upsertUserConnectorAccount({
    userId,
    provider: account.provider,
    status: "needs_reauth",
    consentScopes: account.consentScopes,
    externalAccountLabel: account.externalAccountLabel,
    connectionRequestedAt: account.connectionRequestedAt,
    lastVerifiedAt: account.lastVerifiedAt,
    disconnectedAt: null,
  });
}

async function throwInboxApiError(
  userId: number,
  account: NonNullable<Awaited<ReturnType<typeof getUserConnectorAccount>>>,
  provider: InboxProvider,
  status: number,
  dependencies: InboxResponseDiscoveryDependencies
): Promise<never> {
  if (status === 401 || status === 403) {
    await markInboxAccessNeedsReauth(userId, account, dependencies);
    throw new Error(`${displayName(provider)} authorization is no longer valid. Reauthorize before inbox discovery.`);
  }
  throw new Error(`${displayName(provider)} inbox discovery is temporarily unavailable.`);
}

function classifyResponse(text: string): InboxResponseType {
  const value = text.toLowerCase();
  if (/\b(interview|phone screen|technical screen|schedule (a |an )?(call|meeting)|meet the team)\b/.test(value)) return "interview_invite";
  if (/\b(unfortunately|not moving forward|regret to inform|position has been filled|will not be proceeding)\b/.test(value)) return "rejection";
  if (/\b(offer|compensation package|employment agreement)\b/.test(value)) return "offer";
  if (/\b(question|clarify|could you|please (share|send|confirm)|availability)\b/.test(value)) return "employer_question";
  return "other";
}

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isWithinInboxResponseLookback(receivedAt: Date, now: Date) {
  return receivedAt.getTime() >= now.getTime() - INBOX_RESPONSE_LOOKBACK_MS &&
    receivedAt.getTime() <= now.getTime() + TOKEN_EXPIRY_SKEW_MS;
}

function findApplicationMatch(
  text: string,
  applications: Awaited<ReturnType<typeof getUserInboxMatchApplications>>
) {
  const haystack = normalized(text);
  const matches = applications
    .filter((application) => application.status !== "rejected" && application.status !== "withdrawn")
    .map((application) => {
      const company = normalized(application.job?.company || "");
      const title = normalized(application.job?.title || "");
      let score = company.length >= 3 && haystack.includes(company) ? 2 : 0;
      if (title.length >= 8 && haystack.includes(title)) score += 1;
      return { application, score };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = matches[0];
  if (!best || (matches[1] && matches[1].score === best.score)) return null;
  const company = typeof best.application.job?.company === "string" ? best.application.job.company : "";
  const jobTitle = typeof best.application.job?.title === "string" ? best.application.job.title : "";
  if (!company || !jobTitle) return null;
  return {
    applicationId: best.application.id,
    company,
    jobTitle,
    confidence: best.score >= 3 ? "high" as const : "medium" as const,
  };
}

async function excludeRecordedInboxResponses(
  userId: number,
  candidates: InboxResponseCandidate[],
  dependencies: InboxResponseDiscoveryDependencies
) {
  if (candidates.length === 0) return candidates;
  const references = candidates.map((candidate) => `${candidate.provider}:${candidate.messageId}`);
  const recorded = new Set(await dependencies.findEmployerResponseSourceReferences({
    userId,
    source: "email",
    sourceReferences: references,
  }));
  return candidates.filter((candidate) => !recorded.has(`${candidate.provider}:${candidate.messageId}`));
}

function gmailHeaders(payload: Record<string, unknown>) {
  const headers = Array.isArray((payload.payload as { headers?: unknown } | undefined)?.headers)
    ? (payload.payload as { headers: Array<{ name?: unknown; value?: unknown }> }).headers
    : [];
  const value = (name: string) => headers.find((header) => String(header.name).toLowerCase() === name.toLowerCase())?.value;
  const sender = value("From");
  const subject = value("Subject");
  const receivedAt = value("Date");
  return {
    sender: typeof sender === "string" ? sender : null,
    subject: typeof subject === "string" ? subject : "",
    receivedAt: typeof receivedAt === "string" ? receivedAt : null,
  };
}

function inboxRequest(init: RequestInit = {}, signal?: AbortSignal): RequestInit {
  const deadline = outboundRequestSignal(OUTBOUND_TIMEOUT_MS.standard);
  return {
    ...init,
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
  };
}

export async function discoverInboxResponseCandidates(
  userId: number,
  provider: InboxProvider,
  options: { fetcher?: typeof fetch; now?: Date; dependencies?: InboxResponseDiscoveryDependencies; signal?: AbortSignal } = {}
): Promise<InboxResponseCandidate[]> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? new Date();
  const dependencies = options.dependencies ?? defaults;
  const { accessToken, account } = await getInboxAccess(userId, provider, now, fetcher, dependencies);
  const applications = await dependencies.getUserInboxMatchApplications(userId);
  if (provider === "gmail") {
    const list = await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/messages?" + new URLSearchParams({
      maxResults: String(MAX_MESSAGES),
      q: "newer_than:30d",
    }), inboxRequest({ headers: { Authorization: `Bearer ${accessToken}` } }, options.signal));
    if (!list.ok) await throwInboxApiError(userId, account, "gmail", list.status, dependencies);
    const payload = await readBoundedResponseJson<{ messages?: Array<{ id?: unknown }> }>(
      list,
      MAX_INBOX_LIST_BYTES
    );
    await markInboxAccessVerified(userId, account, now, dependencies);
    const messages = (Array.isArray(payload.messages) ? payload.messages : [])
      .flatMap((message) => typeof message.id === "string" && message.id ? [message.id] : [])
      .slice(0, MAX_MESSAGES);
    const candidates: InboxResponseCandidate[] = [];
    for (let offset = 0; offset < messages.length; offset += GMAIL_DETAIL_CONCURRENCY) {
      const batch = messages.slice(offset, offset + GMAIL_DETAIL_CONCURRENCY);
      const batchCandidates = await Promise.all(batch.map(async (messageId): Promise<InboxResponseCandidate | null> => {
        const detail = await fetcher(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, inboxRequest({
          headers: { Authorization: `Bearer ${accessToken}` },
        }, options.signal));
        if (!detail.ok) {
          if (detail.status === 401 || detail.status === 403) {
            await throwInboxApiError(userId, account, "gmail", detail.status, dependencies);
          }
          return null;
        }
        const metadata = await readBoundedResponseJson<Record<string, unknown>>(
          detail,
          MAX_INBOX_MESSAGE_BYTES
        );
        const headers = gmailHeaders(metadata);
        const preview = typeof metadata.snippet === "string" ? metadata.snippet.slice(0, 600) : "";
        const match = findApplicationMatch(`${headers.sender || ""} ${headers.subject} ${preview}`, applications);
        const received = headers.receivedAt ? new Date(headers.receivedAt) : now;
        if (!match || Number.isNaN(received.getTime()) || !isWithinInboxResponseLookback(received, now)) return null;
        return {
          provider,
          messageId,
          ...match,
          sender: headers.sender,
          subject: headers.subject.slice(0, 500),
          preview,
          receivedAt: received.toISOString(),
          suggestedResponseType: classifyResponse(`${headers.subject} ${preview}`),
        };
      }));
      candidates.push(...batchCandidates.filter((candidate): candidate is InboxResponseCandidate => candidate !== null));
    }
    return await excludeRecordedInboxResponses(userId, candidates, dependencies);
  }

  const lookbackStart = new Date(now.getTime() - INBOX_RESPONSE_LOOKBACK_MS).toISOString();
  const response = await fetcher("https://graph.microsoft.com/v1.0/me/messages?" + new URLSearchParams({
    "$top": String(MAX_MESSAGES),
    "$select": "id,subject,from,receivedDateTime,bodyPreview",
    "$filter": `receivedDateTime ge ${lookbackStart}`,
    "$orderby": "receivedDateTime desc",
  }), inboxRequest({ headers: { Authorization: `Bearer ${accessToken}` } }, options.signal));
  if (!response.ok) await throwInboxApiError(userId, account, "outlook", response.status, dependencies);
  const payload = await readBoundedResponseJson<{ value?: Array<Record<string, unknown>> }>(
    response,
    MAX_INBOX_LIST_BYTES
  );
  await markInboxAccessVerified(userId, account, now, dependencies);
  const candidates = (Array.isArray(payload.value) ? payload.value : []).flatMap((message): InboxResponseCandidate[] => {
    const messageId = typeof message.id === "string" ? message.id : "";
    const subject = typeof message.subject === "string" ? message.subject : "";
    const preview = typeof message.bodyPreview === "string" ? message.bodyPreview.slice(0, 600) : "";
    const received = typeof message.receivedDateTime === "string" ? new Date(message.receivedDateTime) : null;
    const sender = typeof (message.from as { emailAddress?: { address?: unknown } } | undefined)?.emailAddress?.address === "string"
      ? (message.from as { emailAddress: { address: string } }).emailAddress.address
      : null;
    const match = findApplicationMatch(`${sender || ""} ${subject} ${preview}`, applications);
    if (!messageId || !match || !received || Number.isNaN(received.getTime()) || !isWithinInboxResponseLookback(received, now)) return [];
    return [{
      provider,
      messageId,
      ...match,
      sender,
      subject: subject.slice(0, 500),
      preview,
      receivedAt: received.toISOString(),
      suggestedResponseType: classifyResponse(`${subject} ${preview}`),
    }];
  });
  return await excludeRecordedInboxResponses(userId, candidates, dependencies);
}
