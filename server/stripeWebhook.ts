import express, { type Express } from "express";
import Stripe from "stripe";
import { getDb } from "./db";
import {
  adminReviewItems,
  auditEvents,
  feePayments,
  stripeWebhookEvents,
  successFees,
  users,
  type SuccessFee,
} from "../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { getStripeClient } from "./stripeClient";
import {
  claimStripeWebhookEvent,
  failStripeWebhookEvent,
  quarantineStripeWebhookEvent,
} from "./stripeWebhookLedger";
import { canTransitionSuccessFeeStatus } from "./successFeeStateMachine";
import { addSuccessFeeHold, refreshSuccessFeeEffectiveStatus, resolveSuccessFeeHolds } from "./successFeeHolds";
import { logOperationalFailure } from "./operationalFailureLog";
import {
  transitionStripeInvoicePaymentStatus,
  validateStripeCustomerIdentity,
  validateStripeInvoiceIdentity,
  validateStripeSubscriptionIdentity,
  type StripeFeeIdentity,
} from "./stripeBillingIdentity";

const failedResponse = "Webhook processing failed";

class StripeWebhookQuarantineError extends Error {
  constructor(readonly reasonCode: string) {
    super("Stripe event requires manual reconciliation.");
  }
}

function quarantine(reasonCode: string): never {
  throw new StripeWebhookQuarantineError(reasonCode);
}

function idOf(value: string | { id?: string | null } | null | undefined) {
  if (typeof value === "string" && value.length > 0) return value;
  if (!value || typeof value !== "object") return null;
  return typeof value.id === "string" && value.id.length > 0 ? value.id : null;
}

function invoiceSubscriptionId(invoice: Stripe.Invoice) {
  const expanded = invoice as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
    parent?: {
      subscription_details?: {
        subscription?: string | Stripe.Subscription | null;
      };
    } | null;
  };
  return (
    idOf(expanded.subscription) ??
    idOf(expanded.parent?.subscription_details?.subscription)
  );
}

function identityForFee(
  fee: SuccessFee,
  customerId: string | null
): StripeFeeIdentity {
  return {
    stripeCustomerId: customerId,
    stripePriceId: fee.stripePriceId,
    monthlyFeeAmount: fee.monthlyFeeAmount,
    currency: fee.currency,
  };
}

function requireIdentity(error: string | null) {
  if (error) quarantine(error);
}

async function getCompleteInvoiceLines(invoice: Stripe.Invoice) {
  const embedded = invoice.lines;
  if (embedded && Array.isArray(embedded.data) && !embedded.has_more)
    return embedded;

  const data = [...(embedded?.data ?? [])];
  let cursor = data.at(-1)?.id;
  let hasMore = true;
  let pages = 0;
  while (hasMore) {
    if (++pages > 100)
      throw new Error(
        "Stripe invoice has too many line-item pages to validate safely."
      );
    const page = await getStripeClient().invoices.listLineItems(invoice.id, {
      limit: 100,
      ...(cursor ? { starting_after: cursor } : {}),
    });
    if (!page.data.length || page.data.at(-1)?.id === cursor) {
      throw new Error("Stripe returned incomplete invoice lines.");
    }
    data.push(...page.data);
    cursor = page.data.at(-1)?.id;
    hasMore = page.has_more;
  }
  return { data, has_more: false };
}

async function addAudit(
  tx: Parameters<
    Parameters<NonNullable<Awaited<ReturnType<typeof getDb>>>["transaction"]>[0]
  >[0],
  input: {
    fee: Pick<SuccessFee, "userId" | "id">;
    action: string;
    event: Stripe.Event;
    beforeState?: unknown;
    afterState: unknown;
    riskLevel: "high" | "critical";
  }
) {
  await tx.insert(auditEvents).values({
    userId: input.fee.userId,
    entityType: "success_fee",
    entityId: input.fee.id,
    action: input.action,
    actor: "system",
    source: `stripe:${input.event.type}`,
    beforeState:
      input.beforeState === undefined
        ? null
        : JSON.stringify(input.beforeState),
    afterState: JSON.stringify(input.afterState),
    riskLevel: input.riskLevel,
  });
}

export function registerStripeWebhook(app: Express) {
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {
      const signature = req.headers["stripe-signature"] as string | undefined;
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      let event: Stripe.Event;

      try {
        if (webhookSecret && signature) {
          event = getStripeClient().webhooks.constructEvent(
            req.body,
            signature,
            webhookSecret
          );
        } else if (
          process.env.NODE_ENV !== "production" &&
          !webhookSecret &&
          !signature
        ) {
          event = JSON.parse(req.body.toString()) as Stripe.Event;
        } else {
          throw new Error("Stripe webhook signature verification is required.");
        }
      } catch {
        logOperationalFailure("Stripe Webhook", "Signature verification");
        res.status(400).send("Webhook signature verification failed.");
        return;
      }

      if (event.id.startsWith("evt_test_")) {
        res.json({ verified: true });
        return;
      }

      let db: Awaited<ReturnType<typeof getDb>>;
      try {
        db = await getDb();
      } catch {
        logOperationalFailure("Stripe Webhook", "Database initialization");
        res.status(500).json({ error: "Database unavailable" });
        return;
      }
      if (!db) {
        res.status(500).json({ error: "Database unavailable" });
        return;
      }

      try {
        const claim = await claimStripeWebhookEvent(event.id, event.type);
        if (!claim.claimed) {
          res.json({ received: true, duplicate: true });
          return;
        }

        let checkoutSubscription: Stripe.Subscription | null = null;
        if (event.type === "checkout.session.completed") {
          const session = event.data.object as Stripe.Checkout.Session;
          const subscriptionId = idOf(session.subscription);
          if (!subscriptionId) quarantine("checkout_subscription_missing");
          checkoutSubscription =
            await getStripeClient().subscriptions.retrieve(subscriptionId);
        }
        let invoiceLines: Awaited<
          ReturnType<typeof getCompleteInvoiceLines>
        > | null = null;
        if (
          event.type === "invoice.paid" ||
          event.type === "invoice.payment_failed"
        ) {
          invoiceLines = await getCompleteInvoiceLines(
            event.data.object as Stripe.Invoice
          );
        }

        await db.transaction(async tx => {
          const feeForSubscription = async (subscriptionId: string) => {
            const [fee] = await tx
              .select()
              .from(successFees)
              .where(eq(successFees.stripeSubscriptionId, subscriptionId))
              .limit(1)
              .for("update");
            if (!fee) quarantine("unmapped_subscription");
            const [user] = await tx
              .select({ stripeCustomerId: users.stripeCustomerId })
              .from(users)
              .where(eq(users.id, fee.userId))
              .limit(1)
              .for("update");
            if (!user) quarantine("missing_fee_owner");
            return { fee, customerId: user.stripeCustomerId };
          };

          switch (event.type) {
            case "checkout.session.completed": {
              const session = event.data.object as Stripe.Checkout.Session;
              const feeId = Number(
                session.metadata?.successFeeId || session.client_reference_id
              );
              const subscriptionId = idOf(session.subscription);
              if (
                !Number.isSafeInteger(feeId) ||
                feeId <= 0 ||
                !subscriptionId ||
                session.status !== "complete"
              ) {
                quarantine("checkout_mapping_incomplete");
              }

              const [fee] = await tx
                .select()
                .from(successFees)
                .where(eq(successFees.id, feeId))
                .limit(1)
                .for("update");
              if (!fee) quarantine("unknown_success_fee");
              const [user] = await tx
                .select({ stripeCustomerId: users.stripeCustomerId })
                .from(users)
                .where(eq(users.id, fee.userId))
                .limit(1)
                .for("update");
              if (!user) quarantine("missing_fee_owner");
              requireIdentity(
                validateStripeCustomerIdentity(
                  user.stripeCustomerId,
                  session.customer
                )
              );
              if (
                !checkoutSubscription ||
                checkoutSubscription.id !== subscriptionId
              ) {
                quarantine("checkout_subscription_unverified");
              }
              requireIdentity(
                validateStripeSubscriptionIdentity(
                  identityForFee(fee, user.stripeCustomerId),
                  {
                    customer: checkoutSubscription.customer,
                    items: checkoutSubscription.items,
                  }
                )
              );
              if (
                fee.stripeSubscriptionId &&
                fee.stripeSubscriptionId !== subscriptionId
              ) {
                quarantine("checkout_subscription_mismatch");
              }
              if (
                fee.stripeCheckoutSessionId &&
                fee.stripeCheckoutSessionId !== session.id
              ) {
                quarantine("checkout_session_mismatch");
              }

              if (!fee.stripeSubscriptionId || !fee.stripeCheckoutSessionId) {
                await tx
                  .update(successFees)
                  .set({
                    stripeSubscriptionId: subscriptionId,
                    stripeCheckoutSessionId: session.id,
                  })
                  .where(eq(successFees.id, fee.id));
                await addAudit(tx, {
                  fee,
                  action: "stripe_checkout_subscription_linked",
                  event,
                  afterState: {
                    stripeEventId: event.id,
                    checkoutSessionId: session.id,
                    stripeSubscriptionId: subscriptionId,
                  },
                  riskLevel: "critical",
                });
              }
              break;
            }

            case "invoice.paid":
            case "invoice.payment_failed": {
              const invoice = event.data.object as Stripe.Invoice;
              const subscriptionId = invoiceSubscriptionId(invoice);
              if (!subscriptionId) quarantine("invoice_subscription_missing");
              const { fee, customerId } =
                await feeForSubscription(subscriptionId);
              const amount =
                event.type === "invoice.paid"
                  ? invoice.amount_paid
                  : invoice.amount_due;
              const currency = (invoice.currency ?? "").toUpperCase();
              const lines = invoiceLines as unknown as {
                data?: Array<{
                  amount?: number | null;
                  currency?: string | null;
                  quantity?: number | null;
                  price?:
                    | string
                    | {
                        id?: string | null;
                        currency?: string | null;
                        unit_amount?: number | null;
                      }
                    | null;
                  pricing?: {
                    price_details?: {
                      price?:
                        | string
                        | {
                            id?: string | null;
                            currency?: string | null;
                            unit_amount?: number | null;
                          }
                        | null;
                    };
                  } | null;
                }>;
                has_more?: boolean;
              };
              requireIdentity(
                validateStripeInvoiceIdentity(identityForFee(fee, customerId), {
                  customer: invoice.customer,
                  currency,
                  amount,
                  lines,
                })
              );

              const incomingStatus =
                event.type === "invoice.paid"
                  ? ("paid" as const)
                  : ("failed" as const);
              const [existingPayment] = await tx
                .select()
                .from(feePayments)
                .where(eq(feePayments.stripeInvoiceId, invoice.id))
                .limit(1)
                .for("update");
              if (
                existingPayment &&
                (existingPayment.successFeeId !== fee.id ||
                  existingPayment.userId !== fee.userId)
              ) {
                quarantine("invoice_fee_mismatch");
              }
              const nextStatus = transitionStripeInvoicePaymentStatus(
                existingPayment?.status ?? null,
                incomingStatus
              );
              const changed =
                !existingPayment || existingPayment.status !== nextStatus;
              const paidAt =
                event.type === "invoice.paid" &&
                invoice.status_transitions?.paid_at
                  ? new Date(invoice.status_transitions.paid_at * 1000)
                  : null;
              const paymentValues = {
                successFeeId: fee.id,
                userId: fee.userId,
                amount,
                currency,
                stripeInvoiceId: invoice.id,
                status: nextStatus,
                paidAt:
                  nextStatus === "paid"
                    ? (existingPayment?.paidAt ?? paidAt)
                    : null,
                periodStart: invoice.period_start
                  ? new Date(invoice.period_start * 1000)
                  : null,
                periodEnd: invoice.period_end
                  ? new Date(invoice.period_end * 1000)
                  : null,
              };
              if (existingPayment) {
                if (changed)
                  await tx
                    .update(feePayments)
                    .set(paymentValues)
                    .where(eq(feePayments.id, existingPayment.id));
              } else {
                await tx.insert(feePayments).values(paymentValues);
              }

              if (event.type === "invoice.paid") {
                await resolveSuccessFeeHolds(tx, {
                  feeId: fee.id,
                  holdType: "payment",
                  sourceKey: `invoice:${invoice.id}`,
                  evidence: `Paid Stripe invoice ${invoice.id} in event ${event.id}.`,
                });
                const lifecycleStatus = fee.lifecycleStatus === "pending_verification" &&
                  canTransitionSuccessFeeStatus(fee.status, "active")
                  ? "active"
                  : fee.lifecycleStatus;
                const effectiveStatus = await refreshSuccessFeeEffectiveStatus(tx, {
                  feeId: fee.id,
                  lifecycleStatus,
                  currentStatus: fee.status,
                  currentLifecycleStatus: fee.lifecycleStatus,
                });
                if (effectiveStatus !== fee.status) {
                  await addAudit(tx, {
                    fee,
                    action: "success_fee_payment_hold_reconciled",
                    event,
                    beforeState: { status: fee.status, lifecycleStatus: fee.lifecycleStatus },
                    afterState: { status: effectiveStatus, lifecycleStatus, stripeEventId: event.id },
                    riskLevel: "high",
                  });
                }
                if (changed)
                  await addAudit(tx, {
                    fee,
                    action: "stripe_payment_recorded",
                    event,
                    afterState: {
                      stripeEventId: event.id,
                      stripeInvoiceId: invoice.id,
                      status: nextStatus,
                    },
                    riskLevel: "high",
                  });
              } else if (changed) {
                await addSuccessFeeHold(tx, {
                  feeId: fee.id,
                  holdType: "payment",
                  sourceKey: `invoice:${invoice.id}`,
                  reason: `Stripe invoice ${invoice.id} payment failed.`,
                  actor: "system",
                });
                const effectiveStatus = await refreshSuccessFeeEffectiveStatus(tx, {
                  feeId: fee.id,
                  lifecycleStatus: fee.lifecycleStatus,
                  currentStatus: fee.status,
                  currentLifecycleStatus: fee.lifecycleStatus,
                });
                await addAudit(tx, {
                  fee,
                  action: "stripe_payment_failed",
                  event,
                  beforeState: { status: fee.status, lifecycleStatus: fee.lifecycleStatus },
                  afterState: {
                    status: effectiveStatus,
                    lifecycleStatus: fee.lifecycleStatus,
                    stripeEventId: event.id,
                    stripeInvoiceId: invoice.id,
                  },
                  riskLevel: "high",
                });
                await tx.insert(adminReviewItems).values({
                  userId: fee.userId,
                  entityType: "success_fee",
                  entityId: fee.id,
                  category: "payment_failed",
                  priority: "high",
                  title: "Stripe payment failed",
                  description: `Stripe could not collect ${amount} ${currency} for ${fee.employerName} (${fee.jobTitle}). Review billing recovery before any escalation.`,
                });
              }
              break;
            }

            case "customer.subscription.deleted":
            case "customer.subscription.updated": {
              const subscription = event.data.object as Stripe.Subscription;
              const { fee, customerId } = await feeForSubscription(
                subscription.id
              );
              requireIdentity(
                validateStripeSubscriptionIdentity(
                  identityForFee(fee, customerId),
                  {
                    customer: subscription.customer,
                    items: subscription.items,
                  }
                )
              );

              if (event.type === "customer.subscription.deleted") {
                if (
                  fee.status !== "ended" &&
                  canTransitionSuccessFeeStatus(fee.status, "ended")
                ) {
                  await tx
                    .update(successFees)
                    .set({ status: "ended", lifecycleStatus: "ended", endDate: new Date() })
                    .where(eq(successFees.id, fee.id));
                  await addAudit(tx, {
                    fee,
                    action: "stripe_subscription_ended",
                    event,
                    beforeState: { status: fee.status },
                    afterState: { status: "ended", stripeEventId: event.id },
                    riskLevel: "high",
                  });
                }
              } else if (
                subscription.status === "active" &&
                fee.lifecycleStatus !== "ended"
              ) {
                await resolveSuccessFeeHolds(tx, {
                  feeId: fee.id,
                  holdType: "payment",
                  sourceKey: `subscription:${subscription.id}`,
                  evidence: `Stripe subscription ${subscription.id} became active in event ${event.id}.`,
                });
                const lifecycleStatus = fee.lifecycleStatus === "pending_verification" ? "active" : fee.lifecycleStatus;
                const effectiveStatus = await refreshSuccessFeeEffectiveStatus(tx, {
                  feeId: fee.id,
                  lifecycleStatus,
                  currentStatus: fee.status,
                  currentLifecycleStatus: fee.lifecycleStatus,
                });
                if (effectiveStatus !== fee.status || lifecycleStatus !== fee.lifecycleStatus) {
                  await addAudit(tx, {
                    fee,
                    action: "stripe_subscription_status_updated",
                    event,
                    beforeState: { status: fee.status, lifecycleStatus: fee.lifecycleStatus },
                    afterState: {
                      status: effectiveStatus,
                      lifecycleStatus,
                      stripeEventId: event.id,
                      stripeStatus: subscription.status,
                    },
                    riskLevel: "high",
                  });
                }
              } else if (
                subscription.status === "past_due" &&
                fee.lifecycleStatus !== "ended"
              ) {
                await addSuccessFeeHold(tx, {
                  feeId: fee.id,
                  holdType: "payment",
                  sourceKey: `subscription:${subscription.id}`,
                  reason: `Stripe subscription ${subscription.id} is past due.`,
                  actor: "system",
                });
                const effectiveStatus = await refreshSuccessFeeEffectiveStatus(tx, {
                  feeId: fee.id,
                  lifecycleStatus: fee.lifecycleStatus,
                  currentStatus: fee.status,
                  currentLifecycleStatus: fee.lifecycleStatus,
                });
                await addAudit(tx, {
                  fee,
                  action: "stripe_subscription_status_updated",
                  event,
                  beforeState: { status: fee.status, lifecycleStatus: fee.lifecycleStatus },
                  afterState: {
                    status: effectiveStatus,
                    lifecycleStatus: fee.lifecycleStatus,
                    stripeEventId: event.id,
                    stripeStatus: subscription.status,
                  },
                  riskLevel: "high",
                });
                await tx.insert(adminReviewItems).values({
                  userId: fee.userId,
                  entityType: "success_fee",
                  entityId: fee.id,
                  category: "payment_failed",
                  priority: "high",
                  title: "Stripe payment failed",
                  description: `Stripe marked the subscription for ${fee.employerName} (${fee.jobTitle}) as past due. Review billing recovery before any escalation.`,
                });
              }
              break;
            }
          }

          await tx
            .update(stripeWebhookEvents)
            .set({
              status: "processed",
              processedAt: new Date(),
              errorMessage: null,
            })
            .where(eq(stripeWebhookEvents.stripeEventId, event.id));
        });

        res.json({ received: true });
      } catch (error) {
        if (error instanceof StripeWebhookQuarantineError) {
          try {
            await quarantineStripeWebhookEvent(event.id, error.reasonCode);
            res.json({ received: true, quarantined: true });
            return;
          } catch {
            logOperationalFailure("Stripe Webhook", "Quarantine ledger update");
          }
        }
        try {
          await failStripeWebhookEvent(event.id, error);
        } catch {
          logOperationalFailure("Stripe Webhook", "Ledger failure update");
        }
        logOperationalFailure("Stripe Webhook", "Event processing");
        res.status(500).json({ error: failedResponse });
      }
    }
  );
}
