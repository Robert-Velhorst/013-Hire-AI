import { ENV } from "./_core/env";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_SCAN_TIMEOUT_MS = 30_000;
const MAX_SCANNER_RESPONSE_BYTES = 64 * 1024;
let activeScans = 0;
const scanWaiters: Array<{
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}> = [];

export interface SensitiveUploadScanResult {
  scanned: boolean;
  provider: string;
}

type MalwareScanMode = "http" | "windows_defender" | "unavailable";

export function resolveMalwareScanMode(
  input: {
    configuredMode?: string;
    endpoint?: string;
    platform?: NodeJS.Platform;
  } = {}
): MalwareScanMode {
  const configured = (
    input.configuredMode ??
    process.env.FILE_MALWARE_SCAN_MODE ??
    "auto"
  )
    .trim()
    .toLowerCase();
  const endpoint = (
    input.endpoint ??
    process.env.FILE_MALWARE_SCAN_URL ??
    ""
  ).trim();
  const platform = input.platform ?? process.platform;
  if (configured === "http") return endpoint ? "http" : "unavailable";
  if (configured === "windows_defender") {
    return platform === "win32" ? "windows_defender" : "unavailable";
  }
  if (configured !== "auto") return "unavailable";
  if (endpoint) return "http";
  return platform === "win32" ? "windows_defender" : "unavailable";
}

function scannerTimeoutMs() {
  const parsed = Number.parseInt(
    process.env.FILE_MALWARE_SCAN_TIMEOUT_MS ?? "",
    10
  );
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1_000), 120_000)
    : DEFAULT_SCAN_TIMEOUT_MS;
}

function scannerConcurrency() {
  const parsed = Number.parseInt(
    process.env.FILE_MALWARE_SCAN_MAX_CONCURRENCY ?? "",
    10
  );
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 8) : 2;
}

function releaseScanPermit() {
  activeScans = Math.max(0, activeScans - 1);
  const waiter = scanWaiters.shift();
  if (!waiter) return;
  clearTimeout(waiter.timer);
  activeScans += 1;
  waiter.resolve(releaseScanPermit);
}

async function acquireScanPermit() {
  if (activeScans < scannerConcurrency()) {
    activeScans += 1;
    return releaseScanPermit;
  }
  return await new Promise<() => void>((resolve, reject) => {
    const waiter = {
      resolve,
      reject,
      timer: setTimeout(() => {
        const index = scanWaiters.indexOf(waiter);
        if (index >= 0) scanWaiters.splice(index, 1);
        reject(new Error("The malware scanner is busy; retry the upload."));
      }, scannerTimeoutMs()),
    };
    scanWaiters.push(waiter);
  });
}

async function findWindowsDefenderExecutable() {
  const candidates = [
    process.env.ProgramFiles
      ? join(process.env.ProgramFiles, "Windows Defender", "MpCmdRun.exe")
      : "",
  ].filter(Boolean);
  const platformRoot = process.env.ProgramData
    ? join(process.env.ProgramData, "Microsoft", "Windows Defender", "Platform")
    : "";
  if (platformRoot && existsSync(platformRoot)) {
    const versions = (await readdir(platformRoot, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort((left, right) =>
        right.localeCompare(left, undefined, { numeric: true })
      );
    candidates.unshift(
      ...versions.map(version => join(platformRoot, version, "MpCmdRun.exe"))
    );
  }
  return candidates.find(candidate => existsSync(candidate)) ?? null;
}

function runWindowsDefender(executable: string, filePath: string) {
  return new Promise<void>((resolve, reject) => {
    execFile(
      executable,
      ["-Scan", "-ScanType", "3", "-File", filePath, "-DisableRemediation"],
      {
        timeout: scannerTimeoutMs(),
        windowsHide: true,
        maxBuffer: MAX_SCANNER_RESPONSE_BYTES,
      },
      error => {
        if (!error) resolve();
        else
          reject(
            new Error("Windows Defender rejected or could not scan the upload.")
          );
      }
    );
  });
}

async function scanWithWindowsDefender(input: {
  data: Buffer | Uint8Array;
  fileName: string;
}) {
  const executable = await findWindowsDefenderExecutable();
  if (!executable)
    throw new Error("Windows Defender command-line scanner is unavailable.");
  const directory = await mkdtemp(join(tmpdir(), "hire-ai-scan-"));
  const filePath = join(
    directory,
    sanitizeUploadFileName(basename(input.fileName))
  );
  try {
    await writeFile(filePath, Buffer.from(input.data), { mode: 0o600 });
    await runWindowsDefender(executable, filePath);
    return { scanned: true, provider: "windows_defender" } as const;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function scanWithHttp(input: {
  data: Buffer | Uint8Array;
  fileName: string;
  mimeType: string;
}) {
  const endpoint = process.env.FILE_MALWARE_SCAN_URL?.trim();
  if (!endpoint)
    throw new Error("The malware scanner endpoint is unavailable.");
  const parsedEndpoint = new URL(endpoint);
  if (
    !["http:", "https:"].includes(parsedEndpoint.protocol) ||
    parsedEndpoint.username ||
    parsedEndpoint.password
  ) {
    throw new Error("The malware scanner endpoint is invalid.");
  }
  const token = process.env.FILE_MALWARE_SCAN_TOKEN?.trim();
  try {
    const response = await fetch(parsedEndpoint, {
      method: "POST",
      headers: {
        "content-type": input.mimeType,
        "x-file-name": sanitizeUploadFileName(input.fileName),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: Buffer.from(input.data),
      signal: AbortSignal.timeout(scannerTimeoutMs()),
      redirect: "error",
    });
    if (!response.ok) throw new Error("scanner_status");
    const declaredLength = Number.parseInt(
      response.headers.get("content-length") ?? "0",
      10
    );
    if (declaredLength > MAX_SCANNER_RESPONSE_BYTES)
      throw new Error("scanner_response_too_large");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_SCANNER_RESPONSE_BYTES)
      throw new Error("scanner_response_too_large");
    const result = JSON.parse(bytes.toString("utf8")) as {
      clean?: boolean;
      provider?: string;
    };
    if (result.clean !== true) {
      throw new Error("Sensitive upload was rejected by the malware scanner.");
    }
    return {
      scanned: true,
      provider: result.provider?.trim().slice(0, 120) || "configured_scanner",
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Sensitive upload was rejected by the malware scanner."
    ) {
      throw error;
    }
    throw new Error("The malware scanner could not verify this upload.");
  }
}

export const RESUME_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/rtf",
  "application/rtf",
]);

export const VERIFICATION_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
  "text/rtf",
  "application/rtf",
  "image/jpeg",
  "image/png",
]);

export function sanitizeUploadFileName(fileName: string): string {
  const trimmed = fileName.trim().replace(/[/\\]/g, "_");
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "upload";
}

export function validateUploadedFile(input: {
  data: Buffer | Uint8Array;
  fileName: string;
  mimeType: string;
  allowedMimeTypes: Set<string>;
  maxBytes?: number;
}) {
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  const data = Buffer.from(input.data);
  const sanitizedFileName = sanitizeUploadFileName(input.fileName);

  if (data.length === 0) {
    throw new Error("Uploaded file is empty");
  }

  if (data.length > maxBytes) {
    throw new Error(
      `Uploaded file is too large. Maximum size is ${Math.floor(maxBytes / 1024 / 1024)}MB`
    );
  }

  if (!input.allowedMimeTypes.has(input.mimeType)) {
    throw new Error(`Unsupported file type: ${input.mimeType}`);
  }

  if (!hasExpectedSignature(data, input.mimeType)) {
    throw new Error(
      `File content does not match declared type: ${input.mimeType}`
    );
  }

  return {
    fileName: sanitizedFileName,
    size: data.length,
  };
}

/** Production fails closed; development may run explicitly without a scanner. */
export async function scanSensitiveUpload(input: {
  data: Buffer | Uint8Array;
  fileName: string;
  mimeType: string;
}): Promise<SensitiveUploadScanResult> {
  const mode = resolveMalwareScanMode();
  if (mode === "unavailable") {
    if (ENV.isProduction) {
      throw new Error(
        "Sensitive uploads require an available malware scanner in production."
      );
    }
    return { scanned: false, provider: "not_configured" };
  }
  const release = await acquireScanPermit();
  try {
    return mode === "windows_defender"
      ? await scanWithWindowsDefender(input)
      : await scanWithHttp(input);
  } finally {
    release();
  }
}

function hasExpectedSignature(data: Buffer, mimeType: string): boolean {
  if (mimeType === "application/pdf") {
    return data.subarray(0, 4).toString("utf8") === "%PDF";
  }

  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return data[0] === 0x50 && data[1] === 0x4b;
  }

  if (mimeType === "application/msword") {
    return (
      data[0] === 0xd0 &&
      data[1] === 0xcf &&
      data[2] === 0x11 &&
      data[3] === 0xe0
    );
  }

  if (mimeType === "image/jpeg") {
    return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }

  if (mimeType === "image/png") {
    return (
      data[0] === 0x89 &&
      data[1] === 0x50 &&
      data[2] === 0x4e &&
      data[3] === 0x47
    );
  }

  if (mimeType === "text/rtf" || mimeType === "application/rtf") {
    return /^\s*\{\\rtf\d+/i.test(
      data.subarray(0, Math.min(data.length, 512)).toString("utf8")
    );
  }

  if (mimeType === "text/plain") {
    return !data.subarray(0, Math.min(data.length, 512)).includes(0);
  }

  return false;
}
