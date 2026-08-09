import { afterEach, describe, expect, it, vi } from "vitest";
import { ENV } from "./env";
import { transcribeAudio } from "./voiceTranscription";

const originalForgeApiUrl = ENV.forgeApiUrl;
const originalForgeApiKey = ENV.forgeApiKey;

afterEach(() => {
  ENV.forgeApiUrl = originalForgeApiUrl;
  ENV.forgeApiKey = originalForgeApiKey;
  vi.unstubAllGlobals();
});

describe("voice transcription resource policy", () => {
  it("rejects oversized remote audio before calling the transcription provider", async () => {
    ENV.forgeApiUrl = "https://forge.example.local";
    ENV.forgeApiKey = "forge-test-key";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("not-read", {
      status: 200,
      headers: {
        "content-length": String(16 * 1024 * 1024 + 1),
        "content-type": "audio/mpeg",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(transcribeAudio({ audioUrl: "https://audio.example.local/input.mp3" })).resolves.toEqual({
      error: "Audio file exceeds maximum size limit",
      code: "FILE_TOO_LARGE",
      details: "Maximum allowed size is 16MB",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://audio.example.local/input.mp3", expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
  });
});
