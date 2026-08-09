import { afterEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  globalThis.fetch = originalFetch;
});

describe("private storage deletion", () => {
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
});
