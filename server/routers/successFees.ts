import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import {
  createAdminReviewItem,
  createAuditEvent,
  dismissOfferAttributionAdminReviews,
  getDb,
  getUserOfferAttributionReviews,
  getUserSuccessFees,
} from "../db";
import { applicationApprovals, applications, successFees, employmentVerifications, feePayments, users, type SuccessFee } from "../../drizzle/schema";
import { eq, desc, and, inArray } from "drizzle-orm";
import { isAcceptedOfferApplicationStatus } from "@shared/offerEligibility";
import { storagePut } from "../storage";
import { validateUploadedFile, VERIFICATION_MIME_TYPES } from "../uploadValidation";
import { getStripeClient } from "../stripeClient";
import { calculateNextVerificationDue } from "../successFeeDates";

const MIN_MONTHLY_SALARY = 300; // USD
const FEE_PERCENT = 5;
const UNRESOLVED_SUCCESS_FEE_STATUSES = [
  "pending_verification",
  "active",
  "paused",
  "suspended",
  "disputed",
] as const;
const EMPLOYMENT_END_REPORTABLE_STATUSES = new Set(["pending_verification", "active"]);
const calendarDate = z.string().trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a calendar date in YYYY-MM-DD format.")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  }, "Use a real calendar date.");

function assertSuccessFeeTermsAccepted(user: {
  tosAcceptedAt?: Date | null;
  accountStatus?: string | null;
}) {
  if (user.accountStatus && user.accountStatus !== "active") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Success-fee actions are unavailable while this account is not active.",
    });
  }
  if (!user.tosAcceptedAt) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Accept the Terms of Service before managing success-fee, verification, or billing actions.",
    });
  }
}

// Helper: get or create Stripe customer for user
async function getOrCreateStripeCustomer(userId: number, email: string, name: string | null) {
  const stripe = getStripeClient();
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  
  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  const customer = await stripe.customers.create({
    email,
    name: name ?? undefined,
    metadata: { userId: userId.toString() },
  });

  await db.update(users).set({ stripeCustomerId: customer.id }).where(eq(users.id, userId));
  return customer.id;
}

// Helper: calculate monthly fee amount in cents
function calculateMonthlyFee(monthlySalary: number): number {
  return Math.round((monthlySalary * FEE_PERCENT) / 100 * 100); // in cents
}

function billingReturnUrl(params: Record<string, string>) {
  const baseUrl = process.env.VITE_FRONTEND_FORGE_API_URL?.trim() || "http://localhost:3000";
  const url = new URL("/billing", baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function ensureSuccessFeeStripePrice(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  fee: Pick<SuccessFee, "id" | "userId" | "employerName" | "monthlyFeeAmount" | "currency" | "stripePriceId">
) {
  if (fee.stripePriceId) return fee.stripePriceId;

  const stripe = getStripeClient();
  const product = await stripe.products.create({
    name: `Hire.AI Success Fee - ${fee.employerName}`,
    metadata: {
      userId: fee.userId.toString(),
      successFeeId: fee.id.toString(),
      employerName: fee.employerName,
    },
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: fee.monthlyFeeAmount,
    currency: fee.currency.toLowerCase(),
    recurring: { interval: "month" },
    metadata: { successFeeId: fee.id.toString() },
  });

  await db.update(successFees)
    .set({ stripePriceId: price.id })
    .where(eq(successFees.id, fee.id));
  return price.id;
}

async function createSuccessFeeCheckoutSession(params: {
  stripeCustomerId: string;
  fee: Pick<SuccessFee, "id" | "userId" | "employerName">;
  stripePriceId: string;
}) {
  const checkoutSession = await getStripeClient().checkout.sessions.create({
    mode: "subscription",
    customer: params.stripeCustomerId,
    line_items: [{ price: params.stripePriceId, quantity: 1 }],
    client_reference_id: String(params.fee.id),
    metadata: {
      userId: params.fee.userId.toString(),
      successFeeId: params.fee.id.toString(),
      employerName: params.fee.employerName,
    },
    subscription_data: {
      metadata: {
        userId: params.fee.userId.toString(),
        successFeeId: params.fee.id.toString(),
        employerName: params.fee.employerName,
      },
    },
    success_url: billingReturnUrl({ checkout: "success", session_id: "{CHECKOUT_SESSION_ID}" }),
    cancel_url: billingReturnUrl({ checkout: "cancelled" }),
  });
  if (!checkoutSession.url) {
    throw new Error("Stripe did not return a secure checkout URL.");
  }
  return checkoutSession;
}

export const successFeesRouter = router({
  // Report a new hire and set up success fee
  reportHire: protectedProcedure
    .input(z.object({
      employerName: z.string().min(1).max(255),
      jobTitle: z.string().min(1).max(255),
      monthlySalary: z.number().min(MIN_MONTHLY_SALARY, `Minimum salary is $${MIN_MONTHLY_SALARY}/month`),
      currency: z.string().default("USD"),
      startDate: calendarDate,
      applicationId: z.number().optional(),
      offerLetterBase64: z.string().min(1, "Offer letter is required"),
      offerLetterMimeType: z.string().default("application/pdf"),
      offerLetterFileName: z.string().default("offer_letter.pdf"),
      termsAccepted: z.boolean().refine(v => v === true, "You must accept the terms"),
    }))
    .mutation(async ({ ctx, input }) => {
      assertSuccessFeeTermsAccepted(ctx.user);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const userId = ctx.user.id;

      if (input.applicationId !== undefined) {
        const linkedApplication = await db
          .select({ id: applications.id, status: applications.status })
          .from(applications)
          .where(and(eq(applications.id, input.applicationId), eq(applications.userId, userId)))
          .limit(1);

        if (!linkedApplication[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Linked application not found." });
        }
        if (!isAcceptedOfferApplicationStatus(linkedApplication[0].status)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A linked application can be reported as a hire only after the user confirms offer acceptance.",
          });
        }
      }

      const linkedOfferAttributionApproval = input.applicationId === undefined
        ? null
        : (await db
          .select({ id: applicationApprovals.id, status: applicationApprovals.status })
          .from(applicationApprovals)
          .where(and(
            eq(applicationApprovals.userId, userId),
            eq(applicationApprovals.entityType, "application"),
            eq(applicationApprovals.entityId, input.applicationId),
            eq(applicationApprovals.approvalType, "offer_attribution")
          ))
          .orderBy(desc(applicationApprovals.createdAt))
          .limit(1))[0] ?? null;

      if (
        linkedOfferAttributionApproval?.status === "rejected" ||
        linkedOfferAttributionApproval?.status === "cancelled"
      ) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Offer attribution approval was rejected or cancelled for this application.",
        });
      }

      // Any non-terminal fee may already hold offer proof or a Stripe subscription.
      // Do not allow a retry to create a second fee while the existing ledger record is unresolved.
      const existingFee = await db
        .select()
        .from(successFees)
        .where(
          and(
            eq(successFees.userId, userId),
            eq(successFees.employerName, input.employerName),
            inArray(successFees.status, UNRESOLVED_SUCCESS_FEE_STATUSES)
          )
        )
        .limit(1);

      if (existingFee.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "You already have an unresolved success fee for this employer.",
        });
      }

      // Upload offer letter to S3
      const fileBuffer = Buffer.from(input.offerLetterBase64, "base64");
      const validation = validateUploadedFile({
        data: fileBuffer,
        fileName: input.offerLetterFileName,
        mimeType: input.offerLetterMimeType,
        allowedMimeTypes: VERIFICATION_MIME_TYPES,
      });
      const fileKey = `offer-letters/${userId}-${Date.now()}-${validation.fileName}`;
      await storagePut(fileKey, fileBuffer, input.offerLetterMimeType);
      const offerLetterUrl = `private://${fileKey}`;

      // Calculate fee
      const monthlyFeeAmount = calculateMonthlyFee(input.monthlySalary);
      const startDate = new Date(`${input.startDate}T00:00:00.000Z`);

      // Set next verification due date (90 UTC days from start)
      const nextVerificationDue = calculateNextVerificationDue(startDate);

      // Create success fee record
      const [fee] = await db.insert(successFees).values({
        userId,
        applicationId: input.applicationId ?? null,
        employerName: input.employerName,
        jobTitle: input.jobTitle,
        monthlySalary: input.monthlySalary,
        currency: input.currency,
        feePercent: FEE_PERCENT,
        monthlyFeeAmount,
        status: "pending_verification",
        startDate,
        nextVerificationDue,
        offerLetterUrl,
        offerLetterKey: fileKey,
        termsAcceptedAt: new Date(),
      }).$returningId();

      // Create initial verification record
      await db.insert(employmentVerifications).values({
        successFeeId: fee.id,
        userId,
        verificationType: "initial",
        documentUrl: offerLetterUrl,
        documentKey: fileKey,
        documentType: "offer_letter",
        status: "pending",
        submittedAt: new Date(),
      });

      const approvalDecidedAt = new Date();
      let offerAttributionApprovalId: number;
      if (input.applicationId !== undefined) {
        if (linkedOfferAttributionApproval) {
          offerAttributionApprovalId = linkedOfferAttributionApproval.id;
          if (linkedOfferAttributionApproval.status === "pending") {
            await db
              .update(applicationApprovals)
              .set({
                status: "approved",
                decidedBy: "user",
                decisionNote: "Approved through report-hire success fee flow.",
                decidedAt: approvalDecidedAt,
              })
              .where(eq(applicationApprovals.id, linkedOfferAttributionApproval.id));
          }
        } else {
          const attributionApproval = await db.insert(applicationApprovals).values({
            userId,
            applicationId: input.applicationId,
            entityType: "application",
            entityId: input.applicationId,
            approvalType: "offer_attribution",
            status: "approved",
            riskLevel: "high",
            requestedBy: "user",
            decidedBy: "user",
            title: "Offer attribution confirmed",
            description: `User reported hire at ${input.employerName} for ${input.jobTitle}.`,
            payload: JSON.stringify({
              successFeeId: fee.id,
              employerName: input.employerName,
              jobTitle: input.jobTitle,
              monthlySalary: input.monthlySalary,
            }),
            decisionNote: "Approved through report-hire success fee flow.",
            requestedAt: approvalDecidedAt,
            decidedAt: approvalDecidedAt,
          });
          offerAttributionApprovalId = Number(attributionApproval[0].insertId);
        }
      } else {
        const attributionApproval = await db.insert(applicationApprovals).values({
          userId,
          applicationId: null,
          entityType: "success_fee",
          entityId: fee.id,
          approvalType: "offer_attribution",
          status: "approved",
          riskLevel: "high",
          requestedBy: "user",
          decidedBy: "user",
          title: "Offer attribution reported without linked application",
          description: `User reported hire at ${input.employerName} for ${input.jobTitle}.`,
          payload: JSON.stringify({
            successFeeId: fee.id,
            employerName: input.employerName,
            jobTitle: input.jobTitle,
            monthlySalary: input.monthlySalary,
          }),
          decisionNote: "User reported hire without an application link.",
          requestedAt: approvalDecidedAt,
          decidedAt: approvalDecidedAt,
        });
        offerAttributionApprovalId = Number(attributionApproval[0].insertId);
      }

      const billingApproval = await db.insert(applicationApprovals).values({
        userId,
        applicationId: input.applicationId ?? null,
        entityType: "billing",
        entityId: fee.id,
        approvalType: "billing_action",
        status: "approved",
        riskLevel: "critical",
        requestedBy: "user",
        decidedBy: "user",
        title: "Success fee subscription setup approved",
        description: `User accepted success-fee terms for ${input.employerName}.`,
        payload: JSON.stringify({
          successFeeId: fee.id,
          employerName: input.employerName,
          monthlyFeeAmount,
          feePercent: FEE_PERCENT,
        }),
        decisionNote: "User accepted success-fee terms before Stripe subscription setup.",
        requestedAt: approvalDecidedAt,
        decidedAt: approvalDecidedAt,
      });
      const billingApprovalId = Number(billingApproval[0].insertId);

      await createAuditEvent({
        userId,
        entityType: "success_fee",
        entityId: fee.id,
        action: "hire_reported",
        actor: "user",
        source: "successFees.reportHire",
        afterState: JSON.stringify({
          applicationId: input.applicationId ?? null,
          employerName: input.employerName,
          jobTitle: input.jobTitle,
          monthlySalary: input.monthlySalary,
          status: "pending_verification",
        }),
        riskLevel: "high",
        approvalId: offerAttributionApprovalId,
      });
      await createAuditEvent({
        userId,
        entityType: "success_fee",
        entityId: fee.id,
        action: "billing_action_approved",
        actor: "user",
        source: "successFees.reportHire",
        afterState: JSON.stringify({
          monthlyFeeAmount,
          feePercent: FEE_PERCENT,
          stripeSubscriptionSetup: "approved",
        }),
        riskLevel: "critical",
        approvalId: billingApprovalId,
      });
      const dismissedSourceOfferReviewIds = input.applicationId === undefined
        ? []
        : (await dismissOfferAttributionAdminReviews(
          userId,
          input.applicationId,
          "Superseded by the user's report-hire flow; continue review on the linked success-fee record."
        )).dismissedReviewIds;
      if (dismissedSourceOfferReviewIds.length > 0 && input.applicationId !== undefined) {
        await createAuditEvent({
          userId,
          entityType: "application",
          entityId: input.applicationId,
          action: "offer_attribution_review_superseded_by_hire_report",
          actor: "system",
          source: "successFees.reportHire",
          afterState: JSON.stringify({
            successFeeId: fee.id,
            dismissedSourceOfferReviewIds,
            successorReviewEntityType: "success_fee",
            externalCommunicationSent: false,
          }),
          riskLevel: "high",
          approvalId: offerAttributionApprovalId,
        });
      }
      await createAdminReviewItem({
        userId,
        entityType: "success_fee",
        entityId: fee.id,
        category: "offer_attribution",
        priority: "high",
        title: "Reported hire needs offer attribution review",
        description: `Reported hire at ${input.employerName} for ${input.jobTitle}.`,
      });

      let checkoutUrl: string | null = null;
      try {
        const stripeCustomerId = await getOrCreateStripeCustomer(
          userId,
          ctx.user.email ?? "",
          ctx.user.name
        );
        const stripePriceId = await ensureSuccessFeeStripePrice(db, {
          ...fee,
          userId,
          employerName: input.employerName,
          monthlyFeeAmount,
          currency: input.currency,
          stripePriceId: null,
        });
        const checkoutSession = await createSuccessFeeCheckoutSession({
          stripeCustomerId,
          fee: { id: fee.id, userId, employerName: input.employerName },
          stripePriceId,
        });
        checkoutUrl = checkoutSession.url;

        // The subscription ID is linked only by the signed Checkout webhook.
        await db.update(successFees)
          .set({ stripeCheckoutSessionId: checkoutSession.id })
          .where(eq(successFees.id, fee.id));
      } catch {
        console.error("[SuccessFees] Checkout creation failed after the hire report was recorded.");
        await createAuditEvent({
          userId,
          entityType: "success_fee",
          entityId: fee.id,
          action: "success_fee_checkout_creation_failed",
          actor: "system",
          source: "successFees.reportHire",
          afterState: JSON.stringify({
            localHireReportRecorded: true,
            stripeSubscriptionCreated: false,
            checkoutSessionAvailable: false,
          }),
          riskLevel: "critical",
          approvalId: billingApprovalId,
        });
        await createAdminReviewItem({
          userId,
          entityType: "success_fee",
          entityId: fee.id,
          category: "payment_failed",
          priority: "critical",
          title: "Success-fee Checkout unavailable",
          description: "The hire report and proof ledger were recorded, but Stripe Checkout was unavailable. Verify provider configuration before the user retries billing setup.",
        });
      }

      return {
        feeId: fee.id,
        monthlyFeeAmount,
        checkoutUrl,
        subscriptionStatus: checkoutUrl ? "checkout_open" as const : "checkout_unavailable" as const,
        ledger: {
          offerProofStatus: "stored" as const,
          offerAttributionStatus: "admin_review_open" as const,
          verificationStatus: "pending_review" as const,
          billingSetupStatus: checkoutUrl ? "checkout_required" as const : "checkout_unavailable" as const,
          adminReviewRequired: true,
          offerAttributionApprovalId,
          billingApprovalId,
        },
      };
    }),

  // Get user's success fees
  getMyFees: protectedProcedure.query(async ({ ctx }) => {
    return await getUserSuccessFees(ctx.user.id);
  }),

  // Reopen an expired Checkout flow without creating another success-fee record.
  retryBillingCheckout: protectedProcedure
    .input(z.object({
      successFeeId: z.number().int().positive(),
      confirmBillingSetup: z.literal(true),
    }).strict())
    .mutation(async ({ ctx, input }) => {
      assertSuccessFeeTermsAccepted(ctx.user);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const userId = ctx.user.id;
      const [fee] = await db
        .select()
        .from(successFees)
        .where(and(eq(successFees.id, input.successFeeId), eq(successFees.userId, userId)))
        .limit(1);

      if (!fee) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Success fee not found." });
      }
      if (fee.stripeSubscriptionId) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This success fee already has a Stripe subscription. Use the Billing Portal for subscription changes.",
        });
      }
      if (fee.status !== "pending_verification" || !fee.termsAcceptedAt) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Only a pending, terms-approved success fee can reopen Checkout.",
        });
      }

      let checkoutUrl: string | null = null;
      let checkoutSource: "reused_open_session" | "replaced_expired_session" | "created_session" = "created_session";
      if (fee.stripeCheckoutSessionId) {
        try {
          const existingSession = await getStripeClient().checkout.sessions.retrieve(fee.stripeCheckoutSessionId);
          if (existingSession.status === "open" && existingSession.url) {
            checkoutUrl = existingSession.url;
            checkoutSource = "reused_open_session";
          } else if (existingSession.status === "complete") {
            await createAdminReviewItem({
              userId,
              entityType: "success_fee",
              entityId: fee.id,
              category: "payment_failed",
              priority: "critical",
              title: "Completed Checkout awaits reconciliation",
              description: "Stripe reports Checkout completed but the subscription has not reached the success-fee ledger. Review signed webhook delivery before creating another Checkout session.",
            });
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "Checkout is complete but still awaiting ledger reconciliation. A new billing session was not created.",
            });
          } else if (existingSession.status !== "expired") {
            throw new Error("Stored Checkout session is not safely recoverable.");
          }
          if (existingSession.status === "expired") checkoutSource = "replaced_expired_session";
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          console.error("[SuccessFees] Stored Checkout session could not be verified for recovery.");
          await createAuditEvent({
            userId,
            entityType: "success_fee",
            entityId: fee.id,
            action: "success_fee_checkout_recovery_blocked",
            actor: "system",
            source: "successFees.retryBillingCheckout",
            afterState: JSON.stringify({
              checkoutSessionId: fee.stripeCheckoutSessionId,
              localStateChanged: false,
              stripeSubscriptionCreated: false,
            }),
            riskLevel: "critical",
          });
          await createAdminReviewItem({
            userId,
            entityType: "success_fee",
            entityId: fee.id,
            category: "payment_failed",
            priority: "critical",
            title: "Checkout recovery blocked pending verification",
            description: "The prior Stripe Checkout session could not be verified. Do not create another billing session until the provider state is reconciled.",
          });
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Hire.AI could not verify the prior Checkout session, so a duplicate billing flow was not created.",
          });
        }
      }

      if (!checkoutUrl) {
        try {
          const stripeCustomerId = await getOrCreateStripeCustomer(userId, ctx.user.email ?? "", ctx.user.name);
          const stripePriceId = await ensureSuccessFeeStripePrice(db, fee);
          const checkoutSession = await createSuccessFeeCheckoutSession({ stripeCustomerId, fee, stripePriceId });
          checkoutUrl = checkoutSession.url;
          await db.update(successFees)
            .set({ stripeCheckoutSessionId: checkoutSession.id })
            .where(eq(successFees.id, fee.id));
        } catch {
          console.error("[SuccessFees] Checkout recovery could not create a secure session.");
          await createAuditEvent({
            userId,
            entityType: "success_fee",
            entityId: fee.id,
            action: "success_fee_checkout_recovery_failed",
            actor: "system",
            source: "successFees.retryBillingCheckout",
            afterState: JSON.stringify({
              checkoutSource,
              localStateChanged: false,
              stripeSubscriptionCreated: false,
            }),
            riskLevel: "critical",
          });
          await createAdminReviewItem({
            userId,
            entityType: "success_fee",
            entityId: fee.id,
            category: "payment_failed",
            priority: "critical",
            title: "Success-fee Checkout recovery failed",
            description: "Stripe could not create a new Checkout session after the prior session expired or was unavailable. The fee record was preserved and no subscription was created.",
          });
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Stripe Checkout is unavailable. No subscription or duplicate fee was created.",
          });
        }
      }

      const decidedAt = new Date();
      const approval = await db.insert(applicationApprovals).values({
        userId,
        applicationId: fee.applicationId ?? null,
        entityType: "billing",
        entityId: fee.id,
        approvalType: "billing_action",
        status: "approved",
        riskLevel: "critical",
        requestedBy: "user",
        decidedBy: "user",
        title: "Success-fee Checkout recovery approved",
        description: `User explicitly reopened secure Checkout for ${fee.employerName}.`,
        payload: JSON.stringify({ successFeeId: fee.id, checkoutSource }),
        decisionNote: "User explicitly approved reopening Stripe Checkout; subscription creation remains within Stripe Checkout.",
        requestedAt: decidedAt,
        decidedAt,
      });
      const approvalId = Number(approval[0].insertId);
      await createAuditEvent({
        userId,
        entityType: "success_fee",
        entityId: fee.id,
        action: "success_fee_checkout_reopened",
        actor: "user",
        source: "successFees.retryBillingCheckout",
        afterState: JSON.stringify({ checkoutSource, stripeSubscriptionCreated: false, checkoutSessionAvailable: true }),
        riskLevel: "critical",
        approvalId,
      });

      return { feeId: fee.id, checkoutUrl, checkoutSource, billingApprovalId: approvalId };
    }),

  // Show offer responses/approvals that should be converted into reported hires.
  getOfferAttributionReviews: protectedProcedure.query(async ({ ctx }) => {
    return await getUserOfferAttributionReviews(ctx.user.id);
  }),

  // Get fee payments history
  getPaymentHistory: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    const payments = await db
      .select()
      .from(feePayments)
      .where(eq(feePayments.userId, ctx.user.id))
      .orderBy(desc(feePayments.createdAt));

    return payments;
  }),

  // Submit quarterly verification document
  submitVerification: protectedProcedure
    .input(z.object({
      successFeeId: z.number(),
      documentBase64: z.string().min(1),
      documentMimeType: z.string().default("application/pdf"),
      documentFileName: z.string().default("verification.pdf"),
      documentType: z.enum(["paystub", "employment_letter", "bank_statement", "other"]),
    }))
    .mutation(async ({ ctx, input }) => {
      assertSuccessFeeTermsAccepted(ctx.user);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const userId = ctx.user.id;

      // Verify the fee belongs to this user
      const [fee] = await db
        .select()
        .from(successFees)
        .where(and(eq(successFees.id, input.successFeeId), eq(successFees.userId, userId)))
        .limit(1);

      if (!fee) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Success fee not found." });
      }

      // Upload document
      const fileBuffer = Buffer.from(input.documentBase64, "base64");
      const validation = validateUploadedFile({
        data: fileBuffer,
        fileName: input.documentFileName,
        mimeType: input.documentMimeType,
        allowedMimeTypes: VERIFICATION_MIME_TYPES,
      });
      const fileKey = `verifications/${userId}-${Date.now()}-${validation.fileName}`;
      await storagePut(fileKey, fileBuffer, input.documentMimeType);
      const documentUrl = `private://${fileKey}`;

      // Create verification record. Do not extend the next verification due date here.
      // The deadline should only move after an admin approves the submitted document.
      const verificationResult = await db.insert(employmentVerifications).values({
        successFeeId: input.successFeeId,
        userId,
        verificationType: "quarterly",
        documentUrl,
        documentKey: fileKey,
        documentType: input.documentType,
        status: "pending",
        submittedAt: new Date(),
      });
      const verificationId = Number(verificationResult[0].insertId);

      await createAuditEvent({
        userId,
        entityType: "verification",
        entityId: verificationId,
        action: "employment_verification_submitted",
        actor: "user",
        source: "successFees.submitVerification",
        afterState: JSON.stringify({
          successFeeId: input.successFeeId,
          documentType: input.documentType,
          status: "pending",
          nextVerificationDue: fee.nextVerificationDue ?? null,
        }),
        riskLevel: "high",
      });
      await createAdminReviewItem({
        userId,
        entityType: "verification",
        entityId: verificationId,
        category: "verification_overdue",
        priority: "high",
        title: "Quarterly employment verification submitted",
        description: `User submitted ${input.documentType.replace(/_/g, " ")} proof for ${fee.employerName}. Admin approval is required before the next verification deadline moves.`,
      });

      return { success: true, status: "pending_review" as const, verificationId };
    }),

  // Report employment ended (user left job)
  reportEmploymentEnded: protectedProcedure
    .input(z.object({
      successFeeId: z.number(),
      endDate: z.string().datetime({ offset: true }),
    }))
    .mutation(async ({ ctx, input }) => {
      assertSuccessFeeTermsAccepted(ctx.user);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const userId = ctx.user.id;

      const [fee] = await db
        .select()
        .from(successFees)
        .where(and(eq(successFees.id, input.successFeeId), eq(successFees.userId, userId)))
        .limit(1);

      if (!fee) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Success fee not found." });
      }

      if (!EMPLOYMENT_END_REPORTABLE_STATUSES.has(fee.status)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Only active or pending-verification success fees can be reported as employment ended.",
        });
      }

      const endDate = new Date(input.endDate);
      const decidedAt = new Date();
      const previousState = {
        status: fee.status,
        endDate: fee.endDate ?? null,
        stripeSubscriptionId: fee.stripeSubscriptionId ?? null,
        employerName: fee.employerName,
        jobTitle: fee.jobTitle,
      };

      // A timeout can still leave the provider in an uncertain state. Do not
      // record a completed local billing action unless Stripe confirms it.
      let stripeSubscriptionCancelled = false;
      if (fee.stripeSubscriptionId) {
        try {
          await getStripeClient().subscriptions.cancel(fee.stripeSubscriptionId);
          stripeSubscriptionCancelled = true;
        } catch {
          console.error("[SuccessFees] Stripe synchronization blocked employment-end reporting.");
          await createAuditEvent({
            userId,
            entityType: "success_fee",
            entityId: input.successFeeId,
            action: "employment_end_blocked_stripe_sync",
            actor: "user",
            source: "successFees.reportEmploymentEnded",
            beforeState: JSON.stringify(previousState),
            afterState: JSON.stringify({
              requestedStatus: "ended",
              endDate,
              stripeSynchronization: "failed",
              localStateChanged: false,
            }),
            riskLevel: "critical",
          });
          await createAdminReviewItem({
            userId,
            entityType: "success_fee",
            entityId: input.successFeeId,
            category: "payment_failed",
            priority: "critical",
            title: "Employment end blocked by Stripe",
            description: "Stripe did not confirm cancellation of the linked subscription. Local fee status and billing approval were not changed; verify the provider before retrying because cancellation may have succeeded.",
          });
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Stripe could not confirm subscription cancellation. The local fee status and billing approval were not changed.",
          });
        }
      }

      const billingApproval = await db.insert(applicationApprovals).values({
        userId,
        applicationId: fee.applicationId ?? null,
        entityType: "billing",
        entityId: input.successFeeId,
        approvalType: "billing_action",
        status: "approved",
        riskLevel: "high",
        requestedBy: "user",
        decidedBy: "user",
        title: "Employment end reported",
        description: `User reported employment ended at ${fee.employerName}.`,
        payload: JSON.stringify({
          successFeeId: input.successFeeId,
          employerName: fee.employerName,
          jobTitle: fee.jobTitle,
          endDate,
          previousStatus: fee.status,
          stripeSubscriptionId: fee.stripeSubscriptionId ?? null,
        }),
        decisionNote: "User reported employment ended; final billing and verification require admin review.",
        requestedAt: decidedAt,
        decidedAt,
      });
      const billingApprovalId = Number(billingApproval[0].insertId);

      // Update fee status
      await db.update(successFees)
        .set({ status: "ended", endDate })
        .where(eq(successFees.id, input.successFeeId));

      await createAuditEvent({
        userId,
        entityType: "success_fee",
        entityId: input.successFeeId,
        action: "employment_ended_reported",
        actor: "user",
        source: "successFees.reportEmploymentEnded",
        beforeState: JSON.stringify(previousState),
        afterState: JSON.stringify({
          status: "ended",
          endDate,
          stripeSubscriptionCancelled,
          adminReviewRequired: true,
        }),
        riskLevel: "high",
        approvalId: billingApprovalId,
      });
      await createAdminReviewItem({
        userId,
        entityType: "success_fee",
        entityId: input.successFeeId,
        category: "employment_ended",
        priority: "high",
        title: "Employment ended report needs review",
        description: `Employment at ${fee.employerName} for ${fee.jobTitle} was reported ended on ${input.endDate}. Review final billing, subscription cancellation, and verification context.`,
      });

      return {
        success: true,
        status: "pending_admin_review" as const,
        endedAt: endDate,
        stripeSubscriptionCancelled,
        approvalId: billingApprovalId,
      };
    }),

  // Get verifications for a fee
  getFeeVerifications: protectedProcedure
    .input(z.object({ successFeeId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      const verifications = await db
        .select()
        .from(employmentVerifications)
        .where(
          and(
            eq(employmentVerifications.successFeeId, input.successFeeId),
            eq(employmentVerifications.userId, ctx.user.id)
          )
        )
        .orderBy(desc(employmentVerifications.submittedAt));

      return verifications;
    }),

  // Get Stripe billing portal URL
  getBillingPortalUrl: protectedProcedure.mutation(async ({ ctx }) => {
    const stripe = getStripeClient();
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const [user] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);

    if (!user.stripeCustomerId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "No billing account found." });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${process.env.VITE_FRONTEND_FORGE_API_URL ?? "http://localhost:3000"}/billing`,
    });

    return { url: session.url };
  }),
});
