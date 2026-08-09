import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  discoverInboxResponseCandidates,
  type InboxResponseDiscoveryDependencies,
} from "./inboxResponseDiscovery";

const now = new Date("2026-07-13T12:00:00.000Z");
const mocks = {
  findEmployerResponseSourceReferences: vi.fn(),
  getConnectorAuthorization: vi.fn(),
  getUserApplications: vi.fn(),
  listUserConnectorAccounts: vi.fn(),
  upsertConnectorAuthorization: vi.fn(),
  upsertUserConnectorAccount: vi.fn(),
  decryptConnectorToken: vi.fn(),
  encryptConnectorToken: vi.fn(),
  getConnectorOAuthConfig: vi.fn(),
  refreshConnectorAccessToken: vi.fn(),
};
const dependencies = mocks as unknown as InboxResponseDiscoveryDependencies;

function connectedInbox(provider: "gmail" | "outlook") {
  return {
    id: 1,
    userId: 700,
    provider,
    status: "connected" as const,
    consentScopes: JSON.stringify([provider === "gmail" ? "email.messages.read_recruiting" : "mail.messages.read_recruiting"]),
    externalAccountLabel: "candidate@example.com",
    connectionRequestedAt: now,
    lastVerifiedAt: now,
    disconnectedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function options(fetcher: typeof fetch) {
  return { fetcher, now, dependencies };
}

describe("inbox response discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findEmployerResponseSourceReferences.mockResolvedValue([]);
    mocks.listUserConnectorAccounts.mockResolvedValue([connectedInbox("gmail")]);
    mocks.getConnectorAuthorization.mockResolvedValue({
      encryptedAccessToken: "encrypted-access",
      encryptedRefreshToken: "encrypted-refresh",
      accessTokenExpiresAt: new Date("2026-07-13T13:00:00.000Z"),
    });
    mocks.decryptConnectorToken.mockReturnValue("provider-access-token");
    mocks.upsertUserConnectorAccount.mockResolvedValue(undefined);
    mocks.getUserApplications.mockResolvedValue([{
      id: 701,
      status: "applied",
      job: { company: "Acme Analytics", title: "Senior Data Engineer" },
    }]);
  });

  it("returns a matched Gmail interview candidate without changing the application ledger", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [{ id: "gmail-701" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        snippet: "We would like to schedule an interview with Acme Analytics next week.",
        payload: { headers: [
          { name: "From", value: "recruiter@acme.example" },
          { name: "Subject", value: "Acme Analytics interview" },
          { name: "Date", value: "Sun, 13 Jul 2026 10:00:00 +0000" },
        ] },
      }), { status: 200 }));

    const candidates = await discoverInboxResponseCandidates(700, "gmail", options(fetcher));

    expect(candidates).toEqual([expect.objectContaining({
      applicationId: 701,
      provider: "gmail",
      messageId: "gmail-701",
      suggestedResponseType: "interview_invite",
      confidence: "medium",
    })]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(mocks.upsertUserConnectorAccount).toHaveBeenCalledWith(expect.objectContaining({
      provider: "gmail",
      status: "connected",
      lastVerifiedAt: now,
    }));
  });

  it("does not rediscover a Gmail message already recorded in the employer-response ledger", async () => {
    mocks.findEmployerResponseSourceReferences.mockResolvedValue(["gmail:gmail-701"]);
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [{ id: "gmail-701" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        snippet: "We would like to schedule an interview with Acme Analytics next week.",
        payload: { headers: [
          { name: "From", value: "recruiter@acme.example" },
          { name: "Subject", value: "Acme Analytics interview" },
          { name: "Date", value: "Sun, 13 Jul 2026 10:00:00 +0000" },
        ] },
      }), { status: 200 }));

    await expect(discoverInboxResponseCandidates(700, "gmail", options(fetcher))).resolves.toEqual([]);
    expect(mocks.findEmployerResponseSourceReferences).toHaveBeenCalledWith({
      userId: 700,
      source: "email",
      sourceReferences: ["gmail:gmail-701"],
    });
  });

  it("checks all matched message references in one ownership-scoped database lookup", async () => {
    mocks.findEmployerResponseSourceReferences.mockResolvedValue(["gmail:gmail-recorded"]);
    const message = (hour: string) => new Response(JSON.stringify({
      snippet: "Acme Analytics would like to discuss your application.",
      payload: { headers: [
        { name: "From", value: "recruiter@acme.example" },
        { name: "Subject", value: "Acme Analytics application update" },
        { name: "Date", value: `Sun, 13 Jul 2026 ${hour}:00:00 +0000` },
      ] },
    }), { status: 200 });
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        messages: [{ id: "gmail-recorded" }, { id: "gmail-new" }],
      }), { status: 200 }))
      .mockResolvedValueOnce(message("10"))
      .mockResolvedValueOnce(message("11"));

    const candidates = await discoverInboxResponseCandidates(700, "gmail", options(fetcher));

    expect(candidates.map((candidate) => candidate.messageId)).toEqual(["gmail-new"]);
    expect(mocks.findEmployerResponseSourceReferences).toHaveBeenCalledOnce();
    expect(mocks.findEmployerResponseSourceReferences).toHaveBeenCalledWith({
      userId: 700,
      source: "email",
      sourceReferences: ["gmail:gmail-recorded", "gmail:gmail-new"],
    });
  });

  it("rejects stale inbox consent before reading any external message", async () => {
    mocks.listUserConnectorAccounts.mockResolvedValue([{
      ...connectedInbox("gmail"),
      lastVerifiedAt: new Date("2026-06-01T00:00:00.000Z"),
    }]);
    const fetcher = vi.fn<typeof fetch>();

    await expect(discoverInboxResponseCandidates(700, "gmail", options(fetcher))).rejects.toThrow(
      "Gmail must be freshly authorized"
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("marks a revoked inbox grant for reauthorization before surfacing the provider error", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));

    await expect(discoverInboxResponseCandidates(700, "gmail", options(fetcher))).rejects.toThrow(
      "Gmail authorization is no longer valid"
    );
    expect(mocks.upsertUserConnectorAccount).toHaveBeenCalledWith(expect.objectContaining({
      provider: "gmail",
      status: "needs_reauth",
    }));
  });

  it("marks an expired inbox grant without a refresh token for reauthorization", async () => {
    mocks.getConnectorAuthorization.mockResolvedValue({
      encryptedAccessToken: "expired-access",
      encryptedRefreshToken: null,
      accessTokenExpiresAt: new Date("2026-07-13T11:59:00.000Z"),
    });
    const fetcher = vi.fn<typeof fetch>();

    await expect(discoverInboxResponseCandidates(700, "gmail", options(fetcher))).rejects.toThrow(
      "Gmail authorization has expired"
    );
    expect(mocks.upsertUserConnectorAccount).toHaveBeenCalledWith(expect.objectContaining({
      provider: "gmail",
      status: "needs_reauth",
    }));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reads Outlook metadata and only surfaces an unambiguous application match", async () => {
    mocks.listUserConnectorAccounts.mockResolvedValue([connectedInbox("outlook")]);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      value: [{
        id: "outlook-701",
        subject: "Acme Analytics application update",
        bodyPreview: "Unfortunately, Acme Analytics will not be proceeding with this application.",
        from: { emailAddress: { address: "recruiter@acme.example" } },
        receivedDateTime: "2026-07-13T11:00:00.000Z",
      }],
    }), { status: 200 }));

    const candidates = await discoverInboxResponseCandidates(700, "outlook", options(fetcher));

    expect(candidates).toEqual([expect.objectContaining({
      provider: "outlook",
      applicationId: 701,
      suggestedResponseType: "rejection",
    })]);
    const [requestUrl] = fetcher.mock.calls[0];
    expect(String(requestUrl)).toContain("%24filter=receivedDateTime+ge+2026-06-13T12%3A00%3A00.000Z");
  });

  it("does not surface Outlook messages outside the recruiting response lookback window", async () => {
    mocks.listUserConnectorAccounts.mockResolvedValue([connectedInbox("outlook")]);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      value: [{
        id: "outlook-stale-701",
        subject: "Acme Analytics application update",
        bodyPreview: "We would like to schedule an interview for Acme Analytics.",
        from: { emailAddress: { address: "recruiter@acme.example" } },
        receivedDateTime: "2026-06-13T11:59:59.000Z",
      }],
    }), { status: 200 }));

    await expect(discoverInboxResponseCandidates(700, "outlook", options(fetcher))).resolves.toEqual([]);
    expect(mocks.findEmployerResponseSourceReferences).not.toHaveBeenCalled();
  });

  it("renews an expired Gmail grant before scanning recruiting messages", async () => {
    mocks.getConnectorAuthorization.mockResolvedValue({
      encryptedAccessToken: "expired-access",
      encryptedRefreshToken: "encrypted-refresh",
      accessTokenExpiresAt: new Date("2026-07-13T11:59:00.000Z"),
    });
    mocks.decryptConnectorToken
      .mockReturnValueOnce("expired-access-token")
      .mockReturnValueOnce("refresh-token");
    mocks.getConnectorOAuthConfig.mockReturnValue({ provider: "gmail" });
    mocks.refreshConnectorAccessToken.mockResolvedValue({
      accessToken: "renewed-access-token",
      refreshToken: null,
      expiresAt: new Date("2026-07-13T13:00:00.000Z"),
      tokenType: "Bearer",
      grantedScopes: ["https://www.googleapis.com/auth/gmail.metadata"],
    });
    mocks.encryptConnectorToken.mockReturnValue("renewed-encrypted-access");
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [] }), { status: 200 }));

    await expect(discoverInboxResponseCandidates(700, "gmail", options(fetcher))).resolves.toEqual([]);

    expect(mocks.refreshConnectorAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "gmail" }),
      "refresh-token",
      fetcher
    );
    expect(mocks.upsertConnectorAuthorization).toHaveBeenCalledWith(expect.objectContaining({
      provider: "gmail",
      encryptedAccessToken: "renewed-encrypted-access",
      encryptedRefreshToken: "encrypted-refresh",
    }));
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("gmail.googleapis.com"),
      expect.objectContaining({ headers: { Authorization: "Bearer renewed-access-token" } })
    );
  });
});
