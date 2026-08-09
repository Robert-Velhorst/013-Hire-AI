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
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      jsonData: JSON.stringify({ jobs: 2 }),
    }), { status: 200 })));

    await expect(callDataApi("Jobs/list")).resolves.toEqual({ jobs: 2 });
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
