import { beforeEach, describe, expect, it, vi } from "vitest";

const failure = vi.hoisted(() => ({ action: null as string | null }));

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    createAuditEvent: vi.fn(
      async (event: Parameters<typeof actual.createAuditEvent>[0]) => {
        if (failure.action === event.action) {
          failure.action = null;
          throw new Error(`Injected memory audit failure: ${event.action}`);
        }
        return actual.createAuditEvent(event);
      }
    ),
  };
});

import {
  getInterviewSchedules,
  recordEmployerResponse,
  recordInterviewOutcome,
  rescheduleInterview,
  scheduleInterview,
} from "./applicationFeatures";
import {
  createApplication,
  getApplicationLedgerArtifacts,
  getUserApplications,
  listUserApplicationApprovals,
} from "./db";

let nextUserId = 98300;

async function makeInterview() {
  const userId = nextUserId++;
  const application = await createApplication({
    userId,
    jobId: 2,
    status: "applied",
    notes: "Memory atomicity integration fixture.",
  });
  const applicationId = Number(application.insertId);
  await recordEmployerResponse(
    {
      applicationId,
      responseType: "interview_invite",
      source: "email",
      sourceReference: `memory-atomicity-invite-${applicationId}`,
      summary: "Recruiter invited the candidate to a video interview.",
    },
    userId
  );
  const scheduled = await scheduleInterview(
    {
      applicationId,
      interviewType: "video",
      scheduledAt: new Date(Date.now() + 3 * 86_400_000),
    },
    userId
  );
  return { userId, applicationId, interviewId: scheduled.id };
}

describe("interview lifecycle memory atomicity", () => {
  beforeEach(() => {
    failure.action = null;
  });

  it("rolls back interview, application, response, and audit state when outcome persistence fails", async () => {
    const fixture = await makeInterview();
    const input = {
      interviewId: fixture.interviewId,
      outcome: "rejection" as const,
      source: "email" as const,
      summary: "Recruiter confirmed that another candidate was selected.",
    };
    failure.action = "interview_outcome_recorded";

    await expect(recordInterviewOutcome(input, fixture.userId)).rejects.toThrow(
      "Injected memory audit failure"
    );

    expect(
      (await getInterviewSchedules(fixture.applicationId, fixture.userId))[0]
        .status
    ).toBe("scheduled");
    expect(
      (await getUserApplications(fixture.userId)).find(
        item => item.id === fixture.applicationId
      )?.status
    ).toBe("interview");
    expect(
      (
        await getApplicationLedgerArtifacts(
          fixture.applicationId,
          fixture.userId
        )
      ).employerResponses
    ).toHaveLength(1);
    const events = (
      await getApplicationLedgerArtifacts(fixture.applicationId, fixture.userId)
    ).auditEvents;
    expect(
      events.filter(event => event.action === "employer_response_recorded")
    ).toHaveLength(1);
    expect(
      events.some(
        event =>
          event.action === "interview_status_updated" &&
          event.afterState?.includes("completed")
      )
    ).toBe(false);
    expect(
      events.some(event => event.action === "interview_outcome_recorded")
    ).toBe(false);

    const outcome = await recordInterviewOutcome(input, fixture.userId);
    expect(outcome.status).toBe("rejected");
  });

  it("rolls back schedule, application activity, approval, and audit state when rescheduling fails", async () => {
    const fixture = await makeInterview();
    const interviewBefore = (
      await getInterviewSchedules(fixture.applicationId, fixture.userId)
    )[0];
    const applicationBefore = (await getUserApplications(fixture.userId)).find(
      item => item.id === fixture.applicationId
    )!;
    const approvalsBefore = await listUserApplicationApprovals(
      fixture.userId,
      "all"
    );
    const nextDate = new Date(Date.now() + 5 * 86_400_000);
    failure.action = "interview_rescheduled";

    await expect(
      rescheduleInterview(fixture.interviewId, nextDate, fixture.userId)
    ).rejects.toThrow("Injected memory audit failure");

    const interviewAfter = (
      await getInterviewSchedules(fixture.applicationId, fixture.userId)
    )[0];
    const applicationAfter = (await getUserApplications(fixture.userId)).find(
      item => item.id === fixture.applicationId
    )!;
    const approvalsAfter = await listUserApplicationApprovals(
      fixture.userId,
      "all"
    );
    const events = (
      await getApplicationLedgerArtifacts(fixture.applicationId, fixture.userId)
    ).auditEvents;
    expect(interviewAfter.status).toBe(interviewBefore.status);
    expect(interviewAfter.scheduledAt.getTime()).toBe(
      interviewBefore.scheduledAt.getTime()
    );
    expect(applicationAfter.lastActivity?.getTime()).toBe(
      applicationBefore.lastActivity?.getTime()
    );
    expect(approvalsAfter).toHaveLength(approvalsBefore.length);
    expect(events.some(event => event.action === "interview_rescheduled")).toBe(
      false
    );

    const rescheduled = await rescheduleInterview(
      fixture.interviewId,
      nextDate,
      fixture.userId
    );
    const duplicate = await rescheduleInterview(
      fixture.interviewId,
      nextDate,
      fixture.userId
    );
    expect(duplicate.existing).toBe(true);
    expect(duplicate.approvalId).toBe(rescheduled.approvalId);
  });

  it("serializes concurrent memory outcome and reschedule requests", async () => {
    const fixture = await makeInterview();
    const nextDate = new Date(Date.now() + 6 * 86_400_000);
    const results = await Promise.allSettled([
      recordInterviewOutcome(
        {
          interviewId: fixture.interviewId,
          outcome: "rejection",
          source: "email",
          summary: "Recruiter confirmed that another candidate was selected.",
        },
        fixture.userId
      ),
      rescheduleInterview(fixture.interviewId, nextDate, fixture.userId),
    ]);

    expect(results.some(result => result.status === "fulfilled")).toBe(true);
    const interview = (
      await getInterviewSchedules(fixture.applicationId, fixture.userId)
    )[0];
    if (interview.status === "completed") {
      expect(
        (
          await getApplicationLedgerArtifacts(
            fixture.applicationId,
            fixture.userId
          )
        ).employerResponses
      ).toHaveLength(2);
    } else {
      expect(interview.status).toBe("rescheduled");
      expect(
        (await listUserApplicationApprovals(fixture.userId, "all")).some(
          item =>
            item.approvalType === "interview_schedule" &&
            item.status === "approved"
        )
      ).toBe(true);
    }
  });
});
