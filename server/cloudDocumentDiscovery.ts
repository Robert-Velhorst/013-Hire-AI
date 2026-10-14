import { isConnectorAuthorizationStale } from "@shared/profileEvidence";
import { decryptConnectorToken, encryptConnectorToken, getConnectorOAuthConfig, refreshConnectorAccessToken } from "./connectorOAuth";
import { ConnectorAccessTokenError, getUsableConnectorAccessToken } from "./connectorAccessToken";
import { isAuthoritativeInvalidConnectorToken } from "./connectorAuthorization";
import {
  acquireConnectorRefreshLease,
  getConnectorAuthorization,
  getUserConnectorAccount,
  releaseConnectorRefreshLease,
  upsertConnectorAuthorization,
  upsertUserConnectorAccount,
} from "./db";
import { getMimeTypeFromExtension } from "./resumeStorage";
import {
  outboundRequestSignal,
  OUTBOUND_TIMEOUT_MS,
  readBoundedResponseBytes,
  readBoundedResponseJson,
  ResponseSizeLimitError,
} from "./_core/outboundRequest";
import {
  claimCloudResumeCandidate,
  completeCloudResumeCandidate,
  releaseCloudResumeCandidate,
  storeCloudResumeCandidates,
  type StoredCloudResumeCandidate,
} from "./cloudResumeCandidateStore";

export const CLOUD_DOCUMENT_PROVIDERS = ["google_drive", "dropbox"] as const;
export type CloudDocumentProvider = typeof CLOUD_DOCUMENT_PROVIDERS[number];

export type CloudResumeDocument = {
  provider: CloudDocumentProvider;
  sourceId: string;
  name: string;
  mimeType: string;
  size: number | null;
  modifiedAt: string | null;
};

export type DownloadedCloudDocument = {
  fileName: string;
  mimeType: string;
  data: Buffer;
};

const MAX_DISCOVERED_DOCUMENTS = 50;
const MAX_SCANNED_PROVIDER_DOCUMENTS = 500;
const PROVIDER_PAGE_SIZE = 100;
const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const MAX_DOCUMENT_METADATA_BYTES = 1024 * 1024;
const CLOUD_DOCUMENT_READ_SCOPE = "files.content.read_resume_candidates";

function isCloudResumeMimeType(mimeType: string) {
  return [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/rtf",
    "application/rtf",
  ].includes(mimeType);
}

function normalizeModifiedAt(value: unknown) {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

/**
 * Cloud storage can contain many otherwise supported personal documents. Keep
 * discovery and import scoped to files the candidate has named as a resume or
 * CV, rather than presenting arbitrary PDFs and word-processing files as
 * application evidence.
 */
export function isLikelyCloudResumeDocumentName(name: string) {
  const normalized = name
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
  return /(^| )(resume|curriculum vitae|cv)( |$)/.test(normalized);
}

function isCloudDocumentProvider(provider: string): provider is CloudDocumentProvider {
  return (CLOUD_DOCUMENT_PROVIDERS as readonly string[]).includes(provider);
}

function requireCloudProvider(provider: string): asserts provider is CloudDocumentProvider {
  if (!isCloudDocumentProvider(provider)) {
    throw new Error("This connector does not support cloud resume discovery.");
  }
}

type ConnectorAccount = NonNullable<Awaited<ReturnType<typeof getUserConnectorAccount>>>;

export type CloudDocumentDiscoveryDependencies = {
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
  storeCloudResumeCandidates: typeof storeCloudResumeCandidates;
  claimCloudResumeCandidate: typeof claimCloudResumeCandidate;
  releaseCloudResumeCandidate: typeof releaseCloudResumeCandidate;
};

const defaultDependencies: CloudDocumentDiscoveryDependencies = {
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
  storeCloudResumeCandidates,
  claimCloudResumeCandidate,
  releaseCloudResumeCandidate,
};

function parseScopes(value: string | null) {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.filter((scope): scope is string => typeof scope === "string") : [];
  } catch {
    return [];
  }
}

function cloudProviderLabel(provider: CloudDocumentProvider) {
  return provider === "google_drive" ? "Google Drive" : "Dropbox";
}

function assertConnectedCloudAccount(
  account: ConnectorAccount | undefined,
  provider: CloudDocumentProvider,
  now: Date
): asserts account is ConnectorAccount {
  if (
    !account ||
    account.status !== "connected" ||
    !parseScopes(account.consentScopes).includes(CLOUD_DOCUMENT_READ_SCOPE) ||
    isConnectorAuthorizationStale(account.lastVerifiedAt, now)
  ) {
    throw new Error(`${cloudProviderLabel(provider)} must be freshly authorized with resume-document read consent before Hire.AI can discover cloud documents.`);
  }
}

async function getCloudAccessToken(
  userId: number,
  provider: CloudDocumentProvider,
  now: Date,
  fetcher: typeof fetch,
  dependencies: CloudDocumentDiscoveryDependencies
) {
  const account = await dependencies.getUserConnectorAccount(userId, provider);
  assertConnectedCloudAccount(account, provider, now);

  const authorization = await dependencies.getConnectorAuthorization(userId, provider);
  if (!authorization) {
    await markCloudAccessNeedsReauth(userId, account, dependencies);
    throw new Error("The connector grant is unavailable. Reauthorize this provider before document discovery.");
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
      await markCloudAccessNeedsReauth(userId, account, dependencies);
      throw new Error("The connector authorization has expired. Reauthorize this provider before document discovery.");
    }
    if (error instanceof ConnectorAccessTokenError && error.reason === "renewal_not_configured") {
      throw new Error("This connector is not configured for token renewal in this deployment.");
    }
    throw error;
  }
}

async function markCloudAccessVerified(
  userId: number,
  account: ConnectorAccount,
  now: Date,
  dependencies: CloudDocumentDiscoveryDependencies
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

async function markCloudAccessNeedsReauth(
  userId: number,
  account: ConnectorAccount,
  dependencies: CloudDocumentDiscoveryDependencies
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

function parseGoogleDriveDocuments(payload: unknown): CloudResumeDocument[] {
  const files = payload && typeof payload === "object" && Array.isArray((payload as { files?: unknown }).files)
    ? (payload as { files: unknown[] }).files
    : [];
  return files.flatMap((file): CloudResumeDocument[] => {
    if (!file || typeof file !== "object") return [];
    const value = file as Record<string, unknown>;
    const sourceId = typeof value.id === "string" ? value.id : "";
    const name = typeof value.name === "string" ? value.name : "";
    const mimeType = typeof value.mimeType === "string" ? value.mimeType : "";
    if (!sourceId || !name || !isCloudResumeMimeType(mimeType) || !isLikelyCloudResumeDocumentName(name)) return [];
    const rawSize = typeof value.size === "string" || typeof value.size === "number" ? Number(value.size) : NaN;
    const size = Number.isFinite(rawSize) && rawSize >= 0 ? rawSize : null;
    if (size !== null && size > MAX_RESUME_BYTES) return [];
    return [{
      provider: "google_drive",
      sourceId,
      name,
      mimeType,
      size,
      modifiedAt: normalizeModifiedAt(value.modifiedTime),
    }];
  });
}

function parseDropboxDocuments(payload: unknown): CloudResumeDocument[] {
  const entries = payload && typeof payload === "object" && Array.isArray((payload as { entries?: unknown }).entries)
    ? (payload as { entries: unknown[] }).entries
    : [];
  return entries.flatMap((entry): CloudResumeDocument[] => {
    if (!entry || typeof entry !== "object") return [];
    const value = entry as Record<string, unknown>;
    if (value[".tag"] !== "file") return [];
    const sourceId = typeof value.path_lower === "string" ? value.path_lower : "";
    const name = typeof value.name === "string" ? value.name : "";
    const mimeType = getMimeTypeFromExtension(name);
    if (!sourceId || !name || !isCloudResumeMimeType(mimeType) || !isLikelyCloudResumeDocumentName(name)) return [];
    const rawSize = typeof value.size === "number" ? value.size : Number(value.size);
    const size = Number.isFinite(rawSize) && rawSize >= 0 ? rawSize : null;
    if (size !== null && size > MAX_RESUME_BYTES) return [];
    return [{
      provider: "dropbox",
      sourceId,
      name,
      mimeType,
      size,
      modifiedAt: normalizeModifiedAt(value.client_modified),
    }];
  });
}

function cloudApiError(provider: CloudDocumentProvider, response: Response) {
  if (isAuthoritativeInvalidConnectorToken(response)) {
    return new Error(`${cloudProviderLabel(provider)} authorization is no longer valid. Reauthorize before document discovery.`);
  }
  return new Error(`${cloudProviderLabel(provider)} document discovery is temporarily unavailable.`);
}

async function throwCloudApiError(
  userId: number,
  account: ConnectorAccount,
  provider: CloudDocumentProvider,
  response: Response,
  dependencies: CloudDocumentDiscoveryDependencies
): Promise<never> {
  if (isAuthoritativeInvalidConnectorToken(response)) {
    await markCloudAccessNeedsReauth(userId, account, dependencies);
  }
  throw cloudApiError(provider, response);
}

export async function discoverCloudResumeDocuments(
  userId: number,
  provider: CloudDocumentProvider,
  options: { fetcher?: typeof fetch; now?: Date; dependencies?: CloudDocumentDiscoveryDependencies } = {}
): Promise<{ documents: StoredCloudResumeCandidate[]; scannedCount: number; truncated: boolean }> {
  requireCloudProvider(provider);
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? new Date();
  const dependencies = options.dependencies ?? defaultDependencies;
  const { accessToken, account } = await getCloudAccessToken(userId, provider, now, fetcher, dependencies);

  const documents: CloudResumeDocument[] = [];
  const seenCursors = new Set<string>();
  let scannedCount = 0;
  let resultsCapped = false;
  let scanBudgetExceeded = false;
  let drivePageToken: string | undefined;
  let dropboxCursor: string | undefined;
  let hasMore = true;

  while (hasMore && scannedCount < MAX_SCANNED_PROVIDER_DOCUMENTS && documents.length < MAX_DISCOVERED_DOCUMENTS) {
    const pageSize = Math.min(PROVIDER_PAGE_SIZE, MAX_SCANNED_PROVIDER_DOCUMENTS - scannedCount);
    const response = provider === "google_drive"
      ? await fetcher("https://www.googleapis.com/drive/v3/files?" + new URLSearchParams({
        q: "trashed = false",
        orderBy: "modifiedTime desc",
        pageSize: String(pageSize),
        fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime)",
        ...(drivePageToken ? { pageToken: drivePageToken } : {}),
      }), {
        headers: { Authorization: `Bearer ${accessToken}` },
        redirect: "error",
        signal: outboundRequestSignal(OUTBOUND_TIMEOUT_MS.standard),
      })
      : await fetcher(
        dropboxCursor
          ? "https://api.dropboxapi.com/2/files/list_folder/continue"
          : "https://api.dropboxapi.com/2/files/list_folder",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(dropboxCursor
            ? { cursor: dropboxCursor }
            : { path: "", recursive: true, include_deleted: false, limit: pageSize }),
          redirect: "error",
          signal: outboundRequestSignal(OUTBOUND_TIMEOUT_MS.standard),
        }
      );
    if (!response.ok) await throwCloudApiError(userId, account, provider, response, dependencies);
    let payload: unknown;
    try {
      payload = await readBoundedResponseJson<unknown>(response, MAX_DOCUMENT_METADATA_BYTES);
    } catch (error) {
      if (error instanceof ResponseSizeLimitError) {
        throw new Error(`${cloudProviderLabel(provider)} returned too much document metadata.`);
      }
      throw error;
    }
    const pageRows = payload && typeof payload === "object"
      ? (provider === "google_drive"
        ? (payload as { files?: unknown }).files
        : (payload as { entries?: unknown }).entries)
      : null;
    const remainingScanBudget = MAX_SCANNED_PROVIDER_DOCUMENTS - scannedCount;
    const boundedRows = Array.isArray(pageRows) ? pageRows.slice(0, remainingScanBudget) : [];
    if (Array.isArray(pageRows) && pageRows.length > boundedRows.length) scanBudgetExceeded = true;
    scannedCount += boundedRows.length;
    const boundedPayload = provider === "google_drive"
      ? { ...(payload as object), files: boundedRows }
      : { ...(payload as object), entries: boundedRows };
    const pageDocuments = provider === "google_drive"
      ? parseGoogleDriveDocuments(boundedPayload)
      : parseDropboxDocuments(boundedPayload);
    const remainingCandidates = MAX_DISCOVERED_DOCUMENTS - documents.length;
    if (pageDocuments.length > remainingCandidates) resultsCapped = true;
    documents.push(...pageDocuments.slice(0, remainingCandidates));

    if (provider === "google_drive") {
      const next = payload && typeof payload === "object" && typeof (payload as { nextPageToken?: unknown }).nextPageToken === "string"
        ? (payload as { nextPageToken: string }).nextPageToken
        : null;
      hasMore = Boolean(next);
      if (next && !seenCursors.has(next)) {
        seenCursors.add(next);
        drivePageToken = next;
      } else if (next) {
        throw new Error(`${cloudProviderLabel(provider)} returned a repeated pagination cursor.`);
      }
    } else {
      const value = payload as { has_more?: unknown; cursor?: unknown };
      hasMore = value?.has_more === true;
      if (hasMore && typeof value.cursor === "string" && !seenCursors.has(value.cursor)) {
        seenCursors.add(value.cursor);
        dropboxCursor = value.cursor;
      } else if (hasMore) {
        throw new Error(`${cloudProviderLabel(provider)} returned an invalid pagination cursor.`);
      }
    }
  }
  const truncated = hasMore || resultsCapped || scanBudgetExceeded;
  await markCloudAccessVerified(userId, account, now, dependencies);
  const storedDocuments = await dependencies.storeCloudResumeCandidates(userId, provider, documents, now);
  return { documents: storedDocuments, scannedCount, truncated };
}

export async function downloadCloudResumeDocument(
  userId: number,
  candidateId: string,
  options: { fetcher?: typeof fetch; now?: Date; dependencies?: CloudDocumentDiscoveryDependencies } = {}
): Promise<DownloadedCloudDocument & { candidateId: string; provider: CloudDocumentProvider }> {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(candidateId)) throw new Error("The selected cloud resume candidate is invalid or expired.");
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? new Date();
  const dependencies = options.dependencies ?? defaultDependencies;
  const candidate = await dependencies.claimCloudResumeCandidate(userId, candidateId, now);
  if (!candidate) throw new Error("The selected cloud resume candidate is invalid, expired, already importing, or already used.");
  const document: CloudResumeDocument = {
    provider: candidate.provider,
    sourceId: candidate.sourceId,
    name: candidate.name,
    mimeType: candidate.mimeType,
    size: candidate.size,
    modifiedAt: candidate.modifiedAt?.toISOString() ?? null,
  };
  try {
    if (
      !document.sourceId ||
      document.sourceId.length > 1000 ||
      !isCloudResumeMimeType(document.mimeType) ||
      !isLikelyCloudResumeDocumentName(document.name) ||
      (document.size !== null && (document.size < 1 || document.size > MAX_RESUME_BYTES))
    ) {
      throw new Error("The selected cloud document is not a supported resume file.");
    }
    const { accessToken, account } = await getCloudAccessToken(userId, document.provider, now, fetcher, dependencies);
    const metadataResponse = document.provider === "google_drive"
      ? await fetcher(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(document.sourceId)}?` + new URLSearchParams({ fields: "id,name,mimeType,size,modifiedTime,trashed" }), {
        headers: { Authorization: `Bearer ${accessToken}` },
        redirect: "error",
        signal: outboundRequestSignal(OUTBOUND_TIMEOUT_MS.standard),
      })
      : await fetcher("https://api.dropboxapi.com/2/files/get_metadata", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ path: document.sourceId }),
        redirect: "error",
        signal: outboundRequestSignal(OUTBOUND_TIMEOUT_MS.standard),
      });
    if (!metadataResponse.ok) await throwCloudApiError(userId, account, document.provider, metadataResponse, dependencies);
    const metadata = await readBoundedResponseJson<Record<string, unknown>>(metadataResponse, 64 * 1024);
    const currentName = typeof metadata.name === "string" ? metadata.name : "";
    const currentMime = document.provider === "google_drive"
      ? (typeof metadata.mimeType === "string" ? metadata.mimeType : "")
      : getMimeTypeFromExtension(currentName);
    const currentSourceId = document.provider === "google_drive"
      ? (typeof metadata.id === "string" ? metadata.id : "")
      : (typeof metadata.path_lower === "string" ? metadata.path_lower : "");
    const rawSize = typeof metadata.size === "string" || typeof metadata.size === "number" ? Number(metadata.size) : NaN;
    const currentSize = Number.isFinite(rawSize) && rawSize >= 0 ? rawSize : null;
    const modifiedValue = document.provider === "google_drive" ? metadata.modifiedTime : metadata.client_modified;
    const currentModifiedAt = normalizeModifiedAt(modifiedValue);
    if (
      (document.provider === "google_drive" && metadata.trashed === true) ||
      (document.provider === "dropbox" && metadata[".tag"] !== "file") ||
      currentSourceId !== document.sourceId ||
      currentName !== document.name ||
      currentMime !== document.mimeType ||
      currentSize !== document.size ||
      currentModifiedAt !== document.modifiedAt ||
      !isLikelyCloudResumeDocumentName(currentName) ||
      !isCloudResumeMimeType(currentMime) ||
      (currentSize !== null && (currentSize < 1 || currentSize > MAX_RESUME_BYTES))
    ) {
      throw new Error("The cloud resume changed since discovery. Discover it again before importing.");
    }

    const response = document.provider === "google_drive"
      ? await fetcher(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(document.sourceId)}?alt=media`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        redirect: "error",
        signal: outboundRequestSignal(OUTBOUND_TIMEOUT_MS.standard),
      })
      : await fetcher("https://content.dropboxapi.com/2/files/download", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Dropbox-API-Arg": JSON.stringify({ path: document.sourceId }),
        },
        redirect: "error",
        signal: outboundRequestSignal(OUTBOUND_TIMEOUT_MS.standard),
      });
    if (!response.ok) await throwCloudApiError(userId, account, document.provider, response, dependencies);
    let data: Buffer;
    try {
      data = Buffer.from(await readBoundedResponseBytes(response, MAX_RESUME_BYTES));
    } catch (error) {
      if (error instanceof ResponseSizeLimitError) {
        throw new Error("The selected cloud document must be between 1 byte and 10MB.");
      }
      throw error;
    }
    if (data.length === 0) throw new Error("The selected cloud document must be between 1 byte and 10MB.");
    await markCloudAccessVerified(userId, account, now, dependencies);
    return { candidateId, provider: document.provider, fileName: document.name, mimeType: document.mimeType, data };
  } catch (error) {
    await dependencies.releaseCloudResumeCandidate(userId, candidateId);
    throw error;
  }
}

export { completeCloudResumeCandidate, releaseCloudResumeCandidate };
