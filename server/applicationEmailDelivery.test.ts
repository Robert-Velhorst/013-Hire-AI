import { describe, expect, it, vi } from "vitest";
import {
  applicationApprovals,
  applicationAttempts,
  applicationMaterials,
  applications,
  auditEvents,
  jobs,
  userResumes,
} from "../drizzle/schema";
import {
  ApplicationEmailDeliveryError,
  sendApprovedApplicationByEmail,
  type ApplicationEmailDeliveryDependencies,
} from "./applicationEmailDelivery";
import { FollowUpProviderRejectionError } from "./followUpMailDelivery";

const now = new Date("2026-10-14T12:00:00.000Z");

function fixture(
  overrides: {
    job?: Record<string, unknown>;
    attempts?: Array<Record<string, unknown>>;
    evidenceGates?: Array<Record<string, unknown>>;
    sendMessage?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const state = {
    application: {
      id: 41,
      userId: 7,
      jobId: 81,
      status: "pending",
      appliedDate: null,
      lastActivity: null,
    } as Record<string, unknown>,
    approval: {
      id: 51,
      userId: 7,
      applicationId: 41,
      entityType: "application",
      entityId: 41,
      approvalType: "application_submission",
      status: "approved",
      payload: JSON.stringify({ resumeId: 61, resumeVersion: 2 }),
      decidedAt: new Date(now.getTime() - 60_000),
    } as Record<string, unknown>,
    job: {
      id: 81,
      title: "Senior Software Engineer (Remote)",
      company: "Example Company",
      description: "Fully remote role, work from anywhere.",
      requirements: "TypeScript experience.",
      responsibilities: "Build reliable software.",
      benefits: "Health insurance.",
      location: "Worldwide",
      applicationEmail: "careers@example.com",
      applicationUrl: null,
      platformId: 3,
      isActive: 1,
      postedDate: new Date(now.getTime() - 3_600_000),
      expiryDate: new Date(now.getTime() + 86_400_000),
      createdAt: new Date(now.getTime() - 3_600_000),
      updatedAt: new Date(now.getTime() - 3_600_000),
    } as Record<string, unknown>,
    material: {
      id: 71,
      applicationId: 41,
      resumeId: 61,
      coverLetter:
        "Hello, I am applying for this role based on my relevant experience.",
      customResume: null,
      customAnswers: null,
      claimsMade: null,
      sourceProfileSnapshot: null,
      createdAt: new Date(now.getTime() - 120_000),
      updatedAt: new Date(now.getTime() - 120_000),
    },
    resume: {
      id: 61,
      userId: 7,
      fileName: "resume.pdf",
      fileKey: "users/7/resumes/resume.pdf",
      fileSize: 128,
      mimeType: "application/pdf",
      version: 2,
    },
    attempts: [...(overrides.attempts ?? [])] as Array<Record<string, unknown>>,
    audit: [] as Array<Record<string, unknown>>,
    nextAttemptId: 91,
  };
  Object.assign(state.job, overrides.job ?? {});

  const rowsFor = (table: unknown) => {
    if (table === applicationApprovals) return [state.approval];
    if (table === applications) return [state.application];
    if (table === jobs) return [state.job];
    if (table === applicationMaterials) return [state.material];
    if (table === userResumes) return [state.resume];
    if (table === applicationAttempts)
      return [...state.attempts].sort((a, b) => Number(b.id) - Number(a.id));
    return [];
  };

  const createQuery = () => {
    let table: unknown;
    const query = {
      from(value: unknown) {
        table = value;
        return query;
      },
      where() {
        return query;
      },
      limit() {
        return query;
      },
      orderBy() {
        return query;
      },
      for() {
        return query;
      },
      then(
        resolve: (value: unknown[]) => unknown,
        reject: (reason: unknown) => unknown
      ) {
        return Promise.resolve(rowsFor(table)).then(resolve, reject);
      },
    };
    return query;
  };

  const tx = {
    select: createQuery,
    insert(table: unknown) {
      return {
        async values(value: Record<string, unknown>) {
          if (table === applicationAttempts) {
            const row = { ...value, id: state.nextAttemptId++ };
            state.attempts.push(row);
            return [{ insertId: row.id }];
          }
          if (table === auditEvents) state.audit.push(value);
          return [{ insertId: 1 }];
        },
      };
    },
    update(table: unknown) {
      return {
        set(value: Record<string, unknown>) {
          return {
            async where() {
              if (table === applicationAttempts) {
                const row = [...state.attempts]
                  .reverse()
                  .find(item => item.status === "prepared");
                if (!row) return [{ affectedRows: 0 }];
                Object.assign(row, value);
              } else if (table === applications) {
                Object.assign(state.application, value);
              }
              return [{ affectedRows: 1 }];
            },
          };
        },
      };
    },
  };
  const db = {
    select: createQuery,
    insert: tx.insert,
    transaction: async (run: (transaction: typeof tx) => Promise<unknown>) =>
      run(tx),
  };

  const sendMessage =
    overrides.sendMessage ??
    vi.fn(async () => ({
      messageId: "provider-message-1",
      confirmation:
        "Gmail accepted the approved message with ID provider-message-1.",
    }));
  const dependencies: ApplicationEmailDeliveryDependencies = {
    getDb: vi.fn(async () => db as never),
    getEvidenceContext: vi.fn(
      async () =>
        ({ evidenceGates: (overrides.evidenceGates ?? []) as never[] }) as never
    ),
    getMailAccess: vi.fn(async () => ({
      accessToken: "mock-access-token",
      account: {} as never,
    })),
    markProviderNeedsReauth: vi.fn(async () => undefined),
    sendMessage: sendMessage as never,
    getResumeAttachment: vi.fn(async () => ({
      fileName: "resume.pdf",
      mimeType: "application/pdf",
      data: Buffer.from("%PDF-mock"),
    })),
  };
  return { state, dependencies, sendMessage };
}

describe("approved application email delivery", () => {
  it("sends only the reviewed employer email with the linked resume and atomically records submission", async () => {
    const { state, dependencies, sendMessage } = fixture();
    const result = await sendApprovedApplicationByEmail(
      { approvalId: 51, userId: 7, provider: "gmail" },
      { now, dependencies }
    );

    expect(result).toMatchObject({
      success: true,
      existing: false,
      applicationId: 41,
      provider: "gmail",
    });
    expect(sendMessage).toHaveBeenCalledWith(
      "gmail",
      "mock-access-token",
      "careers@example.com",
      "Application: Senior Software Engineer (Remote) at Example Company",
      state.material.coverLetter,
      fetch,
      [
        expect.objectContaining({
          fileName: "resume.pdf",
          mimeType: "application/pdf",
        }),
      ],
      "application"
    );
    expect(state.application).toMatchObject({
      status: "applied",
      appliedDate: now,
    });
    expect(state.attempts.at(-1)).toMatchObject({
      status: "submitted",
      attemptType: "external_handoff",
    });
    expect(state.audit.map(event => event.approvalId)).toEqual([51, 51]);
  });

  it("blocks a second send after an ambiguous provider outcome", async () => {
    const sender = vi
      .fn()
      .mockRejectedValue(new Error("connection reset after request"));
    const { state, dependencies } = fixture({ sendMessage: sender });
    const input = { approvalId: 51, userId: 7, provider: "gmail" as const };

    await expect(
      sendApprovedApplicationByEmail(input, { now, dependencies })
    ).rejects.toBeInstanceOf(ApplicationEmailDeliveryError);
    expect(state.attempts.at(-1)).toMatchObject({
      status: "prepared",
      confirmationText: expect.stringContaining("outcome uncertain"),
    });
    await expect(
      sendApprovedApplicationByEmail(input, { now, dependencies })
    ).rejects.toThrow(/automatic retry is blocked/i);
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it("records authoritative provider rejection as failed and never marks the application submitted", async () => {
    const sender = vi
      .fn()
      .mockRejectedValue(
        new FollowUpProviderRejectionError(
          "Gmail rejected the application delivery (403)."
        )
      );
    const { state, dependencies } = fixture({ sendMessage: sender });

    await expect(
      sendApprovedApplicationByEmail(
        { approvalId: 51, userId: 7, provider: "gmail" },
        { now, dependencies }
      )
    ).rejects.toThrow("Gmail rejected the application email (403).");

    expect(state.attempts.at(-1)).toMatchObject({ status: "failed" });
    expect(state.application).toMatchObject({
      status: "pending",
      appliedDate: null,
    });
    expect(state.audit.at(-1)).toMatchObject({
      action: "application_email_delivery_failed",
      approvalId: 51,
    });
  });

  it("marks the mailbox connection for reauthorization after an authoritative token rejection", async () => {
    const sender = vi
      .fn()
      .mockRejectedValue(
        new FollowUpProviderRejectionError(
          "Gmail rejected the application delivery (401).",
          true
        )
      );
    const { state, dependencies } = fixture({ sendMessage: sender });

    await expect(
      sendApprovedApplicationByEmail(
        { approvalId: 51, userId: 7, provider: "gmail" },
        { now, dependencies }
      )
    ).rejects.toThrow("Gmail rejected the application email (401).");

    expect(dependencies.markProviderNeedsReauth).toHaveBeenCalledWith(
      7,
      expect.anything()
    );
    expect(state.attempts.at(-1)).toMatchObject({ status: "failed" });
  });

  it.each([
    [
      "hybrid role",
      { title: "Software Engineer (Hybrid)", location: "Hybrid" },
    ],
    ["employer portal", { applicationUrl: "https://example.com/apply" }],
    ["consumer email destination", { applicationEmail: "recruiter@gmail.com" }],
    [
      "unsafe listing",
      { description: "Pay a deposit before starting work. Fully remote." },
    ],
  ])("does not send to a %s", async (_name, job) => {
    const { state, dependencies, sendMessage } = fixture({ job });

    await expect(
      sendApprovedApplicationByEmail(
        { approvalId: 51, userId: 7, provider: "gmail" },
        { now, dependencies }
      )
    ).rejects.toBeInstanceOf(ApplicationEmailDeliveryError);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(state.attempts).toHaveLength(0);
    expect(state.audit.at(-1)).toMatchObject({
      action: "application_email_delivery_blocked",
      approvalId: 51,
      afterState: expect.stringContaining(
        '"externalSubmissionPerformed":false'
      ),
    });
  });

  it("requires current profile evidence gates to be clear before mailbox authorization or sending", async () => {
    const { dependencies, sendMessage } = fixture({
      evidenceGates: [
        {
          id: "profile-core-evidence",
          blocks: ["external_application_submission"],
        },
      ],
    });

    await expect(
      sendApprovedApplicationByEmail(
        { approvalId: 51, userId: 7, provider: "gmail" },
        { now, dependencies }
      )
    ).rejects.toThrow(/profile evidence gates/i);

    expect(dependencies.getMailAccess).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("rechecks application state after mailbox preparation and cancels stale sends", async () => {
    const { state, dependencies, sendMessage } = fixture();
    dependencies.getMailAccess = vi.fn(async () => {
      state.application.status = "withdrawn";
      return { accessToken: "mock-access-token", account: {} as never };
    });

    await expect(
      sendApprovedApplicationByEmail(
        { approvalId: 51, userId: 7, provider: "gmail" },
        { now, dependencies }
      )
    ).rejects.toThrow(/application or its approval changed/i);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(state.attempts.at(-1)).toMatchObject({ status: "failed" });
  });

  it("returns the prior confirmed submission idempotently without a provider call", async () => {
    const { state, dependencies, sendMessage } = fixture({
      attempts: [
        {
          id: 90,
          applicationId: 41,
          userId: 7,
          attemptType: "external_handoff",
          status: "submitted",
          confirmationText: "Hire.AI email application delivery: confirmed",
        },
      ],
    });

    await expect(
      sendApprovedApplicationByEmail(
        { approvalId: 51, userId: 7, provider: "gmail" },
        { now, dependencies }
      )
    ).resolves.toMatchObject({
      success: true,
      existing: true,
      applicationId: 41,
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(state.attempts).toHaveLength(1);
  });
});
