import { afterEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  globalThis.fetch = originalFetch;
});

describe("private storage deletion", () => {
  it.each([
    ["upload", (storage: typeof import("./storage"), key: string) => storage.storagePut(key, "data", "text/plain")],
    ["download", (storage: typeof import("./storage"), key: string) => storage.storageGet(key)],
    ["deletion", (storage: typeof import("./storage"), key: string) => storage.storageDelete(key)],
  ])("rejects unsafe object keys before %s network access", async (_operation, invoke) => {
    vi.stubEnv("BUILT_IN_FORGE_API_URL", "https://storage.example.local/api/");
    vi.stubEnv("BUILT_IN_FORGE_API_KEY", "storage-test-key");
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    const storage = await import("./storage");

    for (const key of ["", "../secret", "safe/../secret", "safe/%2e%2e/secret", "safe\\secret", "safe//secret", "safe/line\nbreak"]) {
      await expect(invoke(storage, key)).rejects.toThrow(/Storage object key/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized object keys before network access", async () => {
    vi.stubEnv("BUILT_IN_FORGE_API_URL", "https://storage.example.local/api/");
    vi.stubEnv("BUILT_IN_FORGE_API_KEY", "storage-test-key");
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    const { storageGet } = await import("./storage");

    await expect(storageGet(`generated/${"a".repeat(1_025)}`)).rejects.toThrow("between 1 and 1024 UTF-8 bytes");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("scans sensitive namespaces before uploading any bytes", async () => {
    vi.stubEnv("BUILT_IN_FORGE_API_URL", "https://storage.example.local/api/");
    vi.stubEnv("BUILT_IN_FORGE_API_KEY", "storage-test-key");
    vi.stubEnv("FILE_MALWARE_SCAN_URL", "https://scanner.example.local/scan");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ clean: true, provider: "test" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://private.example/resume" }), { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const { storagePut } = await import("./storage");
    await expect(storagePut("resumes/7/resume.pdf", Buffer.from("%PDF-safe"), "application/pdf"))
      .resolves.toEqual({ key: "resumes/7/resume.pdf", url: "https://private.example/resume" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://scanner.example.local/scan");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/v1/storage/upload");
  });

  it("uses the authenticated storage delete endpoint with a normalized object key", async () => {
    vi.stubEnv("BUILT_IN_FORGE_API_URL", "https://storage.example.local/api/");
    vi.stubEnv("BUILT_IN_FORGE_API_KEY", "storage-test-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const { storageDelete } = await import("./storage");
    await expect(storageDelete("/resumes/7/resume.pdf")).resolves.toEqual({
      key: "resumes/7/resume.pdf",
    });

    const [url, request] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://storage.example.local/api/v1/storage/delete?path=resumes%2F7%2Fresume.pdf");
    expect(request.method).toBe("DELETE");
    expect(request.headers).toEqual({ Authorization: "Bearer storage-test-key" });
  });

  it("does not hide failed object cleanup", async () => {
    vi.stubEnv("BUILT_IN_FORGE_API_URL", "https://storage.example.local/api/");
    vi.stubEnv("BUILT_IN_FORGE_API_KEY", "storage-test-key");
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("denied", {
      status: 403,
      statusText: "Forbidden",
    })) as typeof fetch;

    const { storageDelete } = await import("./storage");
    await expect(storageDelete("resumes/7/resume.pdf")).rejects.toThrow("Storage deletion failed (403 Forbidden)");
  });

  it("treats an already-missing object as an idempotent deletion", async () => {
    vi.stubEnv("BUILT_IN_FORGE_API_URL", "https://storage.example.local/api/");
    vi.stubEnv("BUILT_IN_FORGE_API_KEY", "storage-test-key");
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("missing", { status: 404 })) as typeof fetch;

    const { storageDelete } = await import("./storage");
    await expect(storageDelete("resumes/7/already-gone.pdf")).resolves.toEqual({
      key: "resumes/7/already-gone.pdf",
    });
  });

  it("returns an authenticated HTTP download URL for a normalized private key", async () => {
    vi.stubEnv("BUILT_IN_FORGE_API_URL", "https://storage.example.local/api/");
    vi.stubEnv("BUILT_IN_FORGE_API_KEY", "storage-test-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      url: "https://private.example/download/signed",
    }), { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const { storageGet } = await import("./storage");
    await expect(storageGet("/offer-letters/7/offer.pdf")).resolves.toEqual({
      key: "offer-letters/7/offer.pdf",
      url: "https://private.example/download/signed",
    });
    const [url, request] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://storage.example.local/api/v1/storage/downloadUrl?path=offer-letters%2F7%2Foffer.pdf");
    expect(request.headers).toEqual({ Authorization: "Bearer storage-test-key" });
  });

  it("rejects failed or unsafe private download responses", async () => {
    vi.stubEnv("BUILT_IN_FORGE_API_URL", "https://storage.example.local/api/");
    vi.stubEnv("BUILT_IN_FORGE_API_KEY", "storage-test-key");
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("denied", {
      status: 403,
      statusText: "Forbidden",
    })) as typeof fetch;
    const { storageGet } = await import("./storage");
    await expect(storageGet("verifications/7/proof.pdf")).rejects.toThrow("retrieval failed (403 Forbidden)");

    vi.resetModules();
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      url: "javascript:alert(1)",
    }), { status: 200 })) as typeof fetch;
    const unsafeStorage = await import("./storage");
    await expect(unsafeStorage.storageGet("verifications/7/proof.pdf")).rejects.toThrow("HTTP or HTTPS");
  });
});
