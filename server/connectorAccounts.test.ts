import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { createApplication, getAuditEventsForUser, getEmployerResponses, listPendingInboxResponseCandidates, listUnreadInterviewNotifications, listUserConnectorAccounts, upsertInboxResponseCandidate, upsertUserConnectorAccount, upsertUserProfile } from "./db";
import { appRouter } from "./routers";

function createContext(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `connector-account-${userId}`,
      name: "Connector Account User",
      email: `connector-account-${userId}@example.local`,
      loginMethod: "test",
      role: "user",
      stripeCustomerId: null,
      accountStatus: "active",
      tosAcceptedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("connector account tRPC procedures", () => {
  it("ingests a connected inbox response once and records connector provenance", async () => {
    const userId = 99652;
    const application = await createApplication({
      userId,
      jobId: 2,
      status: "applied",
      notes: "Submitted application awaiting an email response.",
    });
    const applicationId = Number(application.insertId);
    await upsertUserConnectorAccount({
      userId,
      provider: "gmail",
      status: "connected",
      consentScopes: JSON.stringify(["email.metadata.read", "email.messages.read_recruiting"]),
      externalAccountLabel: "candidate@example.com",
      lastVerifiedAt: new Date(),
    });

    const receivedAt = new Date(Date.now() - 60_000);
    const candidate = await upsertInboxResponseCandidate({
      userId,
      applicationId,
      provider: "gmail",
      messageId: "gmail-message-99652",
      sender: "recruiter@example.com",
      subject: "First interview invitation",
      preview: "Recruiter invited the candidate to a first interview next week.",
      receivedAt,
      suggestedResponseType: "interview_invite",
      confidence: "high",
    });
    const caller = appRouter.createCaller(createContext(userId));
    const input = {
      candidateId: candidate.candidate.id,
      responseType: "interview_invite" as const,
    };
    const first = await caller.applications.ingestInboxResponse(input);
    const second = await caller.applications.ingestInboxResponse(input);

    expect(first.existing).toBe(false);
    expect(second.existing).toBe(true);
    const responses = await getEmployerResponses(applicationId, userId);
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({
      summary: expect.stringContaining("Recruiter invited the candidate to a first interview"),
      receivedAt,
    });
    expect((await getAuditEventsForUser(userId, 20)).filter((event) => event.action === "inbox_response_ingested")).toHaveLength(1);
  });

  it("consumes a persisted inbox candidate only after the user confirms its classification", async () => {
    const userId = 99657;
    const application = await createApplication({
      userId,
      jobId: 3,
      status: "applied",
      notes: "Awaiting an application-linked inbox response.",
    });
    const applicationId = Number(application.insertId);
    await upsertUserConnectorAccount({
      userId,
      provider: "outlook",
      status: "connected",
      consentScopes: JSON.stringify(["mail.messages.read_recruiting"]),
      externalAccountLabel: "candidate@example.com",
      lastVerifiedAt: new Date(),
    });
    const receivedAt = new Date(Date.now() - 60_000);
    const candidate = await upsertInboxResponseCandidate({
      userId,
      applicationId,
      provider: "outlook",
      messageId: "outlook-candidate-99657",
      sender: "recruiter@example.com",
      subject: "Interview invitation",
      preview: "We would like to arrange a conversation about your application.",
      receivedAt,
      suggestedResponseType: "interview_invite",
      confidence: "high",
    });

    const caller = appRouter.createCaller(createContext(userId));
    await expect(caller.applications.getInboxResponseCandidatePage({ limit: 25 })).resolves.toMatchObject({
      total: 1,
      hasMore: false,
      items: [expect.objectContaining({ id: candidate.candidate.id })],
    });
    expect(await listUnreadInterviewNotifications(userId)).toHaveLength(0);

    await caller.applications.ingestInboxResponse({
      candidateId: candidate.candidate.id,
      responseType: "interview_invite",
    });

    expect(await listPendingInboxResponseCandidates(userId)).toEqual([]);
    const responses = await getEmployerResponses(applicationId, userId);
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({
      summary: expect.stringContaining("We would like to arrange a conversation"),
      receivedAt,
    });
    expect(await listUnreadInterviewNotifications(userId)).toHaveLength(1);
  });

  it("records connector intent, feeds evidence readiness, and audits without tokens", async () => {
    const userId = 99651;
    await upsertUserProfile({
      userId,
      skills: "TypeScript, React, Node.js",
      experience: "Built remote SaaS products for five years.",
      education: "BSc Computer Science",
      desiredJobTypes: "Full Stack Engineer",
      desiredLocations: "Remote",
      salaryExpectationMin: 90000,
      salaryExpectationMax: 140000,
      resumeFileKey: "resumes/99651/resume.pdf",
      linkedinUrl: "https://linkedin.com/in/connector-example",
      githubUrl: "https://github.com/connector-example",
      portfolioUrl: "https://connector.example.com",
    });

    const caller = appRouter.createCaller(createContext(userId));
    const requestResult = await caller.connectors.requestConnection({
      provider: "gmail",
    });

    expect(requestResult.success).toBe(true);
    expect(requestResult.requiresOAuth).toBe(true);
    expect(requestResult.account.status).toBe("connection_requested");
    expect(requestResult.account.provider).toBe("gmail");
    expect(JSON.stringify(requestResult)).not.toContain("accessToken");

    const linkedInRequest = await caller.connectors.requestConnection({
      provider: "linkedin",
    });
    expect(linkedInRequest.account.provider).toBe("linkedin");
    expect(linkedInRequest.account.status).toBe("connection_requested");

    const summary = await caller.profile.getEvidenceReadiness();
    const gmail = summary.providers.find((provider) => provider.id === "gmail");
    const linkedIn = summary.providers.find((provider) => provider.id === "linkedin");
    expect(gmail?.status).toBe("consent_required");
    expect(gmail?.connectionStatus).toBe("connection_requested");
    expect(gmail?.consentScopes).toContain("email.messages.read_recruiting");
    expect(linkedIn?.status).toBe("connected");
    expect(linkedIn?.connectionStatus).toBe("connection_requested");
    expect(linkedIn?.consentScopes).toContain("profile.basic.read");

    const auditEvents = await caller.audit.getForEntity({
      entityType: "user",
      entityId: userId,
    });
    expect(auditEvents.some((event) => event.action === "connector_connection_requested")).toBe(true);
    expect(auditEvents.filter((event) => event.action === "connector_connection_requested")).toHaveLength(2);
    expect(JSON.stringify(auditEvents)).not.toContain("accessToken");

    const disconnectResult = await caller.connectors.disconnect({
      provider: "gmail",
    });
    expect(disconnectResult.success).toBe(true);
    expect(disconnectResult.account.status).toBe("disabled");
    expect(disconnectResult.providerRevocation).toEqual({
      status: "not_needed",
      detail: "No stored OAuth grant was present.",
    });
  });

  it("allows the explicit follow-up send scope but rejects scopes outside Hire.AI's inventory", async () => {
    const userId = 99653;
    const caller = appRouter.createCaller(createContext(userId));

    const result = await caller.connectors.requestConnection({
      provider: "gmail",
      consentScopes: [
        "email.metadata.read",
        "email.messages.read_recruiting",
        "email.messages.send",
      ],
    });
    expect(result.account.consentScopes).toContain("email.messages.send");

    const baseline = await caller.connectors.requestConnection({ provider: "outlook" });
    expect(JSON.parse(baseline.account.consentScopes || "[]")).toEqual([
      "mail.metadata.read",
      "mail.messages.read_recruiting",
    ]);

    await expect(caller.connectors.requestConnection({
      provider: "gmail",
      consentScopes: ["mail.send.everything"],
    })).rejects.toThrow(/not permitted/i);
  });

  it("fails closed when a deployment has not provisioned OAuth credentials", async () => {
    const userId = 99656;
    const caller = appRouter.createCaller(createContext(userId));

    await expect(caller.connectors.startOAuth({ provider: "gmail" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "gmail OAuth is not configured for this deployment.",
    });

    expect(await listUserConnectorAccounts(userId)).toHaveLength(0);
    expect((await getAuditEventsForUser(userId, 10)).some((event) =>
      event.action === "connector_oauth_started"
    )).toBe(false);
  });

  it("requires renewed connector verification before stale inbox evidence is ingested", async () => {
    const userId = 99654;
    const application = await createApplication({
      userId,
      jobId: 1,
      status: "applied",
      notes: "Application awaiting an inbox response from an old connection.",
    });
    await upsertUserConnectorAccount({
      userId,
      provider: "gmail",
      status: "connected",
      consentScopes: JSON.stringify(["email.metadata.read", "email.messages.read_recruiting"]),
      externalAccountLabel: "candidate@example.com",
      lastVerifiedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    });
    const candidate = await upsertInboxResponseCandidate({
      userId,
      applicationId: Number(application.insertId),
      provider: "gmail",
      messageId: "gmail-stale-99654",
      sender: "recruiter@example.com",
      subject: "Interview invitation",
      preview: "Recruiter invited the candidate to an interview through a stale connection.",
      receivedAt: new Date(),
      suggestedResponseType: "interview_invite",
      confidence: "high",
    });

    const caller = appRouter.createCaller(createContext(userId));
    await expect(caller.applications.ingestInboxResponse({
      candidateId: candidate.candidate.id,
      responseType: "interview_invite",
    })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Gmail must be currently verified with recruiting-message read consent before inbox responses can be ingested.",
    });

    const summary = await caller.profile.getEvidenceReadiness();
    expect(summary.providers.find((provider) => provider.id === "gmail")).toMatchObject({
      status: "consent_required",
      connectionStatus: "needs_reauth",
      authorizationStale: true,
    });
    expect(await getEmployerResponses(Number(application.insertId), userId)).toHaveLength(0);
  });

  it("treats a connected account without verification evidence as needing reauthorization", async () => {
    const userId = 99655;
    const application = await createApplication({
      userId,
      jobId: 1,
      status: "applied",
      notes: "Application awaiting a response from an unverified legacy connection.",
    });
    await upsertUserConnectorAccount({
      userId,
      provider: "gmail",
      status: "connected",
      consentScopes: JSON.stringify(["email.metadata.read", "email.messages.read_recruiting"]),
      externalAccountLabel: "candidate@example.com",
      lastVerifiedAt: null,
    });
    const candidate = await upsertInboxResponseCandidate({
      userId,
      applicationId: Number(application.insertId),
      provider: "gmail",
      messageId: "gmail-unverified-99655",
      sender: "recruiter@example.com",
      subject: "Interview invitation",
      preview: "Recruiter invited the candidate to an interview through an unverified connection.",
      receivedAt: new Date(),
      suggestedResponseType: "interview_invite",
      confidence: "high",
    });

    const caller = appRouter.createCaller(createContext(userId));
    await expect(caller.applications.ingestInboxResponse({
      candidateId: candidate.candidate.id,
      responseType: "interview_invite",
    })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Gmail must be currently verified with recruiting-message read consent before inbox responses can be ingested.",
    });

    const summary = await caller.profile.getEvidenceReadiness();
    expect(summary.providers.find((provider) => provider.id === "gmail")).toMatchObject({
      status: "consent_required",
      connectionStatus: "needs_reauth",
      authorizationStale: true,
    });
    expect(await getEmployerResponses(Number(application.insertId), userId)).toHaveLength(0);
  });

  it("rejects unrecorded or dismissed inbox evidence instead of accepting client-supplied message data", async () => {
    const userId = 99658;
    const application = await createApplication({
      userId,
      jobId: 4,
      status: "applied",
      notes: "Awaiting a consented recruiter reply.",
    });
    const applicationId = Number(application.insertId);
    await upsertUserConnectorAccount({
      userId,
      provider: "gmail",
      status: "connected",
      consentScopes: JSON.stringify(["email.metadata.read", "email.messages.read_recruiting"]),
      externalAccountLabel: "candidate@example.com",
      lastVerifiedAt: new Date(),
    });
    const caller = appRouter.createCaller(createContext(userId));

    await expect(caller.applications.ingestInboxResponse({
      candidateId: 9_965_800,
      responseType: "interview_invite",
    })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const candidate = await upsertInboxResponseCandidate({
      userId,
      applicationId,
      provider: "gmail",
      messageId: "gmail-dismissed-99658",
      sender: "recruiter@example.com",
      subject: "Interview invitation",
      preview: "Please choose a time for an interview next week.",
      receivedAt: new Date(),
      suggestedResponseType: "interview_invite",
      confidence: "high",
    });
    await caller.applications.dismissInboxResponseCandidate({ candidateId: candidate.candidate.id });

    await expect(caller.applications.ingestInboxResponse({
      candidateId: candidate.candidate.id,
      responseType: "interview_invite",
    })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "A dismissed inbox response candidate cannot be confirmed. Run discovery again if the message needs review.",
    });
    expect(await getEmployerResponses(applicationId, userId)).toHaveLength(0);
  });
});
