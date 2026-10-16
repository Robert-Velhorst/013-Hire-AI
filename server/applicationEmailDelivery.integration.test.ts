import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  applicationApprovals,
  applicationAttempts,
  applicationEmailDeliveries,
  applicationMaterials,
  applications,
  auditEvents,
  jobPlatforms,
  jobs,
  userResumes,
  users,
} from "../drizzle/schema";
import { getDb, ensureScraperPlatformCatalog } from "./db";
import { uploadResume } from "./resumeStorage";
import {
  getApplicationEmailSubmission,
  prepareApplicationEmailSubmission,
  requestApplicationEmailApproval,
  resolveApplicationEmailApproval,
  sendApprovedApplicationEmail,
} from "./applicationEmailDelivery";
import { sendFollowUpProviderMessage } from "./followUpMailDelivery";
import { storageDelete, storageGet, storagePut } from "./storage";

const enabled = process.env.HIRE_AI_DATABASE_ACCEPTANCE === "true";

vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ key: "synthetic" }),
  storageDelete: vi.fn().mockResolvedValue({ key: "synthetic" }),
  storageGet: vi.fn().mockResolvedValue({ url: "https://storage.example.test/resume" }),
}));

vi.mock("./followUpMailDelivery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./followUpMailDelivery")>();
  return {
    ...actual,
    getAuthorizedMailAccess: vi.fn(async () => ({ accessToken: "synthetic-token", account: {} as never })),
    sendFollowUpProviderMessage: vi.fn(async () => ({
      messageId: "synthetic-provider-message",
      confirmation: "Synthetic provider accepted the test message.",
    })),
  };
});

vi.mock("./autonomousEvidence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./autonomousEvidence")>();
  return {
    ...actual,
    getAutonomousEvidenceContext: vi.fn(async () => ({ evidenceGates: [] } as never)),
  };
});

describe.skipIf(!enabled).sequential("application email delivery on isolated MySQL", () => {
  const marker = `application-email-${randomUUID()}`;
  const applicationIds: number[] = [];
  const jobIds: number[] = [];
  let database: NonNullable<Awaited<ReturnType<typeof getDb>>>;
  let userId = 0;
  let platformId = 0;

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL || "");
    if (url.pathname !== "/hire_ai_acceptance") {
      throw new Error("Acceptance writes require the dedicated hire_ai_acceptance database");
    }
    const db = await getDb();
    if (!db) throw new Error("MySQL is required; sample fallback is not acceptance");
    database = db;
    await ensureScraperPlatformCatalog();
    const platform = await database.select({ id: jobPlatforms.id }).from(jobPlatforms)
      .where(eq(jobPlatforms.name, "Himalayas")).limit(1);
    if (!platform[0]) throw new Error("The Himalayas platform fixture is unavailable");
    platformId = platform[0].id;
    const insertedUser = await database.insert(users).values({ openId: `${marker}-owner`, name: "Synthetic Application Owner" });
    userId = Number(insertedUser[0].insertId);
  }, 60000);

  afterAll(async () => {
    if (!database || !userId) return;
    try {
      if (applicationIds.length) {
        await database.delete(applicationMaterials).where(inArray(applicationMaterials.applicationId, applicationIds));
        await database.delete(applicationApprovals).where(and(
          eq(applicationApprovals.userId, userId),
          inArray(applicationApprovals.applicationId, applicationIds)
        ));
        await database.delete(applicationAttempts).where(inArray(applicationAttempts.applicationId, applicationIds));
        await database.delete(applicationEmailDeliveries).where(inArray(applicationEmailDeliveries.applicationId, applicationIds));
        await database.delete(auditEvents).where(and(
          eq(auditEvents.userId, userId),
          inArray(auditEvents.entityId, applicationIds)
        ));
        await database.delete(applications).where(inArray(applications.id, applicationIds));
      }
      await database.delete(userResumes).where(eq(userResumes.userId, userId));
      await database.delete(users).where(eq(users.id, userId));
      if (jobIds.length) await database.delete(jobs).where(inArray(jobs.id, jobIds));
    } finally {
      vi.unstubAllGlobals();
      vi.mocked(storageGet).mockReset();
      vi.mocked(storagePut).mockReset();
      vi.mocked(storageDelete).mockReset();
      vi.mocked(sendFollowUpProviderMessage).mockReset();
    }
  });

  async function createPendingApplication(suffix: string) {
    const insertedJob = await database.insert(jobs).values({
      title: "Synthetic Fully Remote Engineer",
      company: marker,
      location: "Worldwide - remote",
      description: "This is a fully remote position. Synthetic acceptance data only.",
      jobType: "full-time",
      applicationEmail: "jobs@example.test",
      platformId,
      externalId: `${marker}-${suffix}`,
      sourceUrl: `https://jobs.example.test/${marker}/${suffix}`,
      postedDate: new Date(),
      isActive: 1,
    });
    const jobId = Number(insertedJob[0].insertId);
    jobIds.push(jobId);
    const insertedApplication = await database.insert(applications).values({ userId, jobId, status: "pending" });
    const applicationId = Number(insertedApplication[0].insertId);
    applicationIds.push(applicationId);
    const resume = await uploadResume(userId, Buffer.from(`Synthetic resume ${suffix}`), `${suffix}.txt`, "text/plain");
    await database.insert(applicationMaterials).values({
      applicationId,
      resumeId: resume.id,
      coverLetter: `Synthetic cover letter for ${suffix}.`,
    });
    return applicationId;
  }

  it("persists exact approval and provider-accepted submission as one application lifecycle", async () => {
    const applicationId = await createPendingApplication("accepted");
    const resumeBytes = Buffer.from("Synthetic resume accepted");
    vi.mocked(storageGet).mockResolvedValue({ url: "https://storage.example.test/resume" } as Awaited<ReturnType<typeof storageGet>>);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(resumeBytes, { status: 200 })));
    vi.mocked(sendFollowUpProviderMessage).mockResolvedValue({
      messageId: "synthetic-provider-message",
      confirmation: "Synthetic provider accepted the test message.",
    });

    await expect(prepareApplicationEmailSubmission(userId, applicationId, "gmail"))
      .resolves.toMatchObject({ status: "draft", recipient: "jobs@example.test", resumeFileName: "accepted.txt" });
    const requested = await requestApplicationEmailApproval(userId, applicationId);
    expect(requested.status).toBe("pending_approval");
    await expect(resolveApplicationEmailApproval(userId, requested.approvalId, "approved"))
      .resolves.toMatchObject({ success: true, status: "approved" });
    await expect(sendApprovedApplicationEmail(userId, applicationId))
      .resolves.toMatchObject({ success: true, provider: "gmail", providerMessageId: "synthetic-provider-message" });
    await expect(getApplicationEmailSubmission(userId, applicationId)).resolves.toMatchObject({ status: "sent" });

    const application = await database.select({ status: applications.status }).from(applications)
      .where(eq(applications.id, applicationId)).limit(1);
    expect(application[0]?.status).toBe("applied");
    const attempts = await database.select().from(applicationAttempts)
      .where(eq(applicationAttempts.applicationId, applicationId));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.confirmationText).toContain("Delivery to the recipient is not guaranteed");
    const events = await database.select({ action: auditEvents.action }).from(auditEvents)
      .where(and(eq(auditEvents.userId, userId), eq(auditEvents.entityId, applicationId)));
    expect(events.map((event) => event.action)).toContain("application_email_accepted_by_provider");
    expect(sendFollowUpProviderMessage).toHaveBeenCalledOnce();
    const sendCall = vi.mocked(sendFollowUpProviderMessage).mock.calls[0];
    expect(sendCall?.slice(0, 6)).toEqual([
      "gmail",
      "synthetic-token",
      "jobs@example.test",
      expect.any(String),
      "Synthetic cover letter for accepted.",
      expect.any(Function),
    ]);
    expect(sendCall?.[6]).toMatchObject({
      fileName: "accepted.txt",
      mimeType: "text/plain",
      bytes: expect.any(Uint8Array),
    });
    expect(Buffer.from(sendCall?.[6]?.bytes ?? new Uint8Array())).toEqual(resumeBytes);
  });

  it("does not send an approved application email after the account is suspended", async () => {
    const applicationId = await createPendingApplication("suspended-owner");
    const resumeBytes = Buffer.from("Synthetic resume suspended owner");
    vi.mocked(storageGet).mockResolvedValue({ url: "https://storage.example.test/resume" } as Awaited<ReturnType<typeof storageGet>>);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(resumeBytes, { status: 200 })));
    vi.mocked(sendFollowUpProviderMessage).mockClear();

    await prepareApplicationEmailSubmission(userId, applicationId, "gmail");
    const requested = await requestApplicationEmailApproval(userId, applicationId);
    await resolveApplicationEmailApproval(userId, requested.approvalId, "approved");
    await database.update(users).set({ accountStatus: "suspended" }).where(eq(users.id, userId));

    try {
      await expect(sendApprovedApplicationEmail(userId, applicationId))
        .rejects.toThrow("active account is required");
      expect(sendFollowUpProviderMessage).not.toHaveBeenCalled();
      await expect(getApplicationEmailSubmission(userId, applicationId)).resolves.toMatchObject({ status: "ready" });
    } finally {
      await database.update(users).set({ accountStatus: "active" }).where(eq(users.id, userId));
    }
  });

  it("allows cancelling a pending approval after its resume record is deleted", async () => {
    const applicationId = await createPendingApplication("cancel-after-resume-delete");
    const resumeBytes = Buffer.from("Synthetic resume cancel-after-resume-delete");
    vi.mocked(storageGet).mockResolvedValue({ url: "https://storage.example.test/resume" } as Awaited<ReturnType<typeof storageGet>>);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(resumeBytes, { status: 200 })));
    vi.mocked(sendFollowUpProviderMessage).mockClear();

    await prepareApplicationEmailSubmission(userId, applicationId, "gmail");
    const requested = await requestApplicationEmailApproval(userId, applicationId);
    const delivery = await database.select({ resumeId: applicationEmailDeliveries.resumeId })
      .from(applicationEmailDeliveries)
      .where(eq(applicationEmailDeliveries.applicationId, applicationId))
      .limit(1);
    expect(delivery[0]?.resumeId).toBeTruthy();
    await database.delete(userResumes).where(eq(userResumes.id, delivery[0]!.resumeId));

    await expect(resolveApplicationEmailApproval(userId, requested.approvalId, "cancelled", "Resume removed by candidate"))
      .resolves.toMatchObject({ success: true, status: "cancelled" });
    await expect(getApplicationEmailSubmission(userId, applicationId)).resolves.toMatchObject({ status: "cancelled" });
    expect(sendFollowUpProviderMessage).not.toHaveBeenCalled();
  });

  it("blocks retries when the provider outcome is uncertain", async () => {
    const applicationId = await createPendingApplication("uncertain");
    const resumeBytes = Buffer.from("Synthetic resume uncertain");
    vi.mocked(storageGet).mockResolvedValue({ url: "https://storage.example.test/resume" } as Awaited<ReturnType<typeof storageGet>>);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(resumeBytes, { status: 200 })));
    vi.mocked(sendFollowUpProviderMessage).mockRejectedValueOnce(new TypeError("synthetic connection reset"));

    await prepareApplicationEmailSubmission(userId, applicationId, "outlook");
    const requested = await requestApplicationEmailApproval(userId, applicationId);
    await resolveApplicationEmailApproval(userId, requested.approvalId, "approved");
    await expect(sendApprovedApplicationEmail(userId, applicationId)).rejects.toThrow("outcome is uncertain");
    await expect(getApplicationEmailSubmission(userId, applicationId)).resolves.toMatchObject({ status: "unknown" });
    await expect(sendApprovedApplicationEmail(userId, applicationId)).rejects.toThrow("outcome is uncertain");
    expect(sendFollowUpProviderMessage).toHaveBeenCalledOnce();
  });

  it("recovers a crashed send reservation as unknown without allowing a retry", async () => {
    const applicationId = await createPendingApplication("stale-send");
    const resumeBytes = Buffer.from("Synthetic resume stale send");
    vi.mocked(storageGet).mockResolvedValue({ url: "https://storage.example.test/resume" } as Awaited<ReturnType<typeof storageGet>>);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(resumeBytes, { status: 200 })));

    await prepareApplicationEmailSubmission(userId, applicationId, "gmail");
    const requested = await requestApplicationEmailApproval(userId, applicationId);
    await resolveApplicationEmailApproval(userId, requested.approvalId, "approved");
    await database.update(applicationEmailDeliveries).set({
      status: "sending",
      attemptKey: randomUUID(),
      attemptCount: 1,
      updatedAt: new Date(Date.now() - 10 * 60 * 1000),
    }).where(eq(applicationEmailDeliveries.applicationId, applicationId));
    vi.mocked(sendFollowUpProviderMessage).mockClear();

    await expect(getApplicationEmailSubmission(userId, applicationId)).resolves.toMatchObject({
      status: "unknown",
      failureMessage: expect.stringContaining("Do not retry"),
    });
    await expect(sendApprovedApplicationEmail(userId, applicationId)).rejects.toThrow("outcome is uncertain");
    expect(sendFollowUpProviderMessage).not.toHaveBeenCalled();

    const events = await database.select({ action: auditEvents.action }).from(auditEvents)
      .where(and(eq(auditEvents.userId, userId), eq(auditEvents.entityId, applicationId)));
    expect(events.map((event) => event.action)).toContain("application_email_stale_send_marked_unknown");
  });
});
