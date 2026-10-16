import { afterEach, describe, expect, it, vi } from "vitest";

const { fetchPublicHttpsUrl } = vi.hoisted(() => ({
  fetchPublicHttpsUrl: vi.fn(),
}));

vi.mock("./_core/publicUrl", () => ({ fetchPublicHttpsUrl }));

import { scanSensitiveUpload } from "./uploadValidation";

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

describe("public malware scanner requests", () => {
  it("routes configured public HTTPS scanners through the pinned public URL helper", async () => {
    vi.stubEnv("FILE_MALWARE_SCAN_MODE", "http");
    vi.stubEnv("FILE_MALWARE_SCAN_URL", "https://scanner.example.test/scan");
    vi.stubEnv("FILE_MALWARE_SCAN_ALLOWED_ORIGINS", "https://scanner.example.test");
    vi.stubEnv("FILE_MALWARE_SCAN_TOKEN", "scanner-test-token");
    fetchPublicHttpsUrl.mockResolvedValue(
      Response.json({ clean: true, provider: "test-scanner" })
    );
    const globalFetch = vi.spyOn(globalThis, "fetch");
    const upload = Buffer.from("synthetic resume");

    await expect(
      scanSensitiveUpload({
        data: upload,
        fileName: "candidate resume.txt",
        mimeType: "text/plain",
      })
    ).resolves.toEqual({ scanned: true, provider: "test-scanner" });

    expect(fetchPublicHttpsUrl).toHaveBeenCalledWith(
      "https://scanner.example.test/scan",
      expect.objectContaining({
        method: "POST",
        body: upload,
        headers: expect.objectContaining({
          authorization: "Bearer scanner-test-token",
          "x-file-name": "candidate_resume.txt",
        }),
      })
    );
    expect(globalFetch).not.toHaveBeenCalled();
  });
});
