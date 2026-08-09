export const OUTBOUND_TIMEOUT_MS = {
  notification: 15_000,
  standard: 30_000,
  generation: 120_000,
} as const;

export function outboundRequestSignal(timeoutMs: number): AbortSignal {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
    throw new Error("Outbound request timeout must be between 1000 and 300000 milliseconds.");
  }
  return AbortSignal.timeout(timeoutMs);
}

export class ResponseSizeLimitError extends Error {
  constructor(maxBytes: number) {
    super(`Outbound response exceeded the ${maxBytes}-byte limit.`);
    this.name = "ResponseSizeLimitError";
  }
}

export async function readBoundedResponseBytes(
  response: Response,
  maxBytes: number
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("Outbound response byte limit must be a positive safe integer.");
  }
  const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new ResponseSizeLimitError(maxBytes);
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ResponseSizeLimitError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
