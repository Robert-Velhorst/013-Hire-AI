import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildGoogleCalendarEvent,
  buildOutlookCalendarEvent,
  syncInterviewCalendar,
  type CalendarSyncDependencies,
} from "./interviewCalendarSync";

const fixedNow = new Date("2026-10-15T10:00:00.000Z");
const interview = {
  id: 12,
  applicationId: 23,
  interviewType: "video",
  scheduledAt: new Date("2026-10-16T14:00:00.000Z"),
  duration: 45,
  location: "Online",
  meetingLink: "https://meet.example.test/interview",
  interviewerName: "Recruiter",
  interviewerTitle: "Talent Partner",
  status: "scheduled",
  jobTitle: "Engineer",
  company: "Example Co",
};
const record = {
  id: 7,
  userId: 3,
  interviewId: interview.id,
  provider: "gmail" as const,
  status: "pending" as const,
  providerEventId: null,
  idempotencyKey: "hire-ai-calendar-3-12-gmail",
  lastErrorCode: null,
  attemptCount: 1,
  lastAttemptAt: fixedNow,
  syncedAt: null,
  updatedAt: fixedNow,
};

function makeDependencies(overrides: Partial<CalendarSyncDependencies> = {}) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: "provider-event-1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  );
  const dependencies: CalendarSyncDependencies = {
    claimInterviewCalendarSync: vi
      .fn()
      .mockResolvedValue({ kind: "claimed", record }),
    createAuditEvent: vi.fn().mockResolvedValue({ insertId: 1 }),
    decryptConnectorToken: vi.fn(token => token),
    finishInterviewCalendarSync: vi.fn().mockResolvedValue(undefined),
    getConnectorAuthorization: vi.fn().mockResolvedValue({
      encryptedAccessToken: "encrypted-access",
      encryptedRefreshToken: null,
      grantedScopes: JSON.stringify([
        "https://www.googleapis.com/auth/calendar.events",
      ]),
    }),
    getInterviewCalendarDetails: vi.fn().mockResolvedValue(interview),
    getInterviewCalendarSync: vi.fn(),
    getUserConnectorAccount: vi.fn().mockResolvedValue({
      provider: "gmail",
      status: "connected",
      consentScopes: JSON.stringify(["calendar.events.write"]),
      lastVerifiedAt: fixedNow,
    }),
    getUsableConnectorAccessToken: vi.fn().mockResolvedValue("access-token"),
    isConnectorAuthorizationStale: vi.fn().mockReturnValue(false),
    isAuthoritativeInvalidConnectorToken: vi.fn().mockReturnValue(false),
    listInterviewCalendarSyncs: vi.fn().mockResolvedValue([]),
    providerRequestInit: vi.fn(init => init),
    readProviderJson: async <T>(response: Response) =>
      (await response.json()) as T,
    upsertUserConnectorAccount: vi.fn().mockResolvedValue(undefined),
    fetcher: fetchMock as unknown as typeof fetch,
    now: () => fixedNow,
    ...overrides,
  };
  return { dependencies, fetchMock };
}

describe("interview calendar provider sync", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds private provider events without copying interview notes", () => {
    const privateInterview = {
      ...interview,
      notes: "Private preparation notes",
    } as typeof interview & { notes: string };
    const google = buildGoogleCalendarEvent(
      privateInterview,
      record.idempotencyKey
    );
    const outlook = buildOutlookCalendarEvent(
      privateInterview,
      record.idempotencyKey
    );

    expect(google.visibility).toBe("private");
    expect(google.extendedProperties.private.hireAiIdempotencyKey).toBe(
      record.idempotencyKey
    );
    expect(JSON.stringify(google)).not.toContain("Private preparation notes");
    expect(outlook.sensitivity).toBe("private");
    expect(outlook.transactionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(outlook)).not.toContain("Private preparation notes");
    expect(outlook.start).toEqual({
      dateTime: "2026-10-16T14:00:00.000Z",
      timeZone: "UTC",
    });
  });

  it("creates a deterministic Google event only with explicit provider calendar consent", async () => {
    const { dependencies, fetchMock } = makeDependencies();
    const result = await syncInterviewCalendar(
      { userId: 3, interviewId: interview.id, provider: "gmail" },
      dependencies
    );

    expect(result).toEqual({
      status: "synced",
      provider: "gmail",
      alreadyCurrent: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events"
    );
    const body = JSON.parse(String(init.body));
    expect(body.id).toMatch(/^[0-9a-f]{64}$/);
    expect(body.visibility).toBe("private");
    expect(body.description).not.toContain("notes");
    expect(dependencies.finishInterviewCalendarSync).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "synced",
        providerEventId: "provider-event-1",
      })
    );
    expect(dependencies.createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "interview_calendar_synced",
        afterState: JSON.stringify({
          interviewId: interview.id,
          provider: "gmail",
          status: "synced",
          errorCode: null,
        }),
      })
    );
  });

  it("does not contact a provider when calendar consent is absent", async () => {
    const { dependencies, fetchMock } = makeDependencies({
      getUserConnectorAccount: vi.fn().mockResolvedValue({
        provider: "gmail",
        status: "connected",
        consentScopes: JSON.stringify(["email.messages.read_recruiting"]),
        lastVerifiedAt: fixedNow,
      }),
    });

    await expect(
      syncInterviewCalendar(
        { userId: 3, interviewId: interview.id, provider: "gmail" },
        dependencies
      )
    ).rejects.toMatchObject({ code: "PRECONDITION" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dependencies.finishInterviewCalendarSync).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "credential_unavailable",
      })
    );
  });

  it("records network ambiguity as unknown and refuses retry without explicit confirmation", async () => {
    const first = makeDependencies({
      fetcher: vi
        .fn()
        .mockRejectedValue(
          new Error("socket reset")
        ) as unknown as typeof fetch,
    });
    await expect(
      syncInterviewCalendar(
        { userId: 3, interviewId: interview.id, provider: "gmail" },
        first.dependencies
      )
    ).rejects.toMatchObject({ code: "UNKNOWN" });
    expect(first.dependencies.finishInterviewCalendarSync).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "unknown",
        lastErrorCode: "network_failure",
      })
    );

    const blocked = makeDependencies({
      claimInterviewCalendarSync: vi
        .fn()
        .mockResolvedValue({ kind: "uncertain" }),
    });
    await expect(
      syncInterviewCalendar(
        { userId: 3, interviewId: interview.id, provider: "gmail" },
        blocked.dependencies
      )
    ).rejects.toMatchObject({ code: "UNKNOWN" });
    expect(blocked.fetchMock).not.toHaveBeenCalled();
  });

  it("audits a stale pending reservation once when it is recovered as unknown", async () => {
    const { dependencies, fetchMock } = makeDependencies({
      claimInterviewCalendarSync: vi
        .fn()
        .mockResolvedValue({ kind: "uncertain", recovered: true }),
    });

    await expect(
      syncInterviewCalendar(
        { userId: 3, interviewId: interview.id, provider: "gmail" },
        dependencies
      )
    ).rejects.toMatchObject({ code: "UNKNOWN" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(dependencies.createAuditEvent).toHaveBeenCalledWith({
      userId: 3,
      entityType: "application",
      entityId: interview.applicationId,
      action: "interview_calendar_unknown",
      actor: "system",
      source: "interviewCalendarSync.recovery",
      afterState: JSON.stringify({
        interviewId: interview.id,
        provider: "gmail",
        status: "unknown",
        errorCode: "network_failure",
        retryBlocked: true,
      }),
      riskLevel: "medium",
    });
  });

  it("verifies an existing Google event after a missing-event recreate conflict", async () => {
    const deterministicEventId = buildGoogleCalendarEvent(
      interview,
      record.idempotencyKey
    ).id;
    const syncedRecord = {
      ...record,
      status: "synced" as const,
      providerEventId: deterministicEventId,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: deterministicEventId,
            extendedProperties: {
              private: { hireAiIdempotencyKey: record.idempotencyKey },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    const { dependencies } = makeDependencies({
      claimInterviewCalendarSync: vi
        .fn()
        .mockResolvedValue({ kind: "claimed", record: syncedRecord }),
      fetcher: fetchMock as unknown as typeof fetch,
    });

    const result = await syncInterviewCalendar(
      { userId: 3, interviewId: interview.id, provider: "gmail" },
      dependencies
    );

    expect(result).toEqual({
      status: "synced",
      provider: "gmail",
      alreadyCurrent: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events"
    );
    expect(fetchMock.mock.calls[2][0]).toBe(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${deterministicEventId}`
    );
    expect(dependencies.finishInterviewCalendarSync).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "synced",
        providerEventId: deterministicEventId,
      })
    );
  });

  it("does not treat a Google update conflict as confirmation of current event contents", async () => {
    const syncedRecord = {
      ...record,
      status: "synced" as const,
      providerEventId: buildGoogleCalendarEvent(
        interview,
        record.idempotencyKey
      ).id,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 409 }));
    const { dependencies } = makeDependencies({
      claimInterviewCalendarSync: vi
        .fn()
        .mockResolvedValue({ kind: "claimed", record: syncedRecord }),
      fetcher: fetchMock as unknown as typeof fetch,
    });

    await expect(
      syncInterviewCalendar(
        { userId: 3, interviewId: interview.id, provider: "gmail" },
        dependencies
      )
    ).rejects.toMatchObject({ code: "PROVIDER" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(dependencies.finishInterviewCalendarSync).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" })
    );
  });

  it("reuses a stable Outlook transaction ID and records provider rejections", async () => {
    const outlookRecord = {
      ...record,
      provider: "outlook" as const,
      idempotencyKey: "hire-ai-calendar-3-12-outlook",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 403 }));
    const dependencies = makeDependencies({
      claimInterviewCalendarSync: vi
        .fn()
        .mockResolvedValue({ kind: "claimed", record: outlookRecord }),
      getUserConnectorAccount: vi.fn().mockResolvedValue({
        provider: "outlook",
        status: "connected",
        consentScopes: JSON.stringify(["calendar.events.write"]),
        lastVerifiedAt: fixedNow,
      }),
      getConnectorAuthorization: vi.fn().mockResolvedValue({
        encryptedAccessToken: "encrypted-access",
        grantedScopes: JSON.stringify(["Calendars.ReadWrite"]),
      }),
      fetcher: fetchMock as unknown as typeof fetch,
    });

    await expect(
      syncInterviewCalendar(
        { userId: 3, interviewId: interview.id, provider: "outlook" },
        dependencies.dependencies
      )
    ).rejects.toMatchObject({ code: "PROVIDER" });
    const body = JSON.parse(
      String((fetchMock.mock.calls[0][1] as RequestInit).body)
    );
    expect(body.transactionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      dependencies.dependencies.finishInterviewCalendarSync
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "provider_rejected",
      })
    );
  });
});
