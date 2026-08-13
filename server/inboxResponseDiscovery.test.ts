import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  discoverInboxResponseCandidates,
  type InboxResponseDiscoveryDependencies,
} from "./inboxResponseDiscovery";

const now = new Date("2026-07-13T12:00:00.000Z");
const mocks = {
  acquireConnectorRefreshLease: vi.fn().mockResolvedValue(true),
  findEmployerResponseSourceReferences: vi.fn(),
  getConnectorAuthorization: vi.fn(),
  getUserInboxMatchApplications: vi.fn(),
  getUserConnectorAccount: vi.fn(),
  upsertConnectorAuthorization: vi.fn(),
  upsertUserConnectorAccount: vi.fn(),
  decryptConnectorToken: vi.fn(),
  encryptConnectorToken: vi.fn(),
  getConnectorOAuthConfig: vi.fn(),
  refreshConnectorAccessToken: vi.fn(),
  releaseConnectorRefreshLease: vi.fn().mockResolvedValue(true),
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
    mocks.getUserConnectorAccount.mockResolvedValue(connectedInbox("gmail"));
    mocks.getConnectorAuthorization.mockResolvedValue({
      encryptedAccessToken: "encrypted-access",
      encryptedRefreshToken: "encrypted-refresh",
      accessTokenExpiresAt: new Date("2026-07-13T13:00:00.000Z"),
    });
    mocks.decryptConnectorToken.mockReturnValue("provider-access-token");
    mocks.upsertUserConnectorAccount.mockResolvedValue(undefined);
    mocks.getUserInboxMatchApplications.mockResolvedValue([{
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
    expect(fetcher.mock.calls[0][1]).toEqual(expect.objectContaining({
      redirect: "error",
      signal: expect.any(AbortSignal),
    }));
    expect(fetcher.mock.calls[1][1]).toEqual(expect.objectContaining({
      redirect: "error",
      signal: expect.any(AbortSignal),
    }));
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

  it("reads Gmail message details in ordered batches of at most five", async () => {
    const releases: Array<() => void> = [];
    let requestCount = 0;
    let detailCalls = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response(JSON.stringify({
          messages: Array.from({ length: 6 }, (_, index) => ({ id: `gmail-${index + 1}` })),
        }), { status: 200 });
      }
      detailCalls += 1;
      if (detailCalls <= 5) {
        await new Promise<void>((resolve) => releases.push(resolve));
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const discovery = discoverInboxResponseCandidates(700, "gmail", options(fetcher));
    await vi.waitFor(() => expect(detailCalls).toBe(5));
    expect(fetcher).toHaveBeenCalledTimes(6);
    releases.splice(0).forEach((release) => release());

    await expect(discovery).resolves.toEqual([]);
    expect(detailCalls).toBe(6);
  });

  it("aborts an active Gmail request when its autonomous owner stops", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      requestSignal = init?.signal ?? undefined;
      return await new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => {
          const error = new Error("request cancelled");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    });
    const discovery = discoverInboxResponseCandidates(700, "gmail", {
      ...options(fetcher),
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());

    controller.abort();

    await expect(discovery).rejects.toMatchObject({ name: "AbortError" });
    expect(requestSignal?.aborted).toBe(true);
  });

  it("rejects oversized Gmail list metadata before verifying the connector", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", {
      status: 200,
      headers: { "content-length": String(1024 * 1024 + 1) },
    }));

    await expect(discoverInboxResponseCandidates(700, "gmail", options(fetcher)))
      .rejects.toThrow("Outbound response exceeded");
    expect(mocks.upsertUserConnectorAccount).not.toHaveBeenCalled();
  });

  it("rejects stale inbox consent before reading any external message", async () => {
    mocks.getUserConnectorAccount.mockResolvedValue({
      ...connectedInbox("gmail"),
      lastVerifiedAt: new Date("2026-06-01T00:00:00.000Z"),
    });
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
    mocks.getUserConnectorAccount.mockResolvedValue(connectedInbox("outlook"));
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
    mocks.getUserConnectorAccount.mockResolvedValue(connectedInbox("outlook"));
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
    mocks.decryptConnectorToken.mockReturnValue("refresh-token");
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
