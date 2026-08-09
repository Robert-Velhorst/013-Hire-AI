// Preconfigured storage helpers for Manus WebDev templates
// Uses the Biz-provided storage proxy (Authorization: Bearer <token>)

import { ENV } from "./_core/env";
import {
  outboundRequestSignal,
  OUTBOUND_RESPONSE_MAX_BYTES,
  OUTBOUND_TIMEOUT_MS,
  readBoundedResponseJson,
} from "./_core/outboundRequest";
import { buildTrustedServiceUrl } from "./_core/trustedServiceUrl";
import { scanSensitiveUpload } from "./uploadValidation";

const MAX_STORAGE_UPLOAD_BYTES = 25 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

type StorageConfig = { baseUrl: string; apiKey: string };

function getStorageConfig(): StorageConfig {
  const baseUrl = ENV.forgeApiUrl;
  const apiKey = ENV.forgeApiKey;

  if (!baseUrl || !apiKey) {
    throw new Error(
      "Storage proxy credentials missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY"
    );
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

function buildUploadUrl(baseUrl: string, relKey: string): URL {
  const url = new URL(buildTrustedServiceUrl(baseUrl, "v1/storage/upload"));
  url.searchParams.set("path", normalizeKey(relKey));
  return url;
}

function buildDeleteUrl(baseUrl: string, relKey: string): URL {
  const url = new URL(buildTrustedServiceUrl(baseUrl, "v1/storage/delete"));
  url.searchParams.set("path", normalizeKey(relKey));
  return url;
}

function requireSecureDownloadUrl(value: unknown, responseName: string): string {
  if (typeof value !== "string") {
    throw new Error(`${responseName} did not include a URL.`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${responseName} URL is invalid.`);
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const allowedTransport = url.protocol === "https:" ||
    (url.protocol === "http:" && LOOPBACK_HOSTS.has(hostname));
  if (!allowedTransport || url.username || url.password || url.hash) {
    throw new Error(`${responseName} URL must use credential-free HTTPS or loopback HTTP.`);
  }
  return url.toString();
}

async function buildDownloadUrl(
  baseUrl: string,
  relKey: string,
  apiKey: string
): Promise<string> {
  const downloadApiUrl = new URL(buildTrustedServiceUrl(baseUrl, "v1/storage/downloadUrl"));
  downloadApiUrl.searchParams.set("path", normalizeKey(relKey));
  const response = await fetch(downloadApiUrl, {
    method: "GET",
    headers: buildAuthHeaders(apiKey),
    signal: outboundRequestSignal(OUTBOUND_TIMEOUT_MS.standard),
    redirect: "error",
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Storage download URL retrieval failed (HTTP ${response.status}).`);
  }
  const value = await readBoundedResponseJson<{ url?: unknown }>(
    response,
    OUTBOUND_RESPONSE_MAX_BYTES.storageMetadata
  );
  return requireSecureDownloadUrl(value.url, "Storage download URL response");
}

function normalizeKey(relKey: string): string {
  const key = relKey.replace(/^\/+/, "").normalize("NFC");
  if (!key || Buffer.byteLength(key, "utf8") > 1_024) {
    throw new Error("Storage object key must contain between 1 and 1024 UTF-8 bytes.");
  }
  if (/[\\\u0000-\u001f\u007f]/.test(key)) {
    throw new Error("Storage object key contains an unsafe character.");
  }

  const segments = key.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Storage object key contains an unsafe path segment.");
  }
  for (const segment of segments) {
    try {
      const decoded = decodeURIComponent(segment);
      if (decoded === "." || decoded === ".." || /[\\/\u0000-\u001f\u007f]/.test(decoded)) {
        throw new Error("Storage object key contains an unsafe encoded path segment.");
      }
    } catch (error) {
      if (error instanceof URIError) {
        throw new Error("Storage object key contains invalid percent encoding.");
      }
      throw error;
    }
  }
  return key;
}

function toFormData(
  data: Buffer | Uint8Array | string,
  contentType: string,
  fileName: string
): FormData {
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });
  const form = new FormData();
  form.append("file", blob, fileName || "file");
  return form;
}

function buildAuthHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}` };
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const { baseUrl, apiKey } = getStorageConfig();
  const byteLength = typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
  if (byteLength < 1 || byteLength > MAX_STORAGE_UPLOAD_BYTES) {
    throw new Error("Storage upload must contain between 1 byte and 25MB.");
  }
  if (/^(resumes|offer-letters|verifications)\//.test(key)) {
    const bytes =
      typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
    await scanSensitiveUpload({
      data: bytes,
      fileName: key.split("/").pop() ?? "upload",
      mimeType: contentType,
    });
  }
  const uploadUrl = buildUploadUrl(baseUrl, key);
  const formData = toFormData(data, contentType, key.split("/").pop() ?? key);
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: buildAuthHeaders(apiKey),
    body: formData,
    signal: outboundRequestSignal(OUTBOUND_TIMEOUT_MS.standard),
    redirect: "error",
  });

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Storage upload failed (HTTP ${response.status}).`);
  }
  const { url } = await readBoundedResponseJson<{ url?: unknown }>(
    response,
    OUTBOUND_RESPONSE_MAX_BYTES.storageMetadata
  );
  return { key, url: requireSecureDownloadUrl(url, "Storage upload response") };
}

export async function storageGet(
  relKey: string
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const { baseUrl, apiKey } = getStorageConfig();
  return {
    key,
    url: await buildDownloadUrl(baseUrl, key, apiKey),
  };
}

/**
 * Permanently remove a private object. Callers must not delete their ledger
 * metadata when this fails, otherwise the sensitive file becomes orphaned.
 */
export async function storageDelete(relKey: string): Promise<{ key: string }> {
  const key = normalizeKey(relKey);
  const { baseUrl, apiKey } = getStorageConfig();
  const response = await fetch(buildDeleteUrl(baseUrl, key), {
    method: "DELETE",
    headers: buildAuthHeaders(apiKey),
    signal: outboundRequestSignal(OUTBOUND_TIMEOUT_MS.standard),
    redirect: "error",
  });

  if (!response.ok && response.status !== 404) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Storage deletion failed (HTTP ${response.status}).`);
  }
  if (response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
  }

  return { key };
}
