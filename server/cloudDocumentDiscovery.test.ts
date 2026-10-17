import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  downloadCloudResumeDocument,
  discoverCloudResumeDocuments,
  isLikelyCloudResumeDocumentName,
  type CloudDocumentDiscoveryDependencies,
} from "./cloudDocumentDiscovery";

const mocks = {
  acquireConnectorRefreshLease: vi.fn().mockResolvedValue(true),
  getConnectorAuthorization: vi.fn(),
  getUserConnectorAccount: vi.fn(),
  upsertConnectorAuthorization: vi.fn(),
  upsertUserConnectorAccount: vi.fn(),
  decryptConnectorToken: vi.fn(),
  encryptConnectorToken: vi.fn(),
  getConnectorOAuthConfig: vi.fn(),
  refreshConnectorAccessToken: vi.fn(),
  releaseConnectorRefreshLease: vi.fn().mockResolvedValue(true),
  storeCloudResumeCandidates: vi.fn(),
  claimCloudResumeCandidate: vi.fn(),
  releaseCloudResumeCandidate: vi.fn().mockResolvedValue(undefined),
};

const dependencies = mocks as unknown as CloudDocumentDiscoveryDependencies;
const now = new Date("2026-07-13T12:00:00.000Z");

function connectedAccount(provider: "google_drive" | "dropbox") {
  return {
    id: 1,
    userId: 501,
    provider,
    status: "connected" as const,
    consentScopes: JSON.stringify(["files.content.read_resume_candidates"]),
    externalAccountLabel: "candidate@example.com",
    connectionRequestedAt: now,
    lastVerifiedAt: now,
    disconnectedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function discoveryOptions(fetcher: typeof fetch) {
  return { fetcher, now, dependencies };
}

const candidateId = "C".repeat(43);

function claimCandidate(document: {
  provider: "google_drive" | "dropbox";
  sourceId: string;
  name: string;
  mimeType: string;
  size: number | null;
  modifiedAt: string | null;
}) {
  mocks.claimCloudResumeCandidate.mockResolvedValueOnce({
    candidateId,
    userId: 501,
    ...document,
    modifiedAt: document.modifiedAt ? new Date(document.modifiedAt) : null,
    expiresAt: new Date(now.getTime() + 60_000),
    importLeaseUntil: null,
    createdAt: now,
  });
}

describe("cloud resume discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storeCloudResumeCandidates.mockImplementation(async (_userId, _provider, documents) =>
      documents.map((document, index) => ({ ...document, candidateId: `${"C".repeat(42)}${index}` }))
    );
    mocks.getUserConnectorAccount.mockResolvedValue(connectedAccount("google_drive"));
    mocks.getConnectorAuthorization.mockResolvedValue({
      userId: 501,
      provider: "google_drive",
      encryptedAccessToken: "encrypted-access",
      encryptedRefreshToken: "encrypted-refresh",
      accessTokenExpiresAt: new Date("2026-07-13T13:00:00.000Z"),
      tokenType: "Bearer",
      grantedScopes: "[]",
    });
    mocks.decryptConnectorToken.mockReturnValue("provider-access-token");
    mocks.upsertUserConnectorAccount.mockResolvedValue(undefined);
  });

  it("lists only supported, reasonably sized Google Drive resume candidates", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      files: [
        { id: "resume-pdf", name: "Resume.pdf", mimeType: "application/pdf", size: "124", modifiedTime: "2026-07-12T10:00:00Z" },
        { id: "portfolio-pdf", name: "portfolio.pdf", mimeType: "application/pdf", size: "456", modifiedTime: "2026-07-12T11:00:00Z" },
        { id: "native-doc", name: "Resume", mimeType: "application/vnd.google-apps.document", size: "12" },
        { id: "too-large", name: "Huge.pdf", mimeType: "application/pdf", size: String(11 * 1024 * 1024) },
      ],
    }), { status: 200 }));

    const result = await discoverCloudResumeDocuments(501, "google_drive", discoveryOptions(fetcher));

    expect(result).toMatchObject({
      scannedCount: 4,
      truncated: false,
      documents: [expect.objectContaining({
        candidateId: expect.any(String),
        provider: "google_drive",
        name: "Resume.pdf",
        mimeType: "application/pdf",
        size: 124,
      })],
    });
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("www.googleapis.com/drive/v3/files"),
      expect.objectContaining({
        headers: { Authorization: "Bearer provider-access-token" },
        redirect: "error",
        signal: expect.any(AbortSignal),
      })
    );
    expect(mocks.upsertUserConnectorAccount).toHaveBeenCalledWith(expect.objectContaining({
      status: "connected",
      lastVerifiedAt: now,
    }));
  });

  it("uses Dropbox metadata and excludes unsupported cloud files", async () => {
    mocks.getUserConnectorAccount.mockResolvedValue(connectedAccount("dropbox"));
    mocks.getConnectorAuthorization.mockResolvedValue({
      userId: 501,
      provider: "dropbox",
      encryptedAccessToken: "encrypted-access",
      encryptedRefreshToken: null,
      accessTokenExpiresAt: new Date("2026-07-13T13:00:00.000Z"),
      tokenType: "Bearer",
      grantedScopes: "[]",
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      entries: [
        { ".tag": "file", path_lower: "/cv.docx", name: "CV.docx", size: 402, client_modified: "2026-07-11T09:00:00Z" },
        { ".tag": "file", path_lower: "/cover.png", name: "cover.png", size: 40 },
        { ".tag": "file", path_lower: "/employment-letter.pdf", name: "employment-letter.pdf", size: 220 },
        { ".tag": "file", path_lower: "/resume.rtf", name: "resume.rtf", size: 40 },
      ],
    }), { status: 200 }));

    const result = await discoverCloudResumeDocuments(501, "dropbox", discoveryOptions(fetcher));

    expect(result.documents).toEqual([
      expect.objectContaining({
        candidateId: expect.any(String),
        provider: "dropbox",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
      expect.objectContaining({
        candidateId: expect.any(String),
        provider: "dropbox",
        mimeType: "text/rtf",
      }),
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.dropboxapi.com/2/files/list_folder",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("pages through unrelated Google Drive entries and reports the bounded scan cutoff", async () => {
    const unrelated = Array.from({ length: 100 }, (_, index) => ({
      id: `other-${index}`, name: `portfolio-${index}.pdf`, mimeType: "application/pdf", size: "100",
    }));
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ files: unrelated, nextPageToken: "page-2" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        files: [{ id: "resume-found", name: "Resume.pdf", mimeType: "application/pdf", size: "100" }],
      }), { status: 200 }));

    const result = await discoverCloudResumeDocuments(501, "google_drive", discoveryOptions(fetcher));

    expect(result).toMatchObject({ scannedCount: 101, truncated: false });
    expect(result.documents).toHaveLength(1);
    expect(fetcher).toHaveBeenNthCalledWith(2,
      expect.stringContaining("pageToken=page-2"),
      expect.any(Object),
    );
  });

  it("finds Dropbox resumes beyond the first page of unrelated documents", async () => {
    mocks.getUserConnectorAccount.mockResolvedValue(connectedAccount("dropbox"));
    mocks.getConnectorAuthorization.mockResolvedValue({
      userId: 501,
      provider: "dropbox",
      encryptedAccessToken: "encrypted-access",
      encryptedRefreshToken: null,
      accessTokenExpiresAt: new Date("2026-07-13T13:00:00.000Z"),
      tokenType: "Bearer",
      grantedScopes: "[]",
    });
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        entries: Array.from({ length: 100 }, (_, index) => ({
          ".tag": "file",
          path_lower: `/portfolio-${index}.pdf`,
          name: `portfolio-${index}.pdf`,
          size: 100,
        })),
        has_more: true,
        cursor: "cursor-page-2",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        entries: [{
          ".tag": "file",
          path_lower: "/documents/robert-cv.pdf",
          name: "Robert CV.pdf",
          size: 120,
          client_modified: "2026-07-12T10:00:00Z",
        }],
        has_more: false,
        cursor: "cursor-page-3",
      }), { status: 200 }));

    const result = await discoverCloudResumeDocuments(501, "dropbox", discoveryOptions(fetcher));

    expect(result).toMatchObject({ scannedCount: 101, truncated: false });
    expect(result.documents).toEqual([expect.objectContaining({
      provider: "dropbox",
      name: "Robert CV.pdf",
      candidateId: expect.any(String),
    })]);
    expect(fetcher).toHaveBeenNthCalledWith(2,
      "https://api.dropboxapi.com/2/files/list_folder/continue",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ cursor: "cursor-page-2" }),
      })
    );
  });

  it("reports truncation when the provider scan budget is exhausted", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async input => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get("pageToken")?.replace("p", "") ?? 0);
      return new Response(JSON.stringify({
        files: Array.from({ length: 100 }, (_, index) => ({
          id: `other-${page}-${index}`, name: `portfolio-${page}-${index}.pdf`, mimeType: "application/pdf", size: "100",
        })),
        nextPageToken: `p${page + 1}`,
      }), { status: 200 });
    });

    const result = await discoverCloudResumeDocuments(501, "google_drive", discoveryOptions(fetcher));

    expect(result).toMatchObject({ scannedCount: 500, truncated: true, documents: [] });
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("hard-limits oversized Dropbox continuation pages to the remaining scan budget", async () => {
    mocks.getUserConnectorAccount.mockResolvedValue(connectedAccount("dropbox"));
    mocks.getConnectorAuthorization.mockResolvedValue({
      userId: 501,
      provider: "dropbox",
      encryptedAccessToken: "encrypted-access",
      encryptedRefreshToken: null,
      accessTokenExpiresAt: new Date("2026-07-13T13:00:00.000Z"),
      tokenType: "Bearer",
      grantedScopes: "[]",
    });
    const unrelated = Array.from({ length: 100 }, (_, index) => ({
      ".tag": "file",
      path_lower: `/portfolio-${index}.pdf`,
      name: `portfolio-${index}.pdf`,
      size: 100,
    }));
    const oversizedContinuation = Array.from({ length: 600 }, (_, index) => ({
      ".tag": "file",
      path_lower: `/resume-${index}.pdf`,
      name: index >= 400 ? `Resume ${index}.pdf` : `portfolio-${index}.pdf`,
      size: 100,
    }));
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        entries: unrelated,
        has_more: true,
        cursor: "cursor-2",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        entries: oversizedContinuation,
        has_more: false,
      }), { status: 200 }));

    const result = await discoverCloudResumeDocuments(501, "dropbox", discoveryOptions(fetcher));

    expect(result).toMatchObject({ scannedCount: 500, truncated: true, documents: [] });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(mocks.storeCloudResumeCandidates).toHaveBeenCalledWith(501, "dropbox", [], now);
  });

  it("reports truncation when a single provider page exceeds the supported-candidate cap", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      files: Array.from({ length: 75 }, (_, index) => ({
        id: `resume-${index}`, name: `Resume ${index}.pdf`, mimeType: "application/pdf", size: "100",
      })),
    }), { status: 200 }));

    const result = await discoverCloudResumeDocuments(501, "google_drive", discoveryOptions(fetcher));

    expect(result.documents).toHaveLength(50);
    expect(result).toMatchObject({ scannedCount: 75, truncated: true });
    expect(mocks.storeCloudResumeCandidates).toHaveBeenCalledWith(501, "google_drive", expect.any(Array), now);
    expect(mocks.storeCloudResumeCandidates.mock.calls[0]?.[2]).toHaveLength(50);
  });

  it("recognizes common resume and CV file names without surfacing unrelated documents", () => {
    expect(isLikelyCloudResumeDocumentName("Ada-Lovelace_Resume_2026.pdf")).toBe(true);
    expect(isLikelyCloudResumeDocumentName("CV - Ada Lovelace.docx")).toBe(true);
    expect(isLikelyCloudResumeDocumentName("Curriculum Vitae.txt")).toBe(true);
    expect(isLikelyCloudResumeDocumentName("portfolio.pdf")).toBe(false);
    expect(isLikelyCloudResumeDocumentName("employment-letter.pdf")).toBe(false);
  });

  it("rejects an unrelated document name before downloading provider content", async () => {
    const fetcher = vi.fn<typeof fetch>();

    claimCandidate({
      provider: "google_drive",
      sourceId: "employment-letter",
      name: "employment-letter.pdf",
      mimeType: "application/pdf",
      size: 220,
      modifiedAt: null,
    });
    await expect(downloadCloudResumeDocument(501, candidateId, discoveryOptions(fetcher)))
      .rejects.toThrow("selected cloud document is not a supported resume file");

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects forged, expired, and other-user candidate handles before provider access", async () => {
    const fetcher = vi.fn<typeof fetch>();
    mocks.claimCloudResumeCandidate.mockResolvedValueOnce(null);

    await expect(downloadCloudResumeDocument(501, candidateId, discoveryOptions(fetcher)))
      .rejects.toThrow("invalid, expired, already importing, or already used");

    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.getConnectorAuthorization).not.toHaveBeenCalled();
  });

  it("downloads a bounded resume with provider redirects disabled", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "resume-pdf", name: "Resume.pdf", mimeType: "application/pdf", size: "12", modifiedTime: null,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response("resume-bytes", { status: 200 }));
    claimCandidate({
      provider: "google_drive", sourceId: "resume-pdf", name: "Resume.pdf",
      mimeType: "application/pdf", size: 12, modifiedAt: null,
    });

    await expect(downloadCloudResumeDocument(501, candidateId, discoveryOptions(fetcher))).resolves.toMatchObject({
      candidateId,
      fileName: "Resume.pdf",
      mimeType: "application/pdf",
      data: Buffer.from("resume-bytes"),
    });
    expect(fetcher).toHaveBeenLastCalledWith(
      expect.stringContaining("resume-pdf?alt=media"),
      expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) })
    );
  });

  it("rejects an oversized declared resume before buffering provider content", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "resume-pdf", name: "Resume.pdf", mimeType: "application/pdf", size: null, modifiedTime: null,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response("not-read", {
        status: 200,
        headers: { "content-length": String(10 * 1024 * 1024 + 1) },
      }));
    claimCandidate({
      provider: "google_drive", sourceId: "resume-pdf", name: "Resume.pdf",
      mimeType: "application/pdf", size: null, modifiedAt: null,
    });

    await expect(downloadCloudResumeDocument(501, candidateId, discoveryOptions(fetcher)))
      .rejects.toThrow("between 1 byte and 10MB");
    expect(mocks.upsertUserConnectorAccount).not.toHaveBeenCalled();
  });

  it("requires provider metadata to remain unchanged after candidate discovery", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      id: "resume-pdf", name: "Resume-updated.pdf", mimeType: "application/pdf", size: "12", modifiedTime: null,
    }), { status: 200 }));
    claimCandidate({
      provider: "google_drive", sourceId: "resume-pdf", name: "Resume.pdf",
      mimeType: "application/pdf", size: 12, modifiedAt: null,
    });

    await expect(downloadCloudResumeDocument(501, candidateId, discoveryOptions(fetcher)))
      .rejects.toThrow("changed since discovery");

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(mocks.releaseCloudResumeCandidate).toHaveBeenCalledWith(501, candidateId);
  });

  it("invalidates an imported candidate when its provider object has been deleted", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
    claimCandidate({
      provider: "google_drive", sourceId: "resume-pdf", name: "Resume.pdf",
      mimeType: "application/pdf", size: 12, modifiedAt: null,
    });

    await expect(downloadCloudResumeDocument(501, candidateId, discoveryOptions(fetcher)))
      .rejects.toThrow("document discovery is temporarily unavailable");

    expect(fetcher).toHaveBeenCalledOnce();
    expect(mocks.releaseCloudResumeCandidate).toHaveBeenCalledWith(501, candidateId);
  });

  it("rejects oversized discovery metadata without verifying the connector", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", {
      status: 200,
      headers: { "content-length": String(1024 * 1024 + 1) },
    }));

    await expect(discoverCloudResumeDocuments(501, "google_drive", discoveryOptions(fetcher)))
      .rejects.toThrow("returned too much document metadata");
    expect(mocks.upsertUserConnectorAccount).not.toHaveBeenCalled();
  });

  it("refuses discovery when connector verification is stale before reading provider data", async () => {
    mocks.getUserConnectorAccount.mockResolvedValue({
      ...connectedAccount("google_drive"),
      lastVerifiedAt: new Date("2026-06-01T00:00:00.000Z"),
    });
    const fetcher = vi.fn<typeof fetch>();

    await expect(discoverCloudResumeDocuments(501, "google_drive", discoveryOptions(fetcher))).rejects.toThrow(
      "Google Drive must be freshly authorized"
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses cloud discovery without resume-document read consent", async () => {
    mocks.getUserConnectorAccount.mockResolvedValue({
      ...connectedAccount("google_drive"),
      consentScopes: JSON.stringify(["files.metadata.read"]),
    });
    const fetcher = vi.fn<typeof fetch>();

    await expect(discoverCloudResumeDocuments(501, "google_drive", discoveryOptions(fetcher))).rejects.toThrow(
      "Google Drive must be freshly authorized with resume-document read consent"
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("marks a revoked cloud grant for reauthorization before surfacing the provider error", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));

    await expect(discoverCloudResumeDocuments(501, "google_drive", discoveryOptions(fetcher))).rejects.toThrow(
      "Google Drive authorization is no longer valid"
    );
    expect(mocks.upsertUserConnectorAccount).toHaveBeenCalledWith(expect.objectContaining({
      provider: "google_drive",
      status: "needs_reauth",
    }));
  });

  it("does not mark a cloud grant revoked for an insufficient-scope 403", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 403,
      headers: { "www-authenticate": 'Bearer error="insufficient_scope"' },
    }));

    await expect(discoverCloudResumeDocuments(501, "google_drive", discoveryOptions(fetcher)))
      .rejects.toThrow("temporarily unavailable");
    expect(mocks.upsertUserConnectorAccount).not.toHaveBeenCalledWith(expect.objectContaining({
      status: "needs_reauth",
    }));
  });

  it("refreshes a grant with missing expiry metadata instead of treating it as permanent access", async () => {
    mocks.getConnectorAuthorization.mockResolvedValue({
      userId: 501,
      provider: "google_drive",
      encryptedAccessToken: "encrypted-access",
      encryptedRefreshToken: "encrypted-refresh",
      accessTokenExpiresAt: null,
      tokenType: "Bearer",
      grantedScopes: "[]",
    });
    mocks.getConnectorOAuthConfig.mockReturnValue({ provider: "google_drive" });
    mocks.refreshConnectorAccessToken.mockResolvedValue({
      accessToken: "renewed-access-token",
      refreshToken: null,
      expiresAt: new Date("2026-07-13T13:00:00.000Z"),
      tokenType: "Bearer",
      grantedScopes: [],
    });
    mocks.encryptConnectorToken.mockReturnValue("renewed-encrypted-token");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ files: [] }), { status: 200 }));

    await expect(discoverCloudResumeDocuments(501, "google_drive", discoveryOptions(fetcher)))
      .resolves.toMatchObject({ documents: [], scannedCount: 0, truncated: false });

    expect(mocks.refreshConnectorAccessToken).toHaveBeenCalled();
    expect(mocks.upsertConnectorAuthorization).toHaveBeenCalledWith(expect.objectContaining({
      encryptedRefreshToken: "encrypted-refresh",
    }));
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: { Authorization: "Bearer renewed-access-token" } })
    );
  });
});
