import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  downloadCloudResumeDocument,
  discoverCloudResumeDocuments,
  isLikelyCloudResumeDocumentName,
  type CloudDocumentDiscoveryDependencies,
} from "./cloudDocumentDiscovery";

const mocks = {
  getConnectorAuthorization: vi.fn(),
  getUserConnectorAccount: vi.fn(),
  upsertConnectorAuthorization: vi.fn(),
  upsertUserConnectorAccount: vi.fn(),
  decryptConnectorToken: vi.fn(),
  encryptConnectorToken: vi.fn(),
  getConnectorOAuthConfig: vi.fn(),
  refreshConnectorAccessToken: vi.fn(),
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

describe("cloud resume discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    const documents = await discoverCloudResumeDocuments(501, "google_drive", discoveryOptions(fetcher));

    expect(documents).toEqual([{
      provider: "google_drive",
      sourceId: "resume-pdf",
      name: "Resume.pdf",
      mimeType: "application/pdf",
      size: 124,
      modifiedAt: "2026-07-12T10:00:00Z",
    }]);
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

    const documents = await discoverCloudResumeDocuments(501, "dropbox", discoveryOptions(fetcher));

    expect(documents).toEqual([
      expect.objectContaining({
        provider: "dropbox",
        sourceId: "/cv.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
      expect.objectContaining({
        provider: "dropbox",
        sourceId: "/resume.rtf",
        mimeType: "text/rtf",
      }),
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.dropboxapi.com/2/files/list_folder",
      expect.objectContaining({ method: "POST" })
    );
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

    await expect(downloadCloudResumeDocument(501, {
      provider: "google_drive",
      sourceId: "employment-letter",
      name: "employment-letter.pdf",
      mimeType: "application/pdf",
      size: 220,
      modifiedAt: null,
    }, discoveryOptions(fetcher))).rejects.toThrow("selected cloud document is not a supported resume file");

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("downloads a bounded resume with provider redirects disabled", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("resume-bytes", {
      status: 200,
      headers: { "content-type": "application/pdf" },
    }));

    await expect(downloadCloudResumeDocument(501, {
      provider: "google_drive",
      sourceId: "resume-pdf",
      name: "Resume.pdf",
      mimeType: "application/pdf",
      size: 12,
      modifiedAt: null,
    }, discoveryOptions(fetcher))).resolves.toMatchObject({
      fileName: "Resume.pdf",
      mimeType: "application/pdf",
      data: Buffer.from("resume-bytes"),
    });
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("resume-pdf?alt=media"),
      expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) })
    );
  });

  it("rejects an oversized declared resume before buffering provider content", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("not-read", {
      status: 200,
      headers: { "content-length": String(10 * 1024 * 1024 + 1) },
    }));

    await expect(downloadCloudResumeDocument(501, {
      provider: "google_drive",
      sourceId: "resume-pdf",
      name: "Resume.pdf",
      mimeType: "application/pdf",
      size: null,
      modifiedAt: null,
    }, discoveryOptions(fetcher))).rejects.toThrow("between 1 byte and 10MB");
    expect(mocks.upsertUserConnectorAccount).not.toHaveBeenCalled();
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

    await expect(discoverCloudResumeDocuments(501, "google_drive", discoveryOptions(fetcher))).resolves.toEqual([]);

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
