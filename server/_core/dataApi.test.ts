import { afterEach, describe, expect, it, vi } from "vitest";
import { ENV } from "./env";
import { callDataApi } from "./dataApi";
import { ResponseSizeLimitError } from "./outboundRequest";

const originalForgeApiUrl = ENV.forgeApiUrl;
const originalForgeApiKey = ENV.forgeApiKey;

afterEach(() => {
  ENV.forgeApiUrl = originalForgeApiUrl;
  ENV.forgeApiKey = originalForgeApiKey;
  vi.unstubAllGlobals();
});

describe("data API response policy", () => {
  it("parses a bounded nested JSON payload", async () => {
    ENV.forgeApiUrl = "https://forge.example.local";
    ENV.forgeApiKey = "forge-test-key";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      jsonData: JSON.stringify({ jobs: 2 }),
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(callDataApi("Jobs/list")).resolves.toEqual({ jobs: 2 });
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      redirect: "error",
      signal: expect.any(AbortSignal),
    }));
  });

  it("rejects an insecure configured service before sending the bearer key", async () => {
    ENV.forgeApiUrl = "http://forge.example.local";
    ENV.forgeApiKey = "forge-test-key";
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(callDataApi("Jobs/list")).rejects.toThrow(/HTTPS or loopback HTTP/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates an oversized provider response instead of returning empty data", async () => {
    ENV.forgeApiUrl = "https://forge.example.local";
    ENV.forgeApiKey = "forge-test-key";
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", {
      status: 200,
      headers: { "content-length": String(4 * 1024 * 1024 + 1) },
    })));

    await expect(callDataApi("Jobs/list")).rejects.toBeInstanceOf(ResponseSizeLimitError);
  });
});
