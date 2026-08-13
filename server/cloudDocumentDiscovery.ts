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
import { getMimeTypeFromExtension } from "./resumeStorage";
import {
  outboundRequestSignal,
  OUTBOUND_TIMEOUT_MS,
  readBoundedResponseBytes,
  readBoundedResponseJson,
  ResponseSizeLimitError,
} from "./_core/outboundRequest";

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
      modifiedAt: typeof value.modifiedTime === "string" ? value.modifiedTime : null,
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
      modifiedAt: typeof value.client_modified === "string" ? value.client_modified : null,
    }];
  });
}

function cloudApiError(provider: CloudDocumentProvider, status: number) {
  if (status === 401 || status === 403) {
    return new Error(`${cloudProviderLabel(provider)} authorization is no longer valid. Reauthorize before document discovery.`);
  }
  return new Error(`${cloudProviderLabel(provider)} document discovery is temporarily unavailable.`);
}

async function throwCloudApiError(
  userId: number,
  account: ConnectorAccount,
  provider: CloudDocumentProvider,
  status: number,
  dependencies: CloudDocumentDiscoveryDependencies
): Promise<never> {
  if (status === 401 || status === 403) {
    await markCloudAccessNeedsReauth(userId, account, dependencies);
  }
  throw cloudApiError(provider, status);
}

export async function discoverCloudResumeDocuments(
  userId: number,
  provider: CloudDocumentProvider,
  options: { fetcher?: typeof fetch; now?: Date; dependencies?: CloudDocumentDiscoveryDependencies } = {}
): Promise<CloudResumeDocument[]> {
  requireCloudProvider(provider);
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? new Date();
  const dependencies = options.dependencies ?? defaultDependencies;
  const { accessToken, account } = await getCloudAccessToken(userId, provider, now, fetcher, dependencies);

  const response = provider === "google_drive"
    ? await fetcher("https://www.googleapis.com/drive/v3/files?" + new URLSearchParams({
      q: "trashed = false",
      orderBy: "modifiedTime desc",
      pageSize: String(MAX_DISCOVERED_DOCUMENTS),
      fields: "files(id,name,mimeType,size,modifiedTime)",
    }), {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: "error",
      signal: outboundRequestSignal(OUTBOUND_TIMEOUT_MS.standard),
    })
    : await fetcher("https://api.dropboxapi.com/2/files/list_folder", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: "", recursive: true, include_deleted: false, limit: MAX_DISCOVERED_DOCUMENTS }),
      redirect: "error",
      signal: outboundRequestSignal(OUTBOUND_TIMEOUT_MS.standard),
    });
  if (!response.ok) await throwCloudApiError(userId, account, provider, response.status, dependencies);
  let payload: unknown;
  try {
    payload = await readBoundedResponseJson<unknown>(response, MAX_DOCUMENT_METADATA_BYTES);
  } catch (error) {
    if (error instanceof ResponseSizeLimitError) {
      throw new Error(`${cloudProviderLabel(provider)} returned too much document metadata.`);
    }
    throw error;
  }
  await markCloudAccessVerified(userId, account, now, dependencies);
  const documents = provider === "google_drive"
    ? parseGoogleDriveDocuments(payload)
    : parseDropboxDocuments(payload);
  return documents.slice(0, MAX_DISCOVERED_DOCUMENTS);
}

export async function downloadCloudResumeDocument(
  userId: number,
  document: CloudResumeDocument,
  options: { fetcher?: typeof fetch; now?: Date; dependencies?: CloudDocumentDiscoveryDependencies } = {}
): Promise<DownloadedCloudDocument> {
  requireCloudProvider(document.provider);
  if (
    !document.sourceId ||
    document.sourceId.length > 1000 ||
    !document.name ||
    !isCloudResumeMimeType(document.mimeType) ||
    !isLikelyCloudResumeDocumentName(document.name)
  ) {
    throw new Error("The selected cloud document is not a supported resume file.");
  }
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? new Date();
  const dependencies = options.dependencies ?? defaultDependencies;
  const { accessToken, account } = await getCloudAccessToken(userId, document.provider, now, fetcher, dependencies);
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
  if (!response.ok) await throwCloudApiError(userId, account, document.provider, response.status, dependencies);
  let data: Buffer;
  try {
    data = Buffer.from(await readBoundedResponseBytes(response, MAX_RESUME_BYTES));
  } catch (error) {
    if (error instanceof ResponseSizeLimitError) {
      throw new Error("The selected cloud document must be between 1 byte and 10MB.");
    }
    throw error;
  }
  if (data.length === 0) {
    throw new Error("The selected cloud document must be between 1 byte and 10MB.");
  }
  await markCloudAccessVerified(userId, account, now, dependencies);
  return { fileName: document.name, mimeType: document.mimeType, data };
}
