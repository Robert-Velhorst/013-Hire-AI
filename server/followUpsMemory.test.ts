import { describe, expect, it } from "vitest";
import {
  createFollowUp,
  generateEmployerReplyEmail,
  generateFollowUpEmail,
  getFollowUps,
  markFollowUpResponseReceived,
  markFollowUpSent,
  recordEmployerResponse,
} from "./applicationFeatures";
import {
  createApplication,
  createEmployerResponse,
  getAuditEventsForEntity,
  listUserApplicationApprovals,
  resolveApplicationApproval,
} from "./db";

describe("follow-up memory fallback", () => {
  it("creates approval-gated follow-up drafts and records send/response ledger events", async () => {
    const userId = 98101;
    const application = await createApplication({
      userId,
      jobId: 2,
      status: "applied",
      notes: "Applied and ready for follow-up.",
    });
    const applicationId = Number(application.insertId);

    const generated = await generateFollowUpEmail(applicationId, "status_check", userId);
    expect(generated).toContain("Frontend Engineer");

    const created = await createFollowUp({
      applicationId,
      message: generated,
    }, userId);

    await expect(markFollowUpSent(created.id, userId)).rejects.toThrow(
      "Follow-up approval is required before marking it sent."
    );

    const pendingApprovals = await listUserApplicationApprovals(userId, "pending");
    const approval = pendingApprovals.find((item) =>
      item.entityType === "follow_up" &&
      item.entityId === created.id &&
      item.approvalType === "follow_up_send"
    );
    expect(approval).toBeTruthy();
    expect(approval?.payload).toContain("Frontend Engineer");

    await resolveApplicationApproval(
      approval!.id,
      userId,
      "approved",
      "Approved follow-up draft after review.",
      "user"
    );
    await expect(markFollowUpSent(created.id, userId)).rejects.toThrow(
      "A delivery confirmation is required before marking a follow-up sent."
    );
    await markFollowUpSent(
      created.id,
      userId,
      "Sent through the candidate's recruiting email account after approval."
    );
    await markFollowUpResponseReceived(created.id, userId);

    const followUps = await getFollowUps(applicationId, userId);
    expect(followUps).toHaveLength(1);
    expect(followUps[0].sentDate).toBeInstanceOf(Date);
    expect(followUps[0].deliveryConfirmation).toContain("recruiting email account");
    expect(followUps[0].responseReceived).toBe(1);

    const auditEvents = await getAuditEventsForEntity(userId, "application", applicationId);
    expect(auditEvents.some((event) => event.action === "follow_up_draft_created")).toBe(true);
    expect(auditEvents.some((event) =>
      event.action === "follow_up_marked_sent" &&
      event.afterState?.includes("recruiting email account")
    )).toBe(true);
    expect(auditEvents.some((event) => event.action === "follow_up_response_marked_received")).toBe(true);
  });

  it("blocks follow-up drafts for applications without submission evidence status", async () => {
    const userId = 98102;
    const application = await createApplication({
      userId,
      jobId: 1,
      status: "pending",
      notes: "Prepared, not submitted.",
    });

    await expect(createFollowUp({
      applicationId: Number(application.insertId),
      message: "Checking in before submission.",
    }, userId)).rejects.toThrow("after an application has been submitted");
  });

  it("never lets a draft creation forge a sent follow-up", async () => {
    const userId = 98104;
    const application = await createApplication({
      userId,
      jobId: 4,
      status: "applied",
      notes: "Submitted application awaiting a controlled follow-up.",
    });
    const applicationId = Number(application.insertId);

    await expect(createFollowUp({
      applicationId,
      message: "Checking in on my submitted application.",
      sendDate: new Date(),
    } as any, userId)).rejects.toThrow("delivery cannot be recorded while creating a draft");

    expect(await getFollowUps(applicationId, userId)).toHaveLength(0);
  });

  it("creates employer question reply drafts with source response metadata and approval gates", async () => {
    const userId = 98103;
    const application = await createApplication({
      userId,
      jobId: 3,
      status: "applied",
      notes: "Submitted application received a recruiter question.",
    });
    const applicationId = Number(application.insertId);
    const response = await recordEmployerResponse({
      applicationId,
      responseType: "employer_question",
      source: "email",
      summary: "Recruiter asked for availability and clarification about distributed team collaboration.",
      receivedAt: new Date(),
    }, userId);

    const foreignResponse = await createEmployerResponse({
      applicationId,
      interviewId: null,
      userId: userId + 1,
      responseType: "employer_question",
      source: "email",
      sourceReference: "foreign-owner-response",
      summary: "A newer response belonging to another user.",
      receivedAt: new Date(Date.now() + 1_000),
      statusBefore: "applied",
      statusAfter: "applied",
      noteId: null,
    });

    const generated = await generateEmployerReplyEmail(applicationId, userId, response.responseId);
    const generatedFromLatestOwned = await generateEmployerReplyEmail(applicationId, userId);

    expect(generated.responseId).toBe(response.responseId);
    expect(generatedFromLatestOwned.responseId).toBe(response.responseId);
    expect(generated.email).toContain("Backend Python Developer");
    expect(generated.email).toContain("Add your exact answer here");
    await expect(
      generateEmployerReplyEmail(applicationId, userId, Number(foreignResponse.insertId))
    ).rejects.toThrow("Employer response not found.");

    const created = await createFollowUp({
      applicationId,
      message: generated.email,
      purpose: "employer_reply",
      sourceResponseId: generated.responseId,
    }, userId);

    const pendingApprovals = await listUserApplicationApprovals(userId, "pending");
    const approval = pendingApprovals.find((item) =>
      item.entityType === "follow_up" &&
      item.entityId === created.id &&
      item.approvalType === "follow_up_send"
    );
    expect(approval).toBeTruthy();
    expect(approval?.title).toContain("employer reply");
    expect(approval?.payload).toContain('"purpose":"employer_reply"');
    expect(approval?.payload).toContain(`"sourceResponseId":${response.responseId}`);

    const auditEvents = await getAuditEventsForEntity(userId, "application", applicationId);
    expect(auditEvents.some((event) =>
      event.action === "employer_reply_draft_created" &&
      event.afterState?.includes(`"sourceResponseId":${response.responseId}`)
    )).toBe(true);
  });
});
