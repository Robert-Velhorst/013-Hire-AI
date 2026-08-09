// Preconfigured storage helpers for Manus WebDev templates
// Uses the Biz-provided storage proxy (Authorization: Bearer <token>)

import { ENV } from "./_core/env";
import {
  outboundRequestSignal,
  OUTBOUND_RESPONSE_MAX_BYTES,
  OUTBOUND_TIMEOUT_MS,
  readBoundedResponseJson,
  readBoundedResponseText,
} from "./_core/outboundRequest";
import { scanSensitiveUpload } from "./uploadValidation";

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
  const url = new URL("v1/storage/upload", ensureTrailingSlash(baseUrl));
  url.searchParams.set("path", normalizeKey(relKey));
  return url;
}

function buildDeleteUrl(baseUrl: string, relKey: string): URL {
  const url = new URL("v1/storage/delete", ensureTrailingSlash(baseUrl));
  url.searchParams.set("path", normalizeKey(relKey));
  return url;
}

function requireHttpUrl(value: unknown, responseName: string): string {
  if (typeof value !== "string") {
    throw new Error(`${responseName} did not include a URL.`);
  }
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${responseName} URL must use HTTP or HTTPS.`);
  }
  return url.toString();
}

async function buildDownloadUrl(
  baseUrl: string,
  relKey: string,
  apiKey: string
): Promise<string> {
  const downloadApiUrl = new URL(
    "v1/storage/downloadUrl",
    ensureTrailingSlash(baseUrl)
  );
  downloadApiUrl.searchParams.set("path", normalizeKey(relKey));
  const response = await fetch(downloadApiUrl, {
    method: "GET",
    headers: buildAuthHeaders(apiKey),
    signal: outboundRequestSignal(OUTBOUND_TIMEOUT_MS.standard),
  });
  if (!response.ok) {
    const message = await readBoundedResponseText(response, OUTBOUND_RESPONSE_MAX_BYTES.error)
      .catch(() => response.statusText);
    throw new Error(
      `Storage download URL retrieval failed (${response.status} ${response.statusText}): ${message}`
    );
  }
  const value = await readBoundedResponseJson<{ url?: unknown }>(
    response,
    OUTBOUND_RESPONSE_MAX_BYTES.storageMetadata
  );
  return requireHttpUrl(value.url, "Storage download URL response");
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
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
  });

  if (!response.ok) {
    const message = await readBoundedResponseText(response, OUTBOUND_RESPONSE_MAX_BYTES.error)
      .catch(() => response.statusText);
    throw new Error(
      `Storage upload failed (${response.status} ${response.statusText}): ${message}`
    );
  }
  const { url } = await readBoundedResponseJson<{ url?: unknown }>(
    response,
    OUTBOUND_RESPONSE_MAX_BYTES.storageMetadata
  );
  return { key, url: requireHttpUrl(url, "Storage upload response") };
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
  });

  if (!response.ok && response.status !== 404) {
    const message = await readBoundedResponseText(response, OUTBOUND_RESPONSE_MAX_BYTES.error)
      .catch(() => response.statusText);
    throw new Error(
      `Storage deletion failed (${response.status} ${response.statusText}): ${message}`
    );
  }

  return { key };
}
