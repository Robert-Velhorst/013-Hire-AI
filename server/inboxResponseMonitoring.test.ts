import { describe, expect, it, vi } from "vitest";
import { monitorInboxResponses } from "./inboxResponseMonitoring";

const candidate = {
  provider: "gmail" as const,
  messageId: "message-701",
  applicationId: 701,
  company: "Acme Analytics",
  jobTitle: "Senior Data Engineer",
  sender: "recruiter@acme.example",
  subject: "Interview request",
  preview: "We would like to schedule an interview.",
  receivedAt: "2026-07-13T12:00:00.000Z",
  suggestedResponseType: "interview_invite" as const,
  confidence: "high" as const,
};

function dependencies() {
  return {
    createAuditEvent: vi.fn().mockResolvedValue({ insertId: 1 }),
    listUserConnectorAccounts: vi.fn().mockResolvedValue([{
      provider: "gmail",
      status: "connected",
      consentScopes: JSON.stringify(["email.messages.read_recruiting"]),
      lastVerifiedAt: new Date(),
    }]),
    upsertInboxResponseCandidate: vi.fn().mockResolvedValue({ existing: false }),
    discoverInboxResponseCandidates: vi.fn().mockResolvedValue([candidate]),
  } as any;
}

describe("inbox response monitoring", () => {
  it("persists consented inbox matches as review candidates without recording an employer response", async () => {
    const mocks = dependencies();

    await expect(monitorInboxResponses(701, { dependencies: mocks })).resolves.toEqual({
      providersScanned: 1,
      inboxReauthorizationRequired: 0,
      candidatesDiscovered: 1,
      monitoringFailures: 0,
      errors: [],
    });
    expect(mocks.upsertInboxResponseCandidate).toHaveBeenCalledWith(expect.objectContaining({
      userId: 701,
      applicationId: 701,
      messageId: "message-701",
      suggestedResponseType: "interview_invite",
    }));
    expect(mocks.createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "inbox_response_monitoring_scanned",
      actor: "system",
      source: "autonomousService",
    }));
  });

  it("does not read a provider unless recruiting-message consent is granted", async () => {
    const mocks = dependencies();
    mocks.listUserConnectorAccounts.mockResolvedValue([{
      provider: "gmail",
      status: "connected",
      consentScopes: JSON.stringify([]),
    }]);

    await expect(monitorInboxResponses(701, { dependencies: mocks })).resolves.toMatchObject({
      providersScanned: 0,
      candidatesDiscovered: 0,
    });
    expect(mocks.discoverInboxResponseCandidates).not.toHaveBeenCalled();
    expect(mocks.createAuditEvent).not.toHaveBeenCalled();
  });

  it("reports connector-account lookup failures without exposing the underlying exception", async () => {
    const mocks = dependencies();
    mocks.listUserConnectorAccounts.mockRejectedValue(new Error("Connector account store is unavailable: Bearer secret-account-token"));

    await expect(monitorInboxResponses(701, { dependencies: mocks })).resolves.toEqual({
      providersScanned: 0,
      inboxReauthorizationRequired: 0,
      candidatesDiscovered: 0,
      monitoringFailures: 1,
      errors: ["accounts: unable to load connector accounts"],
    });
    expect(mocks.discoverInboxResponseCandidates).not.toHaveBeenCalled();
    expect(mocks.createAuditEvent).not.toHaveBeenCalled();
  });

  it("does not treat stale authorization as a monitor failure or read the inbox", async () => {
    const mocks = dependencies();
    mocks.listUserConnectorAccounts.mockResolvedValue([{
      provider: "gmail",
      status: "connected",
      consentScopes: JSON.stringify(["email.messages.read_recruiting"]),
      lastVerifiedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    }]);

    await expect(monitorInboxResponses(701, { dependencies: mocks })).resolves.toEqual({
      providersScanned: 0,
      inboxReauthorizationRequired: 1,
      candidatesDiscovered: 0,
      monitoringFailures: 0,
      errors: [],
    });
    expect(mocks.discoverInboxResponseCandidates).not.toHaveBeenCalled();
    expect(mocks.createAuditEvent).not.toHaveBeenCalled();
  });

  it("records provider failures without exposing provider exception details", async () => {
    const mocks = dependencies();
    mocks.discoverInboxResponseCandidates.mockRejectedValue(new Error("Gmail authorization is no longer valid: Bearer provider-secret"));

    await expect(monitorInboxResponses(701, { dependencies: mocks })).resolves.toMatchObject({
      providersScanned: 0,
      candidatesDiscovered: 0,
      monitoringFailures: 1,
      errors: ["gmail: inbox response monitoring failed"],
    });
    expect(mocks.createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "inbox_response_monitoring_failed",
      riskLevel: "medium",
      afterState: expect.not.stringContaining("provider-secret"),
    }));
  });

  it("surfaces reauthorization when a live inbox scan invalidates a previously healthy grant", async () => {
    const mocks = dependencies();
    const connectedAccount = {
      provider: "gmail",
      status: "connected",
      consentScopes: JSON.stringify(["email.messages.read_recruiting"]),
      lastVerifiedAt: new Date(),
    };
    mocks.listUserConnectorAccounts
      .mockResolvedValueOnce([connectedAccount])
      .mockResolvedValueOnce([{ ...connectedAccount, status: "needs_reauth" }]);
    mocks.discoverInboxResponseCandidates.mockRejectedValue(new Error("Gmail authorization is no longer valid."));

    await expect(monitorInboxResponses(701, { dependencies: mocks })).resolves.toMatchObject({
      providersScanned: 0,
      inboxReauthorizationRequired: 1,
      candidatesDiscovered: 0,
      monitoringFailures: 1,
      errors: ["gmail: inbox response monitoring failed"],
    });
    expect(mocks.listUserConnectorAccounts).toHaveBeenCalledTimes(2);
  });

  it("keeps a persisted inbox candidate visible when its audit write fails", async () => {
    const mocks = dependencies();
    mocks.createAuditEvent.mockRejectedValue(new Error("Audit ledger is unavailable."));

    await expect(monitorInboxResponses(701, { dependencies: mocks })).resolves.toEqual({
      providersScanned: 1,
      inboxReauthorizationRequired: 0,
      candidatesDiscovered: 1,
      monitoringFailures: 1,
      errors: ["gmail: unable to record inbox monitoring audit"],
    });
    expect(mocks.upsertInboxResponseCandidate).toHaveBeenCalledWith(expect.objectContaining({
      applicationId: 701,
      messageId: "message-701",
    }));
  });

  it("retains successfully persisted candidates when one candidate write fails", async () => {
    const mocks = dependencies();
    mocks.discoverInboxResponseCandidates.mockResolvedValue([
      candidate,
      { ...candidate, messageId: "message-702", applicationId: 702 },
    ]);
    mocks.upsertInboxResponseCandidate
      .mockResolvedValueOnce({ existing: false })
      .mockRejectedValueOnce(new Error("Candidate store is unavailable."));

    await expect(monitorInboxResponses(701, { dependencies: mocks })).resolves.toEqual({
      providersScanned: 1,
      inboxReauthorizationRequired: 0,
      candidatesDiscovered: 1,
      monitoringFailures: 1,
      errors: ["gmail: 1 inbox response candidate could not be persisted"],
    });
    expect(mocks.createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "inbox_response_monitoring_partial",
      riskLevel: "medium",
      afterState: expect.stringContaining('"persistenceFailures":1'),
    }));
  });

  it("does not persist or audit an intentionally cancelled inbox scan", async () => {
    const mocks = dependencies();
    const controller = new AbortController();
    mocks.discoverInboxResponseCandidates.mockImplementation(
      async (_userId: number, _provider: string, options: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => {
          options.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        throw new Error("cancelled");
      }
    );
    const monitoring = monitorInboxResponses(701, {
      dependencies: mocks,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(mocks.discoverInboxResponseCandidates).toHaveBeenCalledOnce());

    controller.abort();

    await expect(monitoring).resolves.toEqual({
      providersScanned: 0,
      inboxReauthorizationRequired: 0,
      candidatesDiscovered: 0,
      monitoringFailures: 0,
      errors: [],
    });
    expect(mocks.upsertInboxResponseCandidate).not.toHaveBeenCalled();
    expect(mocks.createAuditEvent).not.toHaveBeenCalled();
  });
});
