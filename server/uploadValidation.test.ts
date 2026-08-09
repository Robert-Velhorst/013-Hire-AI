import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RESUME_MIME_TYPES,
  resolveMalwareScanMode,
  scanSensitiveUpload,
  validateUploadedFile,
} from "./uploadValidation";

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.unstubAllEnvs();
  globalThis.fetch = originalFetch;
});

describe("sensitive upload validation", () => {
  it("accepts a bounded PDF with a matching signature", () => {
    expect(
      validateUploadedFile({
        data: Buffer.from("%PDF-1.7 test"),
        fileName: "candidate.pdf",
        mimeType: "application/pdf",
        allowedMimeTypes: RESUME_MIME_TYPES,
      })
    ).toMatchObject({ fileName: "candidate.pdf" });
  });

  it("rejects a declared PDF whose bytes do not match the file signature", () => {
    expect(() =>
      validateUploadedFile({
        data: Buffer.from("not a PDF"),
        fileName: "candidate.pdf",
        mimeType: "application/pdf",
        allowedMimeTypes: RESUME_MIME_TYPES,
      })
    ).toThrow("File content does not match declared type");
  });

  it("accepts an RTF resume only when it has an RTF header", () => {
    expect(
      validateUploadedFile({
        data: Buffer.from(
          "{\\rtf1\\ansi Candidate Resume\\par Skills: TypeScript}",
          "utf8"
        ),
        fileName: "candidate.rtf",
        mimeType: "text/rtf",
        allowedMimeTypes: RESUME_MIME_TYPES,
      })
    ).toMatchObject({ fileName: "candidate.rtf" });

    expect(() =>
      validateUploadedFile({
        data: Buffer.from("not actually RTF", "utf8"),
        fileName: "candidate.rtf",
        mimeType: "text/rtf",
        allowedMimeTypes: RESUME_MIME_TYPES,
      })
    ).toThrow("File content does not match declared type");
  });

  it("rejects legacy binary DOC resumes that the parser cannot read reliably", () => {
    expect(() =>
      validateUploadedFile({
        data: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]),
        fileName: "legacy.doc",
        mimeType: "application/msword",
        allowedMimeTypes: RESUME_MIME_TYPES,
      })
    ).toThrow("Unsupported file type");
  });

  it("rejects oversized documents before storage", () => {
    expect(() =>
      validateUploadedFile({
        data: Buffer.alloc(11 * 1024 * 1024, 1),
        fileName: "candidate.txt",
        mimeType: "text/plain",
        allowedMimeTypes: RESUME_MIME_TYPES,
      })
    ).toThrow("Uploaded file is too large");
  });

  it("selects an HTTP scanner when configured and Windows Defender for standalone Windows", () => {
    expect(
      resolveMalwareScanMode({
        endpoint: "https://scanner.example.test",
        platform: "linux",
      })
    ).toBe("http");
    expect(resolveMalwareScanMode({ endpoint: "", platform: "win32" })).toBe(
      "windows_defender"
    );
    expect(resolveMalwareScanMode({ endpoint: "", platform: "linux" })).toBe(
      "unavailable"
    );
  });

  it("uses an authenticated bounded HTTP scanner request", async () => {
    vi.stubEnv("FILE_MALWARE_SCAN_URL", "https://scanner.example.test/scan");
    vi.stubEnv("FILE_MALWARE_SCAN_TOKEN", "scanner-secret");
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ clean: true, provider: "test-scanner" }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      ) as typeof fetch;

    await expect(
      scanSensitiveUpload({
        data: Buffer.from("safe document"),
        fileName: "candidate resume.txt",
        mimeType: "text/plain",
      })
    ).resolves.toEqual({ scanned: true, provider: "test-scanner" });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      new URL("https://scanner.example.test/scan"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer scanner-secret",
          "x-file-name": "candidate_resume.txt",
        }),
      })
    );
  });

  it("rejects an unclean or malformed scanner verdict without exposing scanner details", async () => {
    vi.stubEnv("FILE_MALWARE_SCAN_URL", "https://scanner.example.test/scan");
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          clean: false,
          detail: "internal signature details",
        }),
        { status: 200 }
      )
    ) as typeof fetch;
    await expect(
      scanSensitiveUpload({
        data: Buffer.from("unsafe"),
        fileName: "candidate.txt",
        mimeType: "text/plain",
      })
    ).rejects.toThrow("rejected by the malware scanner");

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("not-json", { status: 200 })
      ) as typeof fetch;
    await expect(
      scanSensitiveUpload({
        data: Buffer.from("unknown"),
        fileName: "candidate.txt",
        mimeType: "text/plain",
      })
    ).rejects.toThrow("could not verify this upload");
  });

  it("bounds concurrent scanner work", async () => {
    vi.stubEnv("FILE_MALWARE_SCAN_URL", "https://scanner.example.test/scan");
    vi.stubEnv("FILE_MALWARE_SCAN_MAX_CONCURRENCY", "1");
    let releaseFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>(resolve => {
      releaseFirst = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstResponse)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ clean: true }), { status: 200 })
      );
    globalThis.fetch = fetchMock as typeof fetch;

    const first = scanSensitiveUpload({
      data: Buffer.from("first"),
      fileName: "first.txt",
      mimeType: "text/plain",
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const second = scanSensitiveUpload({
      data: Buffer.from("second"),
      fileName: "second.txt",
      mimeType: "text/plain",
    });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    releaseFirst(
      new Response(JSON.stringify({ clean: true }), { status: 200 })
    );

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
