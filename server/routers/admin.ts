import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import {
  createAdminReviewItem,
  createAuditEvent,
  getDb,
  getAdminMemoryFallback,
  getAdminReviewEvidenceSnapshot,
  listActiveAdminReviewItemsForEntity,
  listAdminReviewItems,
  resolveAdminReviewItem,
} from "../db";
import {
  successFees,
  employmentVerifications,
  feePayments,
  users,
} from "../../drizzle/schema";
import {
  calculateNextVerificationDue,
  calculateVerificationGraceExpiry,
} from "../successFeeDates";
import { eq, desc, and, lt, sql, isNotNull, or } from "drizzle-orm";
import { getStripeClient } from "../stripeClient";
import { buildPrivacyErasurePreview } from "../privacyRetention";
import { getOperationalFailureSnapshot } from "../operationalFailureLog";

type StripeSynchronizedFeeStatus = "not_required" | "paused" | "resumed" | "cancelled";

async function synchronizeStripeForFeeStatusChange(
  fee: { status: string; stripeSubscriptionId: string | null },
  requestedStatus: string
): Promise<StripeSynchronizedFeeStatus> {
  if (!fee.stripeSubscriptionId || fee.status === requestedStatus) return "not_required";

  if (["suspended", "disputed"].includes(requestedStatus)) {
    await getStripeClient().subscriptions.update(fee.stripeSubscriptionId, {
      pause_collection: { behavior: "void" },
    });
    return "paused";
  }

  if (requestedStatus === "active" && ["suspended", "disputed"].includes(fee.status)) {
    await getStripeClient().subscriptions.update(fee.stripeSubscriptionId, {
      pause_collection: "",
    } as any);
    return "resumed";
  }

  if (requestedStatus === "ended") {
    await getStripeClient().subscriptions.cancel(fee.stripeSubscriptionId);
    return "cancelled";
  }

  return "not_required";
}

async function pauseStripeSubscriptions(
  fees: Array<{ stripeSubscriptionId: string | null }>
) {
  for (const fee of fees) {
    if (!fee.stripeSubscriptionId) continue;
    await getStripeClient().subscriptions.update(fee.stripeSubscriptionId, {
      pause_collection: { behavior: "void" },
    });
  }
}

async function recordBlockedBillingEnforcement(input: {
  userId: number;
  entityType: "user" | "success_fee";
  entityId: number;
  action: string;
  source: string;
  requestedAction: string;
  adminUserId: number;
  title: string;
}) {
  await createAuditEvent({
    userId: input.userId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    actor: "admin",
    source: input.source,
    afterState: JSON.stringify({
      requestedAction: input.requestedAction,
      stripeSynchronization: "failed",
      adminUserId: input.adminUserId,
      localStateChanged: false,
    }),
    riskLevel: "critical",
  });
  await createAdminReviewItem({
    userId: input.userId,
    entityType: input.entityType,
    entityId: input.entityId,
    category: "payment_failed",
    priority: "critical",
    title: input.title,
    description: "Stripe did not confirm the requested billing pause. Local enforcement state was not changed; verify each affected provider subscription before retrying because some pauses may have succeeded.",
  });
}

export const adminRouter = router({
  getOperationalFailures: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }).optional())
    .query(({ input }) => {
      return getOperationalFailureSnapshot(input?.limit ?? 20);
    }),

  getReviewQueue: adminProcedure
    .input(z.object({
      status: z.enum(["all", "open", "in_progress", "resolved", "dismissed"]).default("open"),
    }).optional())
    .query(async ({ input }) => {
      return await listAdminReviewItems(input?.status ?? "open");
    }),

  getReviewEvidence: adminProcedure
    .input(z.object({
      reviewItemId: z.number(),
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
    .input(z.object({ reviewItemId: z.number() }))
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
    .input(z.object({ reviewItemId: z.number() }))
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
      reviewItemId: z.number(),
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
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const memoryFallback = await getAdminMemoryFallback();
      if (memoryFallback) {
        return memoryFallback.fees
          .filter((fee) => input.status === "all" || fee.status === input.status)
          .slice(input.offset, input.offset + input.limit);
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const conditions =
        input.status !== "all" ? [eq(successFees.status, input.status as any)] : [];

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
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(successFees.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return fees;
    }),

  // ─── Overdue Verifications ───────────────────────────────────────────────────
  listOverdueVerifications: adminProcedure.query(async () => {
    const memoryFallback = await getAdminMemoryFallback();
    if (memoryFallback) return memoryFallback.overdue;
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const now = new Date();
    const fees = await db
      .select({
        id: successFees.id,
        userId: successFees.userId,
        employerName: successFees.employerName,
        jobTitle: successFees.jobTitle,
        monthlySalary: successFees.monthlySalary,
        monthlyFeeAmount: successFees.monthlyFeeAmount,
        status: successFees.status,
        nextVerificationDue: successFees.nextVerificationDue,
        verificationGraceExpiry: successFees.verificationGraceExpiry,
        notes: successFees.notes,
        userName: users.name,
        userEmail: users.email,
      })
      .from(successFees)
      .leftJoin(users, eq(successFees.userId, users.id))
      .where(
        and(
          or(eq(successFees.status, "active"), eq(successFees.status, "suspended")),
          isNotNull(successFees.nextVerificationDue),
          lt(successFees.nextVerificationDue, now)
        )
      )
      .orderBy(successFees.nextVerificationDue);

    return fees.map((fee) => ({
      ...fee,
      daysOverdue: fee.nextVerificationDue
        ? Math.floor((now.getTime() - fee.nextVerificationDue.getTime()) / (1000 * 60 * 60 * 24))
        : 0,
      graceExpired: fee.verificationGraceExpiry
        ? fee.verificationGraceExpiry < now
        : false,
    }));
  }),

  // ─── Update Fee Status ───────────────────────────────────────────────────────
  updateFeeStatus: adminProcedure
    .input(
      z.object({
        feeId: z.number(),
        status: z.enum(["pending_verification", "active", "paused", "ended", "suspended", "disputed"]),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [fee] = await db
        .select()
        .from(successFees)
        .where(eq(successFees.id, input.feeId))
        .limit(1);

      if (!fee) throw new TRPCError({ code: "NOT_FOUND", message: "Success fee not found" });

      let stripeSynchronization: StripeSynchronizedFeeStatus;
      try {
        stripeSynchronization = await synchronizeStripeForFeeStatusChange(fee, input.status);
      } catch {
        console.error("[Admin] Stripe synchronization blocked fee status update.");
        await createAuditEvent({
          userId: fee.userId,
          entityType: "success_fee",
          entityId: input.feeId,
          action: "success_fee_status_update_blocked_stripe_sync",
          actor: "admin",
          source: "admin.updateFeeStatus",
          beforeState: JSON.stringify({ status: fee.status }),
          afterState: JSON.stringify({
            requestedStatus: input.status,
            stripeSynchronization: "failed",
            adminUserId: ctx.user.id,
            localStatusChanged: false,
          }),
          riskLevel: "critical",
        });
        await createAdminReviewItem({
          userId: fee.userId,
          entityType: "success_fee",
          entityId: input.feeId,
          category: "payment_failed",
          priority: "critical",
          title: "Success-fee status change blocked by Stripe",
          description: "Stripe did not confirm the requested billing synchronization. The local fee status was not changed; verify the provider before retrying.",
        });
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Stripe could not synchronize this billing change. The local fee status was not changed.",
        });
      }

      await db
        .update(successFees)
        .set({
          status: input.status,
          notes: input.notes ?? fee.notes,
          endDate: input.status === "ended" ? new Date() : fee.endDate,
        })
        .where(eq(successFees.id, input.feeId));

      await createAuditEvent({
        userId: fee.userId,
        entityType: "success_fee",
        entityId: input.feeId,
        action: "success_fee_status_updated",
        actor: "admin",
        source: "admin.updateFeeStatus",
        beforeState: JSON.stringify({ status: fee.status }),
        afterState: JSON.stringify({
          status: input.status,
          notes: input.notes ?? null,
          stripeSynchronization,
          adminUserId: ctx.user.id,
        }),
        riskLevel: input.status === "suspended" || input.status === "disputed" ? "high" : "medium",
      });
      if (input.status === "suspended" || input.status === "disputed") {
        await createAdminReviewItem({
          userId: fee.userId,
          entityType: "success_fee",
          entityId: input.feeId,
          category: input.status === "disputed" ? "legal_escalation" : "verification_overdue",
          priority: input.status === "disputed" ? "critical" : "high",
          title: input.status === "disputed" ? "Disputed success fee requires admin follow-up" : "Suspended success fee requires admin review",
          description: input.notes ?? `Status changed from ${fee.status} to ${input.status}.`,
        });
      }

      return { success: true };
    }),

  // ─── Approve / Reject Verification ──────────────────────────────────────────
  reviewVerification: adminProcedure
    .input(
      z.object({
        verificationId: z.number(),
        approved: z.boolean(),
        notes: z.string().optional(),
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

      await db
        .update(employmentVerifications)
        .set({
          status: input.approved ? "approved" : "rejected",
          reviewedAt: new Date(),
          reviewNotes: input.notes ?? null,
        })
        .where(eq(employmentVerifications.id, input.verificationId));

      // If approved, update next verification due date on the fee
      if (input.approved) {
        const nextDue = calculateNextVerificationDue();
        const graceExpiry = calculateVerificationGraceExpiry(nextDue);

        await db
          .update(successFees)
          .set({
            status: "active",
            nextVerificationDue: nextDue,
            verificationGraceExpiry: graceExpiry,
          })
          .where(eq(successFees.id, verification.successFeeId));
      }

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
        userId: z.number(),
        reason: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Suspend all active fees for this user
      const userFees = await db
        .select()
        .from(successFees)
        .where(and(eq(successFees.userId, input.userId), eq(successFees.status, "active")));

      try {
        await pauseStripeSubscriptions(userFees);
      } catch {
        console.error("[Admin] Stripe synchronization blocked user suspension.");
        await recordBlockedBillingEnforcement({
          userId: input.userId,
          entityType: "user",
          entityId: input.userId,
          action: "user_suspension_blocked_stripe_sync",
          source: "admin.suspendUser",
          requestedAction: "suspend_user_and_active_success_fees",
          adminUserId: ctx.user.id,
          title: "User suspension blocked by Stripe",
        });
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Stripe could not synchronize this suspension. The local account and fee statuses were not changed.",
        });
      }

      await db
        .update(users)
        .set({ accountStatus: "suspended" })
        .where(eq(users.id, input.userId));

      for (const fee of userFees) {
        await db
          .update(successFees)
          .set({ status: "suspended", notes: `Suspended: ${input.reason}` })
          .where(eq(successFees.id, fee.id));
      }

      await createAuditEvent({
        userId: input.userId,
        entityType: "user",
        entityId: input.userId,
        action: "user_suspended",
        actor: "admin",
        source: "admin.suspendUser",
        afterState: JSON.stringify({ reason: input.reason, adminUserId: ctx.user.id }),
        riskLevel: "critical",
      });
      await createAdminReviewItem({
        userId: input.userId,
        entityType: "user",
        entityId: input.userId,
        category: "legal_escalation",
        priority: "critical",
        title: "Suspended user account requires admin follow-up",
        description: input.reason,
      });

      return { success: true };
    }),

  // ─── Reinstate User Account ──────────────────────────────────────────────────
  reinstateUser: adminProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await db
        .update(users)
        .set({ accountStatus: "active" })
        .where(eq(users.id, input.userId));

      await createAuditEvent({
        userId: input.userId,
        entityType: "user",
        entityId: input.userId,
        action: "user_reinstated",
        actor: "admin",
        source: "admin.reinstateUser",
        afterState: JSON.stringify({ accountStatus: "active", adminUserId: ctx.user.id }),
        riskLevel: "high",
      });

      return { success: true };
    }),

  // ─── Flag for Legal Escalation ───────────────────────────────────────────────
  flagLegalEscalation: adminProcedure
    .input(
      z.object({
        feeId: z.number(),
        reason: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [fee] = await db
        .select()
        .from(successFees)
        .where(eq(successFees.id, input.feeId))
        .limit(1);

      if (!fee) throw new TRPCError({ code: "NOT_FOUND", message: "Success fee not found" });

      const escalationNote = `[LEGAL ESCALATION ${new Date().toISOString()}] ${input.reason}`;
      const updatedNotes = fee.notes ? `${fee.notes}\n${escalationNote}` : escalationNote;
      const activeUserFees = await db
        .select()
        .from(successFees)
        .where(and(eq(successFees.userId, fee.userId), eq(successFees.status, "active")));
      const feesToPause = Array.from(
        new Map([...activeUserFees, fee].map((item) => [item.id, item])).values()
      );

      try {
        await pauseStripeSubscriptions(feesToPause);
      } catch {
        console.error("[Admin] Stripe synchronization blocked legal escalation.");
        await recordBlockedBillingEnforcement({
          userId: fee.userId,
          entityType: "success_fee",
          entityId: input.feeId,
          action: "legal_escalation_blocked_stripe_sync",
          source: "admin.flagLegalEscalation",
          requestedAction: "flag_legal_escalation_and_suspend_related_fees",
          adminUserId: ctx.user.id,
          title: "Legal escalation blocked by Stripe",
        });
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Stripe could not synchronize this legal escalation. The local account and fee statuses were not changed.",
        });
      }

      await db
        .update(successFees)
        .set({
          status: "disputed",
          notes: updatedNotes,
        })
        .where(eq(successFees.id, input.feeId));

      const relatedSuspensionNote = `Suspended: legal escalation on success fee #${input.feeId}.`;
      const relatedActiveFees = activeUserFees.filter((activeFee) => activeFee.id !== input.feeId);
      for (const relatedFee of relatedActiveFees) {
        const relatedNotes = relatedFee.notes
          ? `${relatedFee.notes}\n${relatedSuspensionNote}`
          : relatedSuspensionNote;
        await db
          .update(successFees)
          .set({ status: "suspended", notes: relatedNotes })
          .where(eq(successFees.id, relatedFee.id));
        await createAuditEvent({
          userId: fee.userId,
          entityType: "success_fee",
          entityId: relatedFee.id,
          action: "success_fee_suspended_for_legal_escalation",
          actor: "admin",
          source: "admin.flagLegalEscalation",
          beforeState: JSON.stringify({ status: relatedFee.status }),
          afterState: JSON.stringify({
            status: "suspended",
            escalatedFeeId: input.feeId,
            accountStatus: "suspended",
            adminUserId: ctx.user.id,
          }),
          riskLevel: "critical",
        });
      }

      // Suspend user account
      await db
        .update(users)
        .set({ accountStatus: "suspended" })
        .where(eq(users.id, fee.userId));

      await createAuditEvent({
        userId: fee.userId,
        entityType: "success_fee",
        entityId: input.feeId,
        action: "legal_escalation_flagged",
        actor: "admin",
        source: "admin.flagLegalEscalation",
        beforeState: JSON.stringify({ status: fee.status }),
        afterState: JSON.stringify({
          status: "disputed",
          accountStatus: "suspended",
          reason: input.reason,
          adminUserId: ctx.user.id,
        }),
        riskLevel: "critical",
      });
      await createAdminReviewItem({
        userId: fee.userId,
        entityType: "success_fee",
        entityId: input.feeId,
        category: "legal_escalation",
        priority: "critical",
        title: "Legal escalation flagged",
        description: input.reason,
      });

      return { success: true, escalationNote };
    }),

  // ─── List Pending Verifications ──────────────────────────────────────────────
  listPendingVerifications: adminProcedure.query(async () => {
    const memoryFallback = await getAdminMemoryFallback();
    if (memoryFallback) return memoryFallback.pendingVerifications;
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const verifications = await db
      .select({
        id: employmentVerifications.id,
        successFeeId: employmentVerifications.successFeeId,
        userId: employmentVerifications.userId,
        verificationType: employmentVerifications.verificationType,
        documentUrl: employmentVerifications.documentUrl,
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
      .where(eq(employmentVerifications.status, "pending"))
      .orderBy(desc(employmentVerifications.submittedAt));

    return verifications;
  }),

  // ─── Payment History ─────────────────────────────────────────────────────────
  listPayments: adminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const memoryFallback = await getAdminMemoryFallback();
      if (memoryFallback) {
        return memoryFallback.payments.slice(input.offset, input.offset + input.limit);
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const payments = await db
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
          userName: users.name,
          userEmail: users.email,
          employerName: successFees.employerName,
        })
        .from(feePayments)
        .leftJoin(users, eq(feePayments.userId, users.id))
        .leftJoin(successFees, eq(feePayments.successFeeId, successFees.id))
        .orderBy(desc(feePayments.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return payments;
    }),

  // ─── Add Admin Note ──────────────────────────────────────────────────────────
  addNote: adminProcedure
    .input(
      z.object({
        feeId: z.number(),
        note: z.string().min(1),
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
