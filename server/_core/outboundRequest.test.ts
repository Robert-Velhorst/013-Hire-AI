import { describe, expect, it } from "vitest";
import {
  outboundRequestSignal,
  OUTBOUND_TIMEOUT_MS,
  readBoundedResponseBytes,
  ResponseSizeLimitError,
} from "./outboundRequest";

describe("outbound request policy", () => {
  it("provides distinct bounded budgets for short and long-running services", () => {
    expect(OUTBOUND_TIMEOUT_MS).toEqual({
      notification: 15_000,
      standard: 30_000,
      generation: 120_000,
    });
    expect(outboundRequestSignal(OUTBOUND_TIMEOUT_MS.standard)).toBeInstanceOf(AbortSignal);
  });

  it.each([0, 999, 300_001, Number.NaN, 1_500.5])("rejects invalid timeout %s", timeoutMs => {
    expect(() => outboundRequestSignal(timeoutMs)).toThrow("between 1000 and 300000 milliseconds");
  });

  it("reads a response within the configured byte limit", async () => {
    const bytes = await readBoundedResponseBytes(new Response("bounded"), 7);
    expect(new TextDecoder().decode(bytes)).toBe("bounded");
  });

  it("rejects an oversized declared response before reading it", async () => {
    const response = new Response("small", { headers: { "content-length": "100" } });
    await expect(readBoundedResponseBytes(response, 10)).rejects.toBeInstanceOf(ResponseSizeLimitError);
  });

  it("rejects a streamed response that grows past its byte limit", async () => {
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(6));
        controller.enqueue(new Uint8Array(6));
        controller.close();
      },
    }));
    await expect(readBoundedResponseBytes(response, 10)).rejects.toBeInstanceOf(ResponseSizeLimitError);
  });
});
