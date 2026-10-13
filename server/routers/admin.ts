import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import {
  createAdminReviewItem,
  createAuditEvent,
  getDb,
  getAdminMemoryFallback,
  getAdminReviewEvidenceSnapshot,
  getOperationalFailureMonitoringSnapshot,
  listActiveAdminReviewItemsForEntity,
  resolveAdminReviewItem,
} from "../db";
import {
  successFees,
  successFeeHolds,
  employmentVerifications,
  feePayments,
  adminReviewItems,
  auditEvents,
  stripeReconciliationCommands,
  stripeWebhookEvents,
  users,
} from "../../drizzle/schema";
import {
  calculateNextVerificationDue,
  calculateVerificationGraceExpiry,
} from "../successFeeDates";
import { eq, desc, and, lt, sql, isNotNull, isNull, or, inArray } from "drizzle-orm";
import { buildPrivacyErasurePreview } from "../privacyRetention";
import { storageGet } from "../storage";
import { canTransitionSuccessFeeStatus } from "../successFeeStateMachine";
import { addSuccessFeeHold, refreshSuccessFeeEffectiveStatus, resolveSuccessFeeHolds } from "../successFeeHolds";
import {
  adminTimestampIdCursorSchema,
  createAdminCursorPage,
  isAfterDescendingTimestampIdCursor,
} from "../adminPagination";
type StripeReconciliationAction = "pause" | "resume" | "cancel";

function stripeActionForFeeStatus(currentStatus: string, requestedStatus: string): StripeReconciliationAction | null {
  if (["paused", "suspended", "disputed"].includes(requestedStatus)) return "pause";
  if (requestedStatus === "active" && ["paused", "suspended", "disputed"].includes(currentStatus)) return "resume";
  if (requestedStatus === "ended") return "cancel";
  return null;
}

export const adminRouter = router({
  getOperationalFailures: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }).optional())
    .query(async ({ input }) => {
      return await getOperationalFailureMonitoringSnapshot(input?.limit ?? 20);
    }),

  getReviewQueue: adminProcedure
    .input(z.object({
      status: z.enum(["all", "open", "in_progress", "resolved", "dismissed"]).default("open"),
      limit: z.number().int().min(1).max(100).default(50),
      cursor: adminTimestampIdCursorSchema.optional(),
    }))
    .query(async ({ input }) => {
      const memoryFallback = await getAdminMemoryFallback();
      if (memoryFallback) {
        const rows = memoryFallback.reviewItems
          .filter((item) => input.status === "all" || item.status === input.status)
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id - left.id);
        const afterCursor = rows.filter((item) => isAfterDescendingTimestampIdCursor(
          item,
          input.cursor,
          (row) => row.createdAt,
          (row) => row.id
        ));
        return createAdminCursorPage(afterCursor.slice(0, input.limit + 1), input.limit, rows.length, (item) => ({
          timestamp: item.createdAt,
          id: item.id,
        }));
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const filter = input.status === "all" ? undefined : eq(adminReviewItems.status, input.status);
      const conditions = [
        ...(filter ? [filter] : []),
        ...(input.cursor ? [or(
          lt(adminReviewItems.createdAt, input.cursor.timestamp),
          and(eq(adminReviewItems.createdAt, input.cursor.timestamp), lt(adminReviewItems.id, input.cursor.id))
        )!] : []),
      ];
      const [rows, totalRows] = await Promise.all([
        db.select().from(adminReviewItems)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(adminReviewItems.createdAt), desc(adminReviewItems.id))
          .limit(input.limit + 1),
        db.select({ count: sql<number>`COUNT(*)` }).from(adminReviewItems).where(filter),
      ]);
      return createAdminCursorPage(rows, input.limit, Number(totalRows[0]?.count ?? 0), (item) => ({
        timestamp: item.createdAt,
        id: item.id,
      }));
    }),

  getSuccessFeeHolds: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      return await db.select({
        id: successFeeHolds.id,
        successFeeId: successFeeHolds.successFeeId,
        holdType: successFeeHolds.holdType,
        reason: successFeeHolds.reason,
        createdByActor: successFeeHolds.createdByActor,
        createdAt: successFeeHolds.createdAt,
        employerName: successFees.employerName,
        jobTitle: successFees.jobTitle,
        effectiveStatus: successFees.status,
      })
        .from(successFeeHolds)
        .innerJoin(successFees, eq(successFeeHolds.successFeeId, successFees.id))
        .where(isNull(successFeeHolds.resolvedAt))
        .orderBy(desc(successFeeHolds.createdAt), desc(successFeeHolds.id))
        .limit(input?.limit ?? 50);
    }),

  getOperatingCounts: adminProcedure.query(async () => {
    const memoryFallback = await getAdminMemoryFallback();
    if (memoryFallback) {
      const reviews = memoryFallback.reviewItems.filter((item) => item.status === "open");
      return {
        reviewTotal: reviews.length,
        feesTotal: memoryFallback.fees.length,
        paymentsTotal: memoryFallback.payments.length,
        criticalReviews: reviews.filter((item) => item.category !== "payment_failed" && (item.priority === "critical" || item.category === "legal_escalation")).length,
        highRiskReviews: reviews.filter((item) => item.priority === "high" || item.category === "employment_ended").length,
        legalEscalations: reviews.filter((item) => item.category === "legal_escalation").length,
        offerAttributionReviews: reviews.filter((item) => item.category === "offer_attribution").length,
        employmentEndedReviews: reviews.filter((item) => item.category === "employment_ended").length,
        overdueVerifications: memoryFallback.overdue.length,
        graceExpiredVerifications: memoryFallback.overdue.filter((item) => item.graceExpired).length,
        pendingVerifications: memoryFallback.pendingVerifications.length,
        failedPayments: reviews.filter((item) => item.category === "payment_failed").length,
      };
    }
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const now = new Date();
    const overdueCondition = and(
      or(eq(successFees.status, "active"), eq(successFees.status, "suspended")),
      isNotNull(successFees.nextVerificationDue),
      lt(successFees.nextVerificationDue, now)
    );
    const [reviewRows, overdueRows, verificationRows, feeRows, paymentRows] = await Promise.all([
      db.select({
        reviewTotal: sql<number>`COUNT(*)`,
        criticalReviews: sql<number>`SUM(CASE WHEN ${adminReviewItems.category} <> 'payment_failed' AND (${adminReviewItems.priority} = 'critical' OR ${adminReviewItems.category} = 'legal_escalation') THEN 1 ELSE 0 END)`,
        highRiskReviews: sql<number>`SUM(CASE WHEN ${adminReviewItems.priority} = 'high' OR ${adminReviewItems.category} = 'employment_ended' THEN 1 ELSE 0 END)`,
        legalEscalations: sql<number>`SUM(CASE WHEN ${adminReviewItems.category} = 'legal_escalation' THEN 1 ELSE 0 END)`,
        offerAttributionReviews: sql<number>`SUM(CASE WHEN ${adminReviewItems.category} = 'offer_attribution' THEN 1 ELSE 0 END)`,
        employmentEndedReviews: sql<number>`SUM(CASE WHEN ${adminReviewItems.category} = 'employment_ended' THEN 1 ELSE 0 END)`,
        failedPayments: sql<number>`SUM(CASE WHEN ${adminReviewItems.category} = 'payment_failed' THEN 1 ELSE 0 END)`,
      }).from(adminReviewItems).where(eq(adminReviewItems.status, "open")),
      db.select({
        overdueVerifications: sql<number>`COUNT(*)`,
        graceExpiredVerifications: sql<number>`SUM(CASE WHEN ${successFees.verificationGraceExpiry} < ${now} THEN 1 ELSE 0 END)`,
      }).from(successFees).where(overdueCondition),
      db.select({ pendingVerifications: sql<number>`COUNT(*)` })
        .from(employmentVerifications).where(eq(employmentVerifications.status, "pending")),
      db.select({ feesTotal: sql<number>`COUNT(*)` }).from(successFees),
      db.select({ paymentsTotal: sql<number>`COUNT(*)` }).from(feePayments),
    ]);
    return {
      reviewTotal: Number(reviewRows[0]?.reviewTotal ?? 0),
      criticalReviews: Number(reviewRows[0]?.criticalReviews ?? 0),
      highRiskReviews: Number(reviewRows[0]?.highRiskReviews ?? 0),
      legalEscalations: Number(reviewRows[0]?.legalEscalations ?? 0),
      offerAttributionReviews: Number(reviewRows[0]?.offerAttributionReviews ?? 0),
      employmentEndedReviews: Number(reviewRows[0]?.employmentEndedReviews ?? 0),
      overdueVerifications: Number(overdueRows[0]?.overdueVerifications ?? 0),
      graceExpiredVerifications: Number(overdueRows[0]?.graceExpiredVerifications ?? 0),
      pendingVerifications: Number(verificationRows[0]?.pendingVerifications ?? 0),
      failedPayments: Number(reviewRows[0]?.failedPayments ?? 0),
      feesTotal: Number(feeRows[0]?.feesTotal ?? 0),
      paymentsTotal: Number(paymentRows[0]?.paymentsTotal ?? 0),
    };
  }),

  getStripeReconciliationStatus: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const [counts, commands] = await Promise.all([
      db.select({
        pending: sql<number>`SUM(CASE WHEN ${stripeReconciliationCommands.status} = 'pending' THEN 1 ELSE 0 END)`,
        processing: sql<number>`SUM(CASE WHEN ${stripeReconciliationCommands.status} = 'processing' THEN 1 ELSE 0 END)`,
        failed: sql<number>`SUM(CASE WHEN ${stripeReconciliationCommands.status} = 'failed' THEN 1 ELSE 0 END)`,
      }).from(stripeReconciliationCommands),
      db.select({
        id: stripeReconciliationCommands.id,
        successFeeId: stripeReconciliationCommands.successFeeId,
        stripeSubscriptionId: stripeReconciliationCommands.stripeSubscriptionId,
        action: stripeReconciliationCommands.action,
        status: stripeReconciliationCommands.status,
        attemptCount: stripeReconciliationCommands.attemptCount,
        lastErrorCode: stripeReconciliationCommands.lastErrorCode,
        nextAttemptAt: stripeReconciliationCommands.nextAttemptAt,
        lastAttemptAt: stripeReconciliationCommands.lastAttemptAt,
        createdAt: stripeReconciliationCommands.createdAt,
      }).from(stripeReconciliationCommands)
        .where(inArray(stripeReconciliationCommands.status, ["pending", "processing", "failed"]))
        .orderBy(desc(stripeReconciliationCommands.createdAt), desc(stripeReconciliationCommands.id))
        .limit(50),
    ]);
    return {
      pending: Number(counts[0]?.pending ?? 0),
      processing: Number(counts[0]?.processing ?? 0),
      failed: Number(counts[0]?.failed ?? 0),
      commands,
    };
  }),

  getStripeWebhookIssues: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      return await db.select({
        id: stripeWebhookEvents.id,
        stripeEventId: stripeWebhookEvents.stripeEventId,
        eventType: stripeWebhookEvents.eventType,
        status: stripeWebhookEvents.status,
        errorMessage: stripeWebhookEvents.errorMessage,
        receivedAt: stripeWebhookEvents.receivedAt,
        updatedAt: stripeWebhookEvents.updatedAt,
      }).from(stripeWebhookEvents)
        .where(inArray(stripeWebhookEvents.status, ["failed", "quarantined"]))
        .orderBy(desc(stripeWebhookEvents.updatedAt), desc(stripeWebhookEvents.id))
        .limit(input?.limit ?? 50);
    }),

  reopenQuarantinedStripeWebhook: adminProcedure
    .input(z.object({ eventRowId: z.number().int().positive(), confirmation: z.literal("REOPEN") }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      return await db.transaction(async tx => {
        const [event] = await tx.select().from(stripeWebhookEvents)
          .where(eq(stripeWebhookEvents.id, input.eventRowId))
          .limit(1)
          .for("update");
        if (!event) throw new TRPCError({ code: "NOT_FOUND", message: "Stripe event not found" });
        if (event.status !== "quarantined") {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Only quarantined Stripe events can be reopened" });
        }
        await tx.update(stripeWebhookEvents)
          .set({ status: "failed", processedAt: null })
          .where(eq(stripeWebhookEvents.id, event.id));
        await tx.insert(auditEvents).values({
          userId: ctx.user.id,
          entityType: "user",
          entityId: ctx.user.id,
          action: "stripe_webhook_quarantine_reopened",
          actor: "admin",
          source: "admin.reopenQuarantinedStripeWebhook",
          beforeState: JSON.stringify({ eventId: event.stripeEventId, status: event.status, reasonCode: event.errorMessage }),
          afterState: JSON.stringify({ eventId: event.stripeEventId, status: "failed", resendRequired: true }),
          riskLevel: "high",
        });
        return { eventId: event.stripeEventId, eventType: event.eventType };
      });
    }),

  getReviewEvidence: adminProcedure
    .input(z.object({
      reviewItemId: z.number().int().positive(),
    }))
    .query(async ({ input }) => {
      try {
        return await getAdminReviewEvidenceSnapshot(input.reviewItemId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to load review evidence.";
        throw new TRPCError({
          code: message === "Review item not found." ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR",
          message,
        });
      }
    }),

  previewPrivacyErasure: adminProcedure
    .input(z.object({ reviewItemId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const evidence = await getAdminReviewEvidenceSnapshot(input.reviewItemId);
      if (evidence.reviewItem.category !== "privacy_deletion" || evidence.reviewItem.entityType !== "user") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Erasure previews are available only for privacy deletion reviews.",
        });
      }
      return await buildPrivacyErasurePreview(evidence.reviewItem.userId);
    }),

  getPrivacyErasurePlan: adminProcedure
    .input(z.object({ reviewItemId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const evidence = await getAdminReviewEvidenceSnapshot(input.reviewItemId);
      if (
        evidence.reviewItem.category !== "privacy_deletion" ||
        evidence.reviewItem.entityType !== "user"
      ) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Erasure plans are available only for privacy deletion reviews." });
      }
      const { getPrivacyErasureRunForReview } = await import("../privacyErasurePlanning");
      return await getPrivacyErasureRunForReview(input.reviewItemId);
    }),

  executePrivacyErasureCleanup: adminProcedure
    .input(z.object({
      runId: z.number().int().positive(),
      confirmation: z.string().min(1).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      const { executePrivacyErasureCleanup } = await import("../privacyErasureExecution");
      const result = await executePrivacyErasureCleanup(input.runId, input.confirmation);
      await createAuditEvent({
        userId: result.userId,
        entityType: "user",
        entityId: result.userId,
        action: "privacy_erasure_external_cleanup_run",
        actor: "admin",
        source: "admin.executePrivacyErasureCleanup",
        afterState: JSON.stringify({ runId: input.runId, status: result.status, adminUserId: ctx.user.id }),
        riskLevel: result.status === "ready_for_database" ? "high" : "critical",
      });
      return result;
    }),

  confirmManualPrivacyCleanup: adminProcedure
    .input(z.object({
      runId: z.number().int().positive(),
      taskId: z.number().int().positive(),
      evidence: z.string().trim().min(20).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const { confirmManualPrivacyCleanup } = await import("../privacyErasureExecution");
      const result = await confirmManualPrivacyCleanup(input.runId, input.taskId, input.evidence);
      await createAuditEvent({
        userId: result.userId,
        entityType: "user",
        entityId: result.userId,
        action: "privacy_erasure_manual_cleanup_confirmed",
        actor: "admin",
        source: "admin.confirmManualPrivacyCleanup",
        afterState: JSON.stringify({ runId: input.runId, taskId: input.taskId, adminUserId: ctx.user.id }),
        riskLevel: "critical",
      });
      return result;
    }),

  finalizePrivacyErasure: adminProcedure
    .input(z.object({
      runId: z.number().int().positive(),
      confirmation: z.string().min(1).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      const { finalizePrivacyErasure } = await import("../privacyErasureFinalization");
      const result = await finalizePrivacyErasure(input.runId, input.confirmation);
      await createAuditEvent({
        userId: result.userId,
        entityType: "user",
        entityId: result.userId,
        action: "privacy_erasure_database_finalized",
        actor: "admin",
        source: "admin.finalizePrivacyErasure",
        afterState: JSON.stringify({
          runId: input.runId,
          completed: true,
          idempotentReplay: result.existing,
          adminUserId: ctx.user.id,
        }),
        riskLevel: "critical",
      });
      return result;
    }),

  resolveReviewItem: adminProcedure
    .input(z.object({
      reviewItemId: z.number().int().positive(),
      status: z.enum(["resolved", "dismissed"]),
      resolution: z.string().trim().min(1).max(5000),
    }))
    .mutation(async ({ ctx, input }) => {
      const evidence = await getAdminReviewEvidenceSnapshot(input.reviewItemId);
      const isPrivacyDeletion = evidence.reviewItem.category === "privacy_deletion";
      let erasurePlan = null;
      if (isPrivacyDeletion && input.status === "resolved" && await getDb()) {
        const { planPrivacyErasure } = await import("../privacyErasurePlanning");
        erasurePlan = await planPrivacyErasure(input.reviewItemId, ctx.user.id, { allowUnresolvedReview: true });
      }
      const result = await resolveAdminReviewItem(
        input.reviewItemId,
        ctx.user.id,
        input.status,
        input.resolution
      );
      await createAuditEvent({
        userId: evidence.reviewItem.userId,
        entityType: isPrivacyDeletion ? "user" : "admin_review",
        entityId: isPrivacyDeletion ? evidence.reviewItem.userId : input.reviewItemId,
        action: isPrivacyDeletion ? "privacy_deletion_review_recorded" : "admin_review_item_resolved",
        actor: "admin",
        source: "admin.resolveReviewItem",
        afterState: JSON.stringify({
          reviewItemId: input.reviewItemId,
          status: input.status,
          resolutionRecorded: true,
          adminUserId: ctx.user.id,
          dataDeleted: false,
          erasureRunId: erasurePlan?.run.id ?? null,
        }),
        riskLevel: isPrivacyDeletion ? "high" : input.status === "resolved" ? "medium" : "low",
      });
      return { ...result, erasurePlan };
    }),

  // ─── Overview Stats ─────────────────────────────────────────────────────────
  getStats: adminProcedure.query(async () => {
    const memoryFallback = await getAdminMemoryFallback();
    if (memoryFallback) return memoryFallback.stats;
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const [activeFees] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(successFees)
      .where(eq(successFees.status, "active"));

    const [pendingFees] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(successFees)
      .where(eq(successFees.status, "pending_verification"));

    const [suspendedFees] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(successFees)
      .where(eq(successFees.status, "suspended"));

    const [pausedFees] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(successFees)
      .where(eq(successFees.status, "paused"));

    const [disputedFees] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(successFees)
      .where(eq(successFees.status, "disputed"));

    const [totalRevenue] = await db
      .select({ total: sql<number>`COALESCE(SUM(amount), 0)` })
      .from(feePayments)
      .where(eq(feePayments.status, "paid"));

    const [monthlyRevenue] = await db
      .select({ total: sql<number>`COALESCE(SUM(amount), 0)` })
      .from(feePayments)
      .where(
        and(
          eq(feePayments.status, "paid"),
          sql`paid_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
        )
      );

    const [overdueVerifications] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(successFees)
      .where(
        and(
          eq(successFees.status, "active"),
          isNotNull(successFees.nextVerificationDue),
          lt(successFees.nextVerificationDue, new Date())
        )
      );

    const [totalUsers] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(users);

    return {
      activeFees: Number(activeFees.count),
      pendingFees: Number(pendingFees.count),
      suspendedFees: Number(suspendedFees.count),
      pausedFees: Number(pausedFees.count),
      disputedFees: Number(disputedFees.count),
      totalRevenueUsd: Number(totalRevenue.total) / 100,
      monthlyRevenueUsd: Number(monthlyRevenue.total) / 100,
      overdueVerifications: Number(overdueVerifications.count),
      totalUsers: Number(totalUsers.count),
    };
  }),

  // ─── List All Success Fees ───────────────────────────────────────────────────
  listFees: adminProcedure
    .input(
      z.object({
        status: z
          .enum(["all", "pending_verification", "active", "paused", "ended", "suspended", "disputed"])
          .default("all"),
        limit: z.number().min(1).max(100).default(50),
        cursor: adminTimestampIdCursorSchema.optional(),
      })
    )
    .query(async ({ input }) => {
      const memoryFallback = await getAdminMemoryFallback();
      if (memoryFallback) {
        const rows = memoryFallback.fees
          .filter((fee) => input.status === "all" || fee.status === input.status)
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id - left.id);
        const afterCursor = rows.filter((fee) => isAfterDescendingTimestampIdCursor(
          fee,
          input.cursor,
          (item) => item.createdAt,
          (item) => item.id
        ));
        return createAdminCursorPage(afterCursor.slice(0, input.limit + 1), input.limit, rows.length, (fee) => ({
          timestamp: fee.createdAt,
          id: fee.id,
        }));
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const conditions = [
        ...(input.status !== "all" ? [eq(successFees.status, input.status as any)] : []),
        ...(input.cursor ? [or(
          lt(successFees.createdAt, input.cursor.timestamp),
          and(eq(successFees.createdAt, input.cursor.timestamp), lt(successFees.id, input.cursor.id))
        )!] : []),
      ];
      const filter = input.status !== "all" ? eq(successFees.status, input.status as any) : undefined;

      const [rows, totalRows] = await Promise.all([
        db
        .select({ id: successFees.id })
        .from(successFees)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(successFees.createdAt), desc(successFees.id))
        .limit(input.limit + 1),
        db.select({ count: sql<number>`COUNT(*)` }).from(successFees).where(filter),
      ]);
      if (rows.length === 0) return createAdminCursorPage([], input.limit, Number(totalRows[0]?.count ?? 0), () => ({ timestamp: new Date(0), id: 1 }));

      const fees = await db
        .select({
          id: successFees.id,
          userId: successFees.userId,
          employerName: successFees.employerName,
          jobTitle: successFees.jobTitle,
          monthlySalary: successFees.monthlySalary,
          currency: successFees.currency,
          monthlyFeeAmount: successFees.monthlyFeeAmount,
          status: successFees.status,
          startDate: successFees.startDate,
          endDate: successFees.endDate,
          nextVerificationDue: successFees.nextVerificationDue,
          verificationGraceExpiry: successFees.verificationGraceExpiry,
          stripeSubscriptionId: successFees.stripeSubscriptionId,
          notes: successFees.notes,
          createdAt: successFees.createdAt,
          userName: users.name,
          userEmail: users.email,
          userAccountStatus: users.accountStatus,
        })
        .from(successFees)
        .leftJoin(users, eq(successFees.userId, users.id))
        .where(inArray(successFees.id, rows.map((fee) => fee.id)))
        .orderBy(desc(successFees.createdAt), desc(successFees.id));

      return createAdminCursorPage(fees, input.limit, Number(totalRows[0]?.count ?? 0), (fee) => ({
        timestamp: fee.createdAt,
        id: fee.id,
      }));
    }),

  // ─── Overdue Verifications ───────────────────────────────────────────────────
  listOverdueVerifications: adminProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(50),
      cursor: adminTimestampIdCursorSchema.optional(),
    }))
    .query(async ({ input }) => {
    const memoryFallback = await getAdminMemoryFallback();
    if (memoryFallback) {
      const rows = memoryFallback.overdue
        .slice()
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id - left.id);
      const afterCursor = rows.filter((fee) => isAfterDescendingTimestampIdCursor(
        fee,
        input.cursor,
        (item) => item.createdAt,
        (item) => item.id
      ));
      return createAdminCursorPage(afterCursor.slice(0, input.limit + 1), input.limit, rows.length, (fee) => ({
        timestamp: fee.createdAt,
        id: fee.id,
      }));
    }
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const now = new Date();
    const overdueCondition = and(
      or(eq(successFees.status, "active"), eq(successFees.status, "suspended")),
      isNotNull(successFees.nextVerificationDue),
      lt(successFees.nextVerificationDue, now)
    );
    const conditions = [
      overdueCondition!,
      ...(input.cursor ? [or(
        lt(successFees.createdAt, input.cursor.timestamp),
        and(eq(successFees.createdAt, input.cursor.timestamp), lt(successFees.id, input.cursor.id))
      )!] : []),
    ];
    const [fees, totalRows] = await Promise.all([db
      .select({
        id: successFees.id,
        userId: successFees.userId,
        employerName: successFees.employerName,
        jobTitle: successFees.jobTitle,
        monthlySalary: successFees.monthlySalary,
        monthlyFeeAmount: successFees.monthlyFeeAmount,
        status: successFees.status,
        createdAt: successFees.createdAt,
        nextVerificationDue: successFees.nextVerificationDue,
        verificationGraceExpiry: successFees.verificationGraceExpiry,
        notes: successFees.notes,
        userName: users.name,
        userEmail: users.email,
      })
      .from(successFees)
      .leftJoin(users, eq(successFees.userId, users.id))
      .where(
        and(...conditions)
      )
      .orderBy(desc(successFees.createdAt), desc(successFees.id))
      .limit(input.limit + 1),
    db.select({ count: sql<number>`COUNT(*)` }).from(successFees).where(overdueCondition)]);

    const page = createAdminCursorPage(fees.map((fee) => ({
      ...fee,
      daysOverdue: fee.nextVerificationDue
        ? Math.floor((now.getTime() - fee.nextVerificationDue.getTime()) / (1000 * 60 * 60 * 24))
        : 0,
      graceExpired: fee.verificationGraceExpiry
        ? fee.verificationGraceExpiry < now
        : false,
    })), input.limit, Number(totalRows[0]?.count ?? 0), (fee) => ({
      timestamp: fee.createdAt,
      id: fee.id,
    }));
    return page;
  }),

  // ─── Update Fee Status ───────────────────────────────────────────────────────
  updateFeeStatus: adminProcedure
    .input(
      z.object({
        feeId: z.number().int().positive(),
        status: z.enum(["pending_verification", "active", "paused", "ended", "suspended", "disputed"]),
        notes: z.string().trim().max(10_000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [feeOwner] = await db.select({ userId: successFees.userId })
        .from(successFees).where(eq(successFees.id, input.feeId)).limit(1);
      if (!feeOwner) throw new TRPCError({ code: "NOT_FOUND", message: "Success fee not found" });
      return await db.transaction(async tx => {
        const [user] = await tx.select({ id: users.id, accountStatus: users.accountStatus })
          .from(users).where(eq(users.id, feeOwner.userId)).limit(1).for("update");
        if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
        const [fee] = await tx.select().from(successFees)
          .where(eq(successFees.id, input.feeId)).limit(1).for("update");
        if (!fee) throw new TRPCError({ code: "NOT_FOUND", message: "Success fee not found" });
        if (fee.userId !== user.id) throw new TRPCError({ code: "CONFLICT", message: "Success-fee ownership changed; reload and retry." });
        if (input.status === "active" && user.accountStatus !== "active") {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Reinstate the account before resuming billing." });
        }
        const activeHolds = await tx.select({ id: successFeeHolds.id, holdType: successFeeHolds.holdType })
          .from(successFeeHolds)
          .where(and(eq(successFeeHolds.successFeeId, fee.id), sql`${successFeeHolds.resolvedAt} IS NULL`))
          .for("update");
        if (input.status === "active" && activeHolds.length > 0) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Resolve each active success-fee hold with separate evidence before resuming billing." });
        }
        if (fee.status !== input.status && !canTransitionSuccessFeeStatus(fee.status, input.status)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This success-fee status transition is not allowed." });
        }

        const now = new Date();
        const action = fee.status === input.status ? null : stripeActionForFeeStatus(fee.status, input.status);
        const queued = action && fee.stripeSubscriptionId;
        if (input.status === "suspended" || input.status === "disputed") {
          await addSuccessFeeHold(tx, {
            feeId: fee.id,
            holdType: input.status === "disputed" ? "legal" : "administrator",
            reason: input.notes ?? `Administrator placed a ${input.status} hold.`,
            actor: "admin",
            actorUserId: ctx.user.id,
          });
        }
        const lifecycleStatus = input.status === "suspended" || input.status === "disputed"
          ? fee.lifecycleStatus
          : input.status;
        const effectiveStatus = await refreshSuccessFeeEffectiveStatus(tx, {
          feeId: fee.id,
          lifecycleStatus,
          currentStatus: fee.status,
          currentLifecycleStatus: fee.lifecycleStatus,
        });
        await tx.update(successFees).set({
          notes: input.notes ?? fee.notes,
          endDate: input.status === "ended" ? fee.endDate ?? now : fee.endDate,
        }).where(eq(successFees.id, fee.id));
        if (queued) {
          await tx.insert(stripeReconciliationCommands).values({
            successFeeId: fee.id,
            stripeSubscriptionId: fee.stripeSubscriptionId!,
            commandKey: randomUUID(),
            action,
            status: "pending",
            nextAttemptAt: now,
          });
        }
        await tx.insert(auditEvents).values({
          userId: fee.userId,
          entityType: "success_fee",
          entityId: fee.id,
          action: "success_fee_status_updated",
          actor: "admin",
          source: "admin.updateFeeStatus",
          beforeState: JSON.stringify({ status: fee.status, lifecycleStatus: fee.lifecycleStatus }),
          afterState: JSON.stringify({
            status: effectiveStatus,
            lifecycleStatus,
            notes: input.notes ?? null,
            stripeSynchronization: queued ? "queued" : "not_required",
            stripeAction: queued ? action : null,
            adminUserId: ctx.user.id,
          }),
          riskLevel: input.status === "suspended" || input.status === "disputed" ? "high" : "medium",
        });
        if (input.status === "suspended" || input.status === "disputed") {
          await tx.insert(adminReviewItems).values({
            userId: fee.userId,
            entityType: "success_fee",
            entityId: fee.id,
            category: input.status === "disputed" ? "legal_escalation" : "verification_overdue",
            priority: input.status === "disputed" ? "critical" : "high",
            title: input.status === "disputed" ? "Disputed success fee requires admin follow-up" : "Suspended success fee requires admin review",
            description: input.notes ?? `Status changed from ${fee.status} to ${input.status}.`,
          });
        }
        return { success: true, billingSynchronization: queued ? "queued" as const : "not_required" as const };
      });
    }),

  resolveSuccessFeeHold: adminProcedure
    .input(z.object({
      holdId: z.number().int().positive(),
      evidence: z.string().trim().min(10).max(5000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [holdRef] = await db.select({ feeId: successFeeHolds.successFeeId })
        .from(successFeeHolds).where(eq(successFeeHolds.id, input.holdId)).limit(1);
      if (!holdRef) throw new TRPCError({ code: "NOT_FOUND", message: "Success-fee hold not found" });

      return await db.transaction(async tx => {
        const [fee] = await tx.select().from(successFees)
          .where(eq(successFees.id, holdRef.feeId)).limit(1).for("update");
        if (!fee) throw new TRPCError({ code: "NOT_FOUND", message: "Success fee not found" });
        const [hold] = await tx.select().from(successFeeHolds)
          .where(and(eq(successFeeHolds.id, input.holdId), eq(successFeeHolds.successFeeId, fee.id)))
          .limit(1).for("update");
        if (!hold) throw new TRPCError({ code: "NOT_FOUND", message: "Success-fee hold not found" });
        if (hold.resolvedAt) return { success: true, alreadyResolved: true, status: fee.status };
        if (hold.holdType === "payment" || hold.holdType === "account") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: hold.holdType === "payment"
              ? "Payment holds can only be cleared by verified Stripe recovery."
              : "Account holds can only be cleared through account reinstatement.",
          });
        }

        const now = new Date();
        await tx.update(successFeeHolds).set({
          resolvedAt: now,
          resolvedByUserId: ctx.user.id,
          resolutionEvidence: input.evidence,
        }).where(eq(successFeeHolds.id, hold.id));
        const status = await refreshSuccessFeeEffectiveStatus(tx, {
          feeId: fee.id,
          lifecycleStatus: fee.lifecycleStatus,
          currentStatus: fee.status,
          currentLifecycleStatus: fee.lifecycleStatus,
        });
        const action = status === "active" ? stripeActionForFeeStatus(fee.status, status) : null;
        if (action && fee.stripeSubscriptionId) {
          await tx.insert(stripeReconciliationCommands).values({
            successFeeId: fee.id,
            stripeSubscriptionId: fee.stripeSubscriptionId,
            commandKey: randomUUID(),
            action,
            status: "pending",
            nextAttemptAt: now,
          });
        }
        await tx.insert(auditEvents).values({
          userId: fee.userId,
          entityType: "success_fee",
          entityId: fee.id,
          action: "success_fee_hold_resolved",
          actor: "admin",
          source: "admin.resolveSuccessFeeHold",
          beforeState: JSON.stringify({ status: fee.status, holdType: hold.holdType, holdId: hold.id }),
          afterState: JSON.stringify({
            status,
            holdType: hold.holdType,
            holdId: hold.id,
            evidence: input.evidence,
            adminUserId: ctx.user.id,
            stripeSynchronization: action && fee.stripeSubscriptionId ? "queued" : "not_required",
          }),
          riskLevel: "high",
        });
        return { success: true, alreadyResolved: false, status };
      });
    }),

  // ─── Approve / Reject Verification ──────────────────────────────────────────
  reviewVerification: adminProcedure
    .input(
      z.object({
        verificationId: z.number().int().positive(),
        approved: z.boolean(),
        notes: z.string().trim().max(10_000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [verification] = await db
        .select()
        .from(employmentVerifications)
        .where(eq(employmentVerifications.id, input.verificationId))
        .limit(1);

      if (!verification)
        throw new TRPCError({ code: "NOT_FOUND", message: "Verification not found" });

      await db.transaction(async tx => {
        const [fee] = await tx.select().from(successFees)
          .where(eq(successFees.id, verification.successFeeId)).limit(1).for("update");
        if (!fee || fee.userId !== verification.userId) {
          throw new TRPCError({ code: "CONFLICT", message: "Verification ownership changed; reload and retry." });
        }
        const [lockedVerification] = await tx.select().from(employmentVerifications)
          .where(eq(employmentVerifications.id, input.verificationId)).limit(1).for("update");
        if (!lockedVerification || lockedVerification.successFeeId !== fee.id || lockedVerification.userId !== fee.userId) {
          throw new TRPCError({ code: "CONFLICT", message: "Verification ownership changed; reload and retry." });
        }
        await tx.update(employmentVerifications).set({
          status: input.approved ? "approved" : "rejected",
          reviewedAt: new Date(),
          reviewNotes: input.notes ?? null,
        }).where(eq(employmentVerifications.id, input.verificationId));

        if (input.approved) {
          await resolveSuccessFeeHolds(tx, {
            feeId: fee.id,
            holdType: "verification",
            sourceKey: `verification:${input.verificationId}`,
            evidence: input.notes ?? `Employment verification ${input.verificationId} approved by administrator.`,
            resolvedByUserId: ctx.user.id,
          });
        } else {
          await addSuccessFeeHold(tx, {
            feeId: fee.id,
            holdType: "verification",
            sourceKey: `verification:${input.verificationId}`,
            reason: input.notes ?? `Employment verification ${input.verificationId} was rejected.`,
            actor: "admin",
            actorUserId: ctx.user.id,
          });
        }
        const nextDue = calculateNextVerificationDue();
        const graceExpiry = calculateVerificationGraceExpiry(nextDue);
        const lifecycleStatus = input.approved && fee.lifecycleStatus === "pending_verification"
          ? "active"
          : fee.lifecycleStatus;
        await refreshSuccessFeeEffectiveStatus(tx, {
          feeId: fee.id,
          lifecycleStatus,
          currentStatus: fee.status,
          currentLifecycleStatus: fee.lifecycleStatus,
        });
        if (input.approved) {
          await tx.update(successFees).set({
            nextVerificationDue: nextDue,
            verificationGraceExpiry: graceExpiry,
          }).where(eq(successFees.id, fee.id));
        }
      });

      await createAuditEvent({
        userId: verification.userId,
        entityType: "verification",
        entityId: input.verificationId,
        action: input.approved ? "employment_verification_approved" : "employment_verification_rejected",
        actor: "admin",
        source: "admin.reviewVerification",
        beforeState: JSON.stringify({ status: verification.status }),
        afterState: JSON.stringify({
          status: input.approved ? "approved" : "rejected",
          notes: input.notes ?? null,
          adminUserId: ctx.user.id,
        }),
        riskLevel: input.approved ? "medium" : "high",
      });

      const reviewResolution = input.approved
        ? "Employment verification approved by admin review."
        : `Employment verification rejected by admin review${input.notes ? `: ${input.notes}` : "."}`;
      const activeVerificationReviewItems = await listActiveAdminReviewItemsForEntity(
        verification.userId,
        "verification",
        input.verificationId
      );

      await Promise.all(activeVerificationReviewItems.map((item) =>
        resolveAdminReviewItem(item.id, ctx.user.id, "resolved", reviewResolution)
      ));

      if (!input.approved) {
        await createAdminReviewItem({
          userId: verification.userId,
          entityType: "verification",
          entityId: input.verificationId,
          category: "verification_overdue",
          priority: "high",
          title: "Rejected verification needs user follow-up",
          description: input.notes ?? "Employment verification was rejected by admin review.",
        });
      }

      return { success: true, approved: input.approved };
    }),

  // ─── Suspend User Account ────────────────────────────────────────────────────
  suspendUser: adminProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        reason: z.string().trim().min(1).max(5000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "An administrator cannot suspend their own account.",
        });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      return await db.transaction(async tx => {
        const [target] = await tx.select({ id: users.id, accountStatus: users.accountStatus })
          .from(users).where(eq(users.id, input.userId)).limit(1).for("update");
        if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
        if (target.accountStatus === "suspended") return { success: true, billingSynchronization: "not_required" as const };

        const userFees = await tx.select().from(successFees)
          .where(and(
            eq(successFees.userId, input.userId),
            inArray(successFees.status, ["active", "pending_verification", "paused", "suspended", "disputed"]),
          ))
          .for("update");
        const now = new Date();
        await tx.update(users).set({
          accountStatus: "suspended",
          sessionVersion: sql`${users.sessionVersion} + 1`,
        }).where(eq(users.id, input.userId));
        let queuedCommands = 0;
        for (const fee of userFees) {
          await addSuccessFeeHold(tx, {
            feeId: fee.id,
            holdType: "account",
            reason: input.reason,
            actor: "admin",
            actorUserId: ctx.user.id,
          });
          const status = await refreshSuccessFeeEffectiveStatus(tx, {
            feeId: fee.id,
            lifecycleStatus: fee.lifecycleStatus,
            currentStatus: fee.status,
            currentLifecycleStatus: fee.lifecycleStatus,
          });
          await tx.update(successFees).set({ notes: `Suspended: ${input.reason}` })
            .where(eq(successFees.id, fee.id));
          if (fee.status === "active" && status !== "active" && fee.stripeSubscriptionId) {
            await tx.insert(stripeReconciliationCommands).values({
              successFeeId: fee.id,
              stripeSubscriptionId: fee.stripeSubscriptionId,
              commandKey: randomUUID(),
              action: "pause",
              status: "pending",
              nextAttemptAt: now,
            });
            queuedCommands += 1;
          }
        }
        await tx.insert(auditEvents).values({
          userId: input.userId,
          entityType: "user",
          entityId: input.userId,
          action: "user_suspended",
          actor: "admin",
          source: "admin.suspendUser",
          afterState: JSON.stringify({
            reason: input.reason,
            adminUserId: ctx.user.id,
            sessionVersionRevoked: true,
            stripeCommandsQueued: queuedCommands,
          }),
          riskLevel: "critical",
        });
        await tx.insert(adminReviewItems).values({
          userId: input.userId,
          entityType: "user",
          entityId: input.userId,
          category: "legal_escalation",
          priority: "critical",
          title: "Suspended user account requires admin follow-up",
          description: input.reason,
        });
        return {
          success: true,
          billingSynchronization: queuedCommands > 0 ? "queued" as const : "not_required" as const,
        };
      });
    }),

  // ─── Reinstate User Account ──────────────────────────────────────────────────
  reinstateUser: adminProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      return await db.transaction(async tx => {
        const [user] = await tx.select({ id: users.id, accountStatus: users.accountStatus })
          .from(users).where(eq(users.id, input.userId)).limit(1).for("update");
        if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
        await tx.update(users).set({ accountStatus: "active" }).where(eq(users.id, input.userId));
        const fees = await tx.select().from(successFees)
          .where(and(
            eq(successFees.userId, input.userId),
            inArray(successFees.status, ["active", "pending_verification", "paused", "suspended", "disputed"]),
          ))
          .for("update");
        let queuedCommands = 0;
        for (const fee of fees) {
          const [accountHold] = await tx.select({ id: successFeeHolds.id })
            .from(successFeeHolds)
            .where(and(
              eq(successFeeHolds.successFeeId, fee.id),
              eq(successFeeHolds.holdType, "account"),
              sql`${successFeeHolds.resolvedAt} IS NULL`,
            ))
            .limit(1)
            .for("update");
          if (!accountHold) continue;
          await resolveSuccessFeeHolds(tx, {
            feeId: fee.id,
            holdType: "account",
            evidence: "Account reinstated by administrator; account hold resolved.",
            resolvedByUserId: ctx.user.id,
          });
          const status = await refreshSuccessFeeEffectiveStatus(tx, {
            feeId: fee.id,
            lifecycleStatus: fee.lifecycleStatus,
            currentStatus: fee.status,
            currentLifecycleStatus: fee.lifecycleStatus,
          });
          const action = status === "active" ? stripeActionForFeeStatus(fee.status, status) : null;
          if (action && fee.stripeSubscriptionId) {
            await tx.insert(stripeReconciliationCommands).values({
              successFeeId: fee.id,
              stripeSubscriptionId: fee.stripeSubscriptionId,
              commandKey: randomUUID(),
              action,
              status: "pending",
              nextAttemptAt: new Date(),
            });
            queuedCommands += 1;
          }
        }
        await tx.insert(auditEvents).values({
          userId: input.userId,
          entityType: "user",
          entityId: input.userId,
          action: "user_reinstated",
          actor: "admin",
          source: "admin.reinstateUser",
          beforeState: JSON.stringify({ accountStatus: user.accountStatus }),
          afterState: JSON.stringify({
            accountStatus: "active",
            adminUserId: ctx.user.id,
            stripeCommandsQueued: queuedCommands,
          }),
          riskLevel: "high",
        });
        return {
          success: true,
          billingSynchronization: queuedCommands > 0 ? "queued" as const : "not_required" as const,
        };
      });
    }),

  // ─── Flag for Legal Escalation ───────────────────────────────────────────────
  flagLegalEscalation: adminProcedure
    .input(
      z.object({
        feeId: z.number().int().positive(),
        reason: z.string().trim().min(1).max(5000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [feeOwner] = await db.select({ userId: successFees.userId })
        .from(successFees).where(eq(successFees.id, input.feeId)).limit(1);
      if (!feeOwner) throw new TRPCError({ code: "NOT_FOUND", message: "Success fee not found" });
      return await db.transaction(async tx => {
        const [user] = await tx.select({ id: users.id, accountStatus: users.accountStatus })
          .from(users).where(eq(users.id, feeOwner.userId)).limit(1).for("update");
        if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
        const [fee] = await tx.select().from(successFees)
          .where(eq(successFees.id, input.feeId)).limit(1).for("update");
        if (!fee || fee.userId !== user.id) throw new TRPCError({ code: "CONFLICT", message: "Success-fee ownership changed; reload and retry." });

        const activeUserFees = await tx.select().from(successFees)
          .where(and(
            eq(successFees.userId, fee.userId),
            inArray(successFees.status, ["active", "pending_verification", "paused", "suspended", "disputed"]),
          ))
          .for("update");
        const allAffectedFees = Array.from(new Map([...activeUserFees, fee].map(item => [item.id, item])).values());
        const now = new Date();
        const escalationNote = `[LEGAL ESCALATION ${now.toISOString()}] ${input.reason}`;
        const updatedNotes = fee.notes ? `${fee.notes}\n${escalationNote}` : escalationNote;
        const relatedSuspensionNote = `Suspended: legal escalation on success fee #${input.feeId}.`;
        let queuedCommands = 0;

        for (const affectedFee of allAffectedFees) {
          const isEscalated = affectedFee.id === fee.id;
          const notes = isEscalated
            ? updatedNotes
            : affectedFee.notes ? `${affectedFee.notes}\n${relatedSuspensionNote}` : relatedSuspensionNote;
          if (affectedFee.status !== "disputed" && isEscalated && !canTransitionSuccessFeeStatus(affectedFee.status, "disputed")) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "A related success-fee status transition is not allowed." });
          }
          await addSuccessFeeHold(tx, {
            feeId: affectedFee.id,
            holdType: "account",
            reason: input.reason,
            actor: "admin",
            actorUserId: ctx.user.id,
          });
          if (isEscalated) {
            await addSuccessFeeHold(tx, {
              feeId: affectedFee.id,
              holdType: "legal",
              reason: input.reason,
              actor: "admin",
              actorUserId: ctx.user.id,
            });
          }
          const status = await refreshSuccessFeeEffectiveStatus(tx, {
            feeId: affectedFee.id,
            lifecycleStatus: affectedFee.lifecycleStatus,
            currentStatus: affectedFee.status,
            currentLifecycleStatus: affectedFee.lifecycleStatus,
          });
          await tx.update(successFees).set({ notes }).where(eq(successFees.id, affectedFee.id));
          if (affectedFee.stripeSubscriptionId && (affectedFee.status !== status || user.accountStatus !== "suspended")) {
            await tx.insert(stripeReconciliationCommands).values({
              successFeeId: affectedFee.id,
              stripeSubscriptionId: affectedFee.stripeSubscriptionId,
              commandKey: randomUUID(),
              action: "pause",
              status: "pending",
              nextAttemptAt: now,
            });
            queuedCommands += 1;
          }
          if (!isEscalated) {
            await tx.insert(auditEvents).values({
              userId: fee.userId,
              entityType: "success_fee",
              entityId: affectedFee.id,
              action: "success_fee_suspended_for_legal_escalation",
              actor: "admin",
              source: "admin.flagLegalEscalation",
              beforeState: JSON.stringify({ status: affectedFee.status }),
              afterState: JSON.stringify({ status, escalatedFeeId: fee.id, accountStatus: "suspended", adminUserId: ctx.user.id }),
              riskLevel: "critical",
            });
          }
        }

        await tx.update(users).set({
          accountStatus: "suspended",
          sessionVersion: sql`${users.sessionVersion} + 1`,
        }).where(eq(users.id, fee.userId));
        await tx.insert(auditEvents).values({
          userId: fee.userId,
          entityType: "success_fee",
          entityId: fee.id,
          action: "legal_escalation_flagged",
          actor: "admin",
          source: "admin.flagLegalEscalation",
          beforeState: JSON.stringify({ status: fee.status, accountStatus: user.accountStatus }),
          afterState: JSON.stringify({
            status: "disputed",
            accountStatus: "suspended",
            reason: input.reason,
            adminUserId: ctx.user.id,
            sessionVersionRevoked: true,
            stripeCommandsQueued: queuedCommands,
          }),
          riskLevel: "critical",
        });
        await tx.insert(adminReviewItems).values({
          userId: fee.userId,
          entityType: "success_fee",
          entityId: fee.id,
          category: "legal_escalation",
          priority: "critical",
          title: "Legal escalation flagged",
          description: input.reason,
        });
        return {
          success: true,
          escalationNote,
          billingSynchronization: queuedCommands > 0 ? "queued" as const : "not_required" as const,
        };
      });
    }),

  // ─── List Pending Verifications ──────────────────────────────────────────────
  listPendingVerifications: adminProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(50),
      cursor: adminTimestampIdCursorSchema.optional(),
    }))
    .query(async ({ input }) => {
    const memoryFallback = await getAdminMemoryFallback();
    if (memoryFallback) return createAdminCursorPage([], input.limit, memoryFallback.pendingVerifications.length, () => ({ timestamp: new Date(0), id: 1 }));
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const conditions = [
      eq(employmentVerifications.status, "pending"),
      ...(input.cursor ? [or(
        lt(employmentVerifications.submittedAt, input.cursor.timestamp),
        and(eq(employmentVerifications.submittedAt, input.cursor.timestamp), lt(employmentVerifications.id, input.cursor.id))
      )!] : []),
    ];
    const [verifications, totalRows] = await Promise.all([db
      .select({
        id: employmentVerifications.id,
        successFeeId: employmentVerifications.successFeeId,
        userId: employmentVerifications.userId,
        verificationType: employmentVerifications.verificationType,
        hasDocument: sql<boolean>`${employmentVerifications.documentKey} IS NOT NULL`,
        documentType: employmentVerifications.documentType,
        status: employmentVerifications.status,
        submittedAt: employmentVerifications.submittedAt,
        userName: users.name,
        userEmail: users.email,
        employerName: successFees.employerName,
        jobTitle: successFees.jobTitle,
        monthlySalary: successFees.monthlySalary,
      })
      .from(employmentVerifications)
      .leftJoin(users, eq(employmentVerifications.userId, users.id))
      .leftJoin(successFees, eq(employmentVerifications.successFeeId, successFees.id))
      .where(and(...conditions))
      .orderBy(desc(employmentVerifications.submittedAt), desc(employmentVerifications.id))
      .limit(input.limit + 1),
    db.select({ count: sql<number>`COUNT(*)` }).from(employmentVerifications).where(eq(employmentVerifications.status, "pending"))]);

    return createAdminCursorPage(verifications, input.limit, Number(totalRows[0]?.count ?? 0), (verification) => ({
      timestamp: verification.submittedAt,
      id: verification.id,
    }));
  }),

  getVerificationDocumentDownloadUrl: adminProcedure
    .input(z.object({ verificationId: z.number().int().positive() }).strict())
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [verification] = await db
        .select({
          id: employmentVerifications.id,
          userId: employmentVerifications.userId,
          documentKey: employmentVerifications.documentKey,
        })
        .from(employmentVerifications)
        .where(eq(employmentVerifications.id, input.verificationId))
        .limit(1);
      if (!verification?.documentKey) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Verification document not found." });
      }
      try {
        const { url } = await storageGet(verification.documentKey);
        await createAuditEvent({
          userId: verification.userId,
          entityType: "verification",
          entityId: verification.id,
          action: "verification_document_download_requested",
          actor: "admin",
          source: "admin.getVerificationDocumentDownloadUrl",
          afterState: JSON.stringify({ adminUserId: ctx.user.id }),
          riskLevel: "medium",
        });
        return { url };
      } catch {
        console.error("[Admin] Verification document download URL could not be created.");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "The private verification document is temporarily unavailable.",
        });
      }
    }),

  // ─── Payment History ─────────────────────────────────────────────────────────
  listPayments: adminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        cursor: adminTimestampIdCursorSchema.optional(),
        status: z.enum(["all", "pending", "paid", "failed", "refunded"]).default("all"),
      })
    )
    .query(async ({ input }) => {
      const memoryFallback = await getAdminMemoryFallback();
      if (memoryFallback) {
        return createAdminCursorPage([], input.limit, memoryFallback.payments.length, () => ({
          timestamp: new Date(0),
          id: 1,
        }));
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const paymentConditions = [
        ...(input.status === "all" ? [] : [eq(feePayments.status, input.status)]),
        ...(input.cursor ? [or(
          lt(feePayments.createdAt, input.cursor.timestamp),
          and(eq(feePayments.createdAt, input.cursor.timestamp), lt(feePayments.id, input.cursor.id))
        )!] : []),
      ];
      const paymentFilter = input.status === "all" ? undefined : eq(feePayments.status, input.status);
      const [payments, totalRows] = await Promise.all([db
        .select({
          id: feePayments.id,
          successFeeId: feePayments.successFeeId,
          userId: feePayments.userId,
          amount: feePayments.amount,
          currency: feePayments.currency,
          status: feePayments.status,
          paidAt: feePayments.paidAt,
          periodStart: feePayments.periodStart,
          periodEnd: feePayments.periodEnd,
          stripeInvoiceId: feePayments.stripeInvoiceId,
          createdAt: feePayments.createdAt,
          userName: users.name,
          userEmail: users.email,
          employerName: successFees.employerName,
        })
        .from(feePayments)
        .leftJoin(users, eq(feePayments.userId, users.id))
        .leftJoin(successFees, eq(feePayments.successFeeId, successFees.id))
        .where(paymentConditions.length ? and(...paymentConditions) : undefined)
        .orderBy(desc(feePayments.createdAt), desc(feePayments.id))
        .limit(input.limit + 1),
      db.select({ count: sql<number>`COUNT(*)` }).from(feePayments).where(paymentFilter)]);

      return createAdminCursorPage(payments, input.limit, Number(totalRows[0]?.count ?? 0), (payment) => ({
        timestamp: payment.createdAt,
        id: payment.id,
      }));
    }),

  // ─── Add Admin Note ──────────────────────────────────────────────────────────
  addNote: adminProcedure
    .input(
      z.object({
        feeId: z.number().int().positive(),
        note: z.string().trim().min(1).max(10_000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [fee] = await db
        .select({ notes: successFees.notes })
        .from(successFees)
        .where(eq(successFees.id, input.feeId))
        .limit(1);

      if (!fee) throw new TRPCError({ code: "NOT_FOUND", message: "Success fee not found" });

      const timestamp = new Date().toISOString();
      const newNote = `[${timestamp}] ${input.note}`;
      const updatedNotes = fee.notes ? `${fee.notes}\n${newNote}` : newNote;

      await db
        .update(successFees)
        .set({ notes: updatedNotes })
        .where(eq(successFees.id, input.feeId));

      const [fullFee] = await db
        .select({ userId: successFees.userId })
        .from(successFees)
        .where(eq(successFees.id, input.feeId))
        .limit(1);
      if (fullFee) {
        await createAuditEvent({
          userId: fullFee.userId,
          entityType: "success_fee",
          entityId: input.feeId,
          action: "admin_note_added",
          actor: "admin",
          source: "admin.addNote",
          afterState: JSON.stringify({ note: input.note, adminUserId: ctx.user.id }),
          riskLevel: "low",
        });
      }

      return { success: true };
    }),
});
