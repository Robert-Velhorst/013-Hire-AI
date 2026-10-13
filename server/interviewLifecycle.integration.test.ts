import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminReviewItems,
  applicationApprovals,
  applicationNotes,
  applicationNotifications,
  applications,
  auditEvents,
  employerResponses,
  interviewSchedules,
  jobPlatforms,
  jobs,
  users,
} from "../drizzle/schema";
import { closeDatabaseConnection, getDb } from "./db";
import {
  recordInterviewOutcome,
  rescheduleInterview,
} from "./applicationFeatures";

const enabled = process.env.HIRE_AI_DATABASE_ACCEPTANCE === "true";

describe
  .skipIf(!enabled)
  .sequential("interview lifecycle atomicity on isolated MySQL", () => {
    const marker = `interview-atomicity-${randomUUID()}`;
    const constraintNames: string[] = [];
    let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
    let userId = 0;
    let platformId = 0;
    const applicationIds: number[] = [];
    const interviewIds: number[] = [];
    const initialScheduledAt = new Date(
      Math.floor(Date.now() / 1000) * 1000 + 3 * 86_400_000
    );
    const initialActivity = new Date(
      Math.floor(Date.now() / 1000) * 1000 - 86_400_000
    );

    async function installAuditFailure(
      action: "interview_outcome_recorded" | "interview_rescheduled",
      applicationId: number
    ) {
      const name = `hire_ai_fail_${randomUUID().replaceAll("-", "")}`;
      constraintNames.push(name);
      await db.execute(
        sql.raw(
          `ALTER TABLE audit_events ADD CONSTRAINT \`${name}\` ` +
            `CHECK (NOT (entity_id = ${applicationId} AND action = '${action}'))`
        )
      );
    }

    async function removeAuditFailures() {
      while (constraintNames.length) {
        const name = constraintNames.pop()!;
        await db.execute(
          sql.raw(`ALTER TABLE audit_events DROP CHECK \`${name}\``)
        );
      }
    }

    beforeAll(async () => {
      const target = new URL(process.env.DATABASE_URL || "");
      if (target.pathname !== "/hire_ai_acceptance") {
        throw new Error(
          "Interview lifecycle acceptance requires the isolated hire_ai_acceptance database."
        );
      }
      const connection = await getDb();
      if (!connection)
        throw new Error(
          "MySQL is required; memory fallback is not integration acceptance."
        );
      db = connection;

      const platform = await db.insert(jobPlatforms).values({
        name: marker,
        url: "https://jobs.example.test",
        tier: "tier4",
      });
      platformId = Number(platform[0].insertId);
      const user = await db.insert(users).values({
        openId: marker,
        name: "Interview lifecycle acceptance user",
      });
      userId = Number(user[0].insertId);

      for (let index = 0; index < 3; index += 1) {
        const job = await db.insert(jobs).values({
          title: `Synthetic interview role ${index}`,
          company: marker,
          platformId,
        });
        const application = await db.insert(applications).values({
          userId,
          jobId: Number(job[0].insertId),
          status: "interview",
          appliedDate: initialActivity,
          lastActivity: initialActivity,
        });
        const applicationId = Number(application[0].insertId);
        applicationIds.push(applicationId);
        const invite = await db.insert(employerResponses).values({
          applicationId,
          userId,
          responseType: "interview_invite",
          source: "email",
          sourceReference: `${marker}-invite-${index}`,
          summary: "Recruiter invited the candidate to a video interview.",
          receivedAt: initialActivity,
          statusBefore: "applied",
          statusAfter: "interview",
          noteId: null,
        });
        await db.insert(applicationNotifications).values({
          userId,
          applicationId,
          employerResponseId: Number(invite[0].insertId),
          notificationType: "interview_invite",
        });
        const interview = await db.insert(interviewSchedules).values({
          applicationId,
          interviewType: "video",
          scheduledAt: initialScheduledAt,
          status: "scheduled",
        });
        interviewIds.push(Number(interview[0].insertId));
      }
    }, 30000);

    afterAll(async () => {
      try {
        if (!db) return;
        await removeAuditFailures();
        if (applicationIds.length) {
          await db
            .delete(adminReviewItems)
            .where(
              and(
                eq(adminReviewItems.userId, userId),
                eq(adminReviewItems.entityType, "application"),
                inArray(adminReviewItems.entityId, applicationIds)
              )
            );
          await db
            .delete(applicationApprovals)
            .where(inArray(applicationApprovals.applicationId, applicationIds));
          await db
            .delete(auditEvents)
            .where(
              and(
                eq(auditEvents.entityType, "application"),
                inArray(auditEvents.entityId, applicationIds)
              )
            );
          await db
            .delete(applicationNotes)
            .where(inArray(applicationNotes.applicationId, applicationIds));
          await db
            .delete(interviewSchedules)
            .where(inArray(interviewSchedules.applicationId, applicationIds));
          await db
            .delete(applicationNotifications)
            .where(
              inArray(applicationNotifications.applicationId, applicationIds)
            );
          await db
            .delete(employerResponses)
            .where(inArray(employerResponses.applicationId, applicationIds));
          await db
            .delete(applications)
            .where(inArray(applications.id, applicationIds));
        }
        if (platformId) {
          const ownedJobs = await db
            .select({ id: jobs.id })
            .from(jobs)
            .where(eq(jobs.company, marker));
          if (ownedJobs.length)
            await db.delete(jobs).where(
              inArray(
                jobs.id,
                ownedJobs.map(job => job.id)
              )
            );
          await db.delete(jobPlatforms).where(eq(jobPlatforms.id, platformId));
        }
        if (userId) await db.delete(users).where(eq(users.id, userId));
      } finally {
        await closeDatabaseConnection();
      }
    }, 30000);

    it("rolls back interview completion and all response evidence when outcome audit insertion fails", async () => {
      const applicationId = applicationIds[0];
      const interviewId = interviewIds[0];
      const input = {
        interviewId,
        outcome: "offer" as const,
        source: "email" as const,
        sourceReference: `${marker}-offer-outcome`,
        summary:
          "Recruiter confirmed that an offer was made after the interview.",
        receivedAt: new Date(Date.now() - 1000),
      };
      await installAuditFailure("interview_outcome_recorded", applicationId);

      await expect(recordInterviewOutcome(input, userId)).rejects.toThrow();
      await removeAuditFailures();

      const [application] = await db
        .select({ status: applications.status })
        .from(applications)
        .where(eq(applications.id, applicationId));
      const [interview] = await db
        .select({ status: interviewSchedules.status })
        .from(interviewSchedules)
        .where(eq(interviewSchedules.id, interviewId));
      const responseRows = await db
        .select({ id: employerResponses.id })
        .from(employerResponses)
        .where(eq(employerResponses.interviewId, interviewId));
      const noteRows = await db
        .select({ id: applicationNotes.id })
        .from(applicationNotes)
        .where(eq(applicationNotes.applicationId, applicationId));
      const [notification] = await db
        .select({ readAt: applicationNotifications.readAt })
        .from(applicationNotifications)
        .where(eq(applicationNotifications.applicationId, applicationId));
      const approvalRows = await db
        .select({ id: applicationApprovals.id })
        .from(applicationApprovals)
        .where(
          and(
            eq(applicationApprovals.applicationId, applicationId),
            eq(applicationApprovals.approvalType, "offer_attribution")
          )
        );
      const reviewRows = await db
        .select({ id: adminReviewItems.id })
        .from(adminReviewItems)
        .where(
          and(
            eq(adminReviewItems.userId, userId),
            eq(adminReviewItems.entityType, "application"),
            eq(adminReviewItems.entityId, applicationId),
            eq(adminReviewItems.category, "offer_attribution")
          )
        );
      const auditRows = await db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.entityId, applicationId));

      expect(application.status).toBe("interview");
      expect(interview.status).toBe("scheduled");
      expect(responseRows).toHaveLength(0);
      expect(noteRows).toHaveLength(0);
      expect(notification.readAt).toBeNull();
      expect(approvalRows).toHaveLength(0);
      expect(reviewRows).toHaveLength(0);
      expect(auditRows).toHaveLength(0);

      const outcome = await recordInterviewOutcome(input, userId);
      const duplicate = await recordInterviewOutcome(input, userId);
      expect(duplicate.existing).toBe(true);
      expect(duplicate.responseId).toBe(outcome.responseId);
      const [notificationAfter] = await db
        .select({ readAt: applicationNotifications.readAt })
        .from(applicationNotifications)
        .where(eq(applicationNotifications.applicationId, applicationId));
      expect(notificationAfter.readAt).not.toBeNull();
      expect(
        await db
          .select({ id: employerResponses.id })
          .from(employerResponses)
          .where(eq(employerResponses.interviewId, interviewId))
      ).toHaveLength(1);
      expect(
        await db
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.entityId, applicationId),
              eq(auditEvents.action, "interview_outcome_recorded")
            )
          )
      ).toHaveLength(1);
      expect(
        await db
          .select({ id: applicationApprovals.id })
          .from(applicationApprovals)
          .where(
            and(
              eq(applicationApprovals.applicationId, applicationId),
              eq(applicationApprovals.approvalType, "offer_attribution")
            )
          )
      ).toHaveLength(1);
      expect(
        await db
          .select({ id: adminReviewItems.id })
          .from(adminReviewItems)
          .where(
            and(
              eq(adminReviewItems.userId, userId),
              eq(adminReviewItems.entityType, "application"),
              eq(adminReviewItems.entityId, applicationId),
              eq(adminReviewItems.category, "offer_attribution")
            )
          )
      ).toHaveLength(1);
    }, 30000);

    it("rolls back reschedule, approval, activity, and audit when audit insertion fails", async () => {
      const applicationId = applicationIds[1];
      const interviewId = interviewIds[1];
      const nextDate = new Date(initialScheduledAt.getTime() + 86_400_000);
      await installAuditFailure("interview_rescheduled", applicationId);

      await expect(
        rescheduleInterview(interviewId, nextDate, userId)
      ).rejects.toThrow();
      await removeAuditFailures();

      const [application] = await db
        .select({ lastActivity: applications.lastActivity })
        .from(applications)
        .where(eq(applications.id, applicationId));
      const [interview] = await db
        .select({
          status: interviewSchedules.status,
          scheduledAt: interviewSchedules.scheduledAt,
        })
        .from(interviewSchedules)
        .where(eq(interviewSchedules.id, interviewId));
      const approvalRows = await db
        .select({ id: applicationApprovals.id })
        .from(applicationApprovals)
        .where(
          and(
            eq(applicationApprovals.applicationId, applicationId),
            eq(applicationApprovals.approvalType, "interview_schedule")
          )
        );
      const auditRows = await db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.entityId, applicationId),
            eq(auditEvents.action, "interview_rescheduled")
          )
        );

      expect(application.lastActivity?.getTime()).toBe(
        initialActivity.getTime()
      );
      expect(interview.status).toBe("scheduled");
      expect(interview.scheduledAt.getTime()).toBe(
        initialScheduledAt.getTime()
      );
      expect(approvalRows).toHaveLength(0);
      expect(auditRows).toHaveLength(0);

      const rescheduled = await rescheduleInterview(
        interviewId,
        nextDate,
        userId
      );
      const duplicate = await rescheduleInterview(
        interviewId,
        nextDate,
        userId
      );
      expect(duplicate.existing).toBe(true);
      expect(duplicate.approvalId).toBe(rescheduled.approvalId);
      expect(
        await db
          .select({ id: applicationApprovals.id })
          .from(applicationApprovals)
          .where(
            and(
              eq(applicationApprovals.applicationId, applicationId),
              eq(applicationApprovals.approvalType, "interview_schedule")
            )
          )
      ).toHaveLength(1);
    }, 30000);

    it("serializes a concurrent outcome and reschedule into a valid final state", async () => {
      const applicationId = applicationIds[2];
      const interviewId = interviewIds[2];
      const nextDate = new Date(initialScheduledAt.getTime() + 2 * 86_400_000);
      const [outcome, reschedule] = await Promise.allSettled([
        recordInterviewOutcome(
          {
            interviewId,
            outcome: "rejection",
            source: "email",
            summary: "Recruiter confirmed that another candidate was selected.",
          },
          userId
        ),
        rescheduleInterview(interviewId, nextDate, userId),
      ]);

      expect([outcome.status, reschedule.status]).toContain("fulfilled");
      const [application] = await db
        .select({ status: applications.status })
        .from(applications)
        .where(eq(applications.id, applicationId));
      const [interview] = await db
        .select({ status: interviewSchedules.status })
        .from(interviewSchedules)
        .where(eq(interviewSchedules.id, interviewId));
      expect(["completed", "rescheduled"]).toContain(interview.status);
      if (interview.status === "completed") {
        expect(application.status).toBe("rejected");
        expect(
          await db
            .select({ id: employerResponses.id })
            .from(employerResponses)
            .where(eq(employerResponses.interviewId, interviewId))
        ).toHaveLength(1);
      } else {
        expect(application.status).toBe("interview");
        expect(
          await db
            .select({ id: applicationApprovals.id })
            .from(applicationApprovals)
            .where(
              and(
                eq(applicationApprovals.applicationId, applicationId),
                eq(applicationApprovals.approvalType, "interview_schedule")
              )
            )
        ).toHaveLength(1);
      }
    }, 30000);
  });
