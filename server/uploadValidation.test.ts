import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
const { fetchAllowlistedHttpsUrlMock } = vi.hoisted(() => ({
  fetchAllowlistedHttpsUrlMock: vi.fn(),
}));
vi.mock("./_core/publicUrl", () => ({
  fetchAllowlistedHttpsUrl: fetchAllowlistedHttpsUrlMock,
}));
import {
  RESUME_MIME_TYPES,
  resolveMalwareScanMode,
  scanSensitiveUpload,
  validateUploadedFile,
  windowsDefenderScanPath,
} from "./uploadValidation";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  fetchAllowlistedHttpsUrlMock.mockResolvedValue(
    Response.json({ clean: true, provider: "test-scanner" })
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  globalThis.fetch = originalFetch;
  fetchAllowlistedHttpsUrlMock.mockReset();
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
        allowedOrigins: "https://scanner.example.test",
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

  it("uses a fixed Defender scan filename instead of the uploaded filename", () => {
    const directory = join("temporary", "hire-ai-scan-1");
    expect(windowsDefenderScanPath(directory)).toBe(
      join(directory, "upload.bin")
    );
  });

  it("uses an authenticated bounded HTTP scanner request", async () => {
    vi.stubEnv("FILE_MALWARE_SCAN_MODE", "http");
    vi.stubEnv("FILE_MALWARE_SCAN_URL", "http://127.0.0.1:8080/scan");
    vi.stubEnv("FILE_MALWARE_SCAN_ALLOWED_ORIGINS", "http://127.0.0.1:8080");
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
      new URL("http://127.0.0.1:8080/scan"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer scanner-secret",
          "x-file-name": "candidate_resume.txt",
        }),
      })
    );
    expect(fetchAllowlistedHttpsUrlMock).not.toHaveBeenCalled();
  });

  it("routes public HTTPS scanner requests through the pinned outbound helper", async () => {
    vi.stubEnv("FILE_MALWARE_SCAN_MODE", "http");
    vi.stubEnv("FILE_MALWARE_SCAN_URL", "https://scanner.example.test/scan");
    vi.stubEnv(
      "FILE_MALWARE_SCAN_ALLOWED_ORIGINS",
      "https://scanner.example.test"
    );
    const data = Buffer.from("safe document");

    await expect(
      scanSensitiveUpload({
        data,
        fileName: "candidate resume.txt",
        mimeType: "text/plain",
      })
    ).resolves.toMatchObject({ scanned: true });

    expect(fetchAllowlistedHttpsUrlMock).toHaveBeenCalledWith(
      "https://scanner.example.test/scan",
      "https://scanner.example.test",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-file-name": "candidate_resume.txt",
        }),
        body: data,
      })
    );
    expect(fetchAllowlistedHttpsUrlMock).toHaveBeenCalledOnce();
  });

  it("does not contact an HTTPS scanner whose origin is not allowlisted", async () => {
    vi.stubEnv("FILE_MALWARE_SCAN_MODE", "http");
    vi.stubEnv(
      "FILE_MALWARE_SCAN_URL",
      "https://other-scanner.example.test/scan"
    );
    vi.stubEnv(
      "FILE_MALWARE_SCAN_ALLOWED_ORIGINS",
      "https://scanner.example.test"
    );
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      scanSensitiveUpload({
        data: Buffer.from("safe document"),
        fileName: "candidate.txt",
        mimeType: "text/plain",
      })
    ).resolves.toEqual({ scanned: false, provider: "not_configured" });

    expect(fetchAllowlistedHttpsUrlMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unclean or malformed scanner verdict without exposing scanner details", async () => {
    vi.stubEnv("FILE_MALWARE_SCAN_MODE", "http");
    vi.stubEnv("FILE_MALWARE_SCAN_URL", "https://scanner.example.test/scan");
    vi.stubEnv(
      "FILE_MALWARE_SCAN_ALLOWED_ORIGINS",
      "https://scanner.example.test"
    );
    fetchAllowlistedHttpsUrlMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          clean: false,
          detail: "internal signature details",
        }),
        { status: 200 }
      )
    );
    await expect(
      scanSensitiveUpload({
        data: Buffer.from("unsafe"),
        fileName: "candidate.txt",
        mimeType: "text/plain",
      })
    ).rejects.toThrow("rejected by the malware scanner");

    fetchAllowlistedHttpsUrlMock.mockResolvedValueOnce(
      new Response("not-json", { status: 200 })
    );
    await expect(
      scanSensitiveUpload({
        data: Buffer.from("unknown"),
        fileName: "candidate.txt",
        mimeType: "text/plain",
      })
    ).rejects.toThrow("could not verify this upload");
  });

  it("bounds concurrent scanner work", async () => {
    vi.stubEnv("FILE_MALWARE_SCAN_MODE", "http");
    vi.stubEnv("FILE_MALWARE_SCAN_URL", "https://scanner.example.test/scan");
    vi.stubEnv(
      "FILE_MALWARE_SCAN_ALLOWED_ORIGINS",
      "https://scanner.example.test"
    );
    vi.stubEnv("FILE_MALWARE_SCAN_MAX_CONCURRENCY", "1");
    let releaseFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>(resolve => {
      releaseFirst = resolve;
    });
    const fetchMock = fetchAllowlistedHttpsUrlMock
      .mockImplementationOnce(() => firstResponse)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ clean: true }), { status: 200 })
      );

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
    const overflow = scanSensitiveUpload({
      data: Buffer.from("overflow"),
      fileName: "overflow.txt",
      mimeType: "text/plain",
    });
    const overflowRejected =
      expect(overflow).rejects.toThrow("scanner is busy");
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await overflowRejected;
    releaseFirst(
      new Response(JSON.stringify({ clean: true }), { status: 200 })
    );

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cancels oversized chunked scanner responses before reading the full body", async () => {
    vi.stubEnv("FILE_MALWARE_SCAN_MODE", "http");
    vi.stubEnv("FILE_MALWARE_SCAN_URL", "https://scanner.example.test/scan");
    vi.stubEnv(
      "FILE_MALWARE_SCAN_ALLOWED_ORIGINS",
      "https://scanner.example.test"
    );
    vi.stubEnv("FILE_MALWARE_SCAN_MAX_CONCURRENCY", "1");
    const cancel = vi.fn();
    let chunks = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          chunks += 1;
          controller.enqueue(new Uint8Array(16 * 1024).fill(32));
          if (chunks === 16) controller.close();
        },
        cancel,
      })
    );
    fetchAllowlistedHttpsUrlMock
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(Response.json({ clean: true }));

    await expect(
      scanSensitiveUpload({
        data: Buffer.from("synthetic resume"),
        fileName: "resume.txt",
        mimeType: "text/plain",
      })
    ).rejects.toThrow("could not verify this upload");

    expect(cancel).toHaveBeenCalledOnce();
    expect(chunks).toBeLessThan(16);
    expect(response.body!.locked).toBe(false);
    await expect(
      scanSensitiveUpload({
        data: Buffer.from("next resume"),
        fileName: "next.txt",
        mimeType: "text/plain",
      })
    ).resolves.toMatchObject({ scanned: true });
    expect(fetchAllowlistedHttpsUrlMock).toHaveBeenCalledTimes(2);
  });

  it.each(["oversized-header", "http-error"])(
    "cancels unused scanner bodies on %s",
    async failure => {
      vi.stubEnv("FILE_MALWARE_SCAN_MODE", "http");
      vi.stubEnv("FILE_MALWARE_SCAN_URL", "https://scanner.example.test/scan");
      vi.stubEnv(
        "FILE_MALWARE_SCAN_ALLOWED_ORIGINS",
        "https://scanner.example.test"
      );
      const cancel = vi.fn();
      const response = new Response(new ReadableStream({ cancel }), {
        status: failure === "http-error" ? 503 : 200,
        headers:
          failure === "oversized-header"
            ? { "content-length": String(65 * 1024) }
            : {},
      });
      fetchAllowlistedHttpsUrlMock.mockResolvedValue(response);

      await expect(
        scanSensitiveUpload({
          data: Buffer.from("synthetic resume"),
          fileName: "resume.txt",
          mimeType: "text/plain",
        })
      ).rejects.toThrow("could not verify this upload");

      expect(cancel).toHaveBeenCalledOnce();
      expect(response.body!.locked).toBe(false);
    }
  );
});
