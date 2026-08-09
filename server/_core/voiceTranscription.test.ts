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

    await expect(transcribeAudio({ audioUrl: "https://8.8.8.8/input.mp3" })).resolves.toEqual({
      error: "Audio file exceeds maximum size limit",
      code: "FILE_TOO_LARGE",
      details: "Maximum allowed size is 16MB",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://8.8.8.8/input.mp3", expect.objectContaining({
      signal: expect.any(AbortSignal),
      redirect: "error",
    }));
  });

  it.each([
    "http://example.com/input.mp3",
    "https://localhost/input.mp3",
    "https://127.0.0.1/input.mp3",
    "https://10.0.0.8/input.mp3",
    "https://[::1]/input.mp3",
  ])("rejects unsafe remote audio URL %s before fetching", async (audioUrl) => {
    ENV.forgeApiUrl = "https://forge.example.local";
    ENV.forgeApiKey = "forge-test-key";
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeAudio({ audioUrl });

    expect(result).toMatchObject({ code: "SERVICE_ERROR" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a non-audio response before uploading it to the transcription provider", async () => {
    ENV.forgeApiUrl = "https://forge.example.local";
    ENV.forgeApiKey = "forge-test-key";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(transcribeAudio({ audioUrl: "https://8.8.8.8/input.mp3" })).resolves.toEqual({
      error: "Remote file is not a supported audio format",
      code: "INVALID_FORMAT",
      details: "Use MP3, MP4/M4A, OGG, WAV, or WebM audio.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
