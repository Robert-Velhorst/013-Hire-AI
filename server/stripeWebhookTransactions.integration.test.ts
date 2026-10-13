import { randomUUID } from "node:crypto";
import express from "express";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  adminReviewItems,
  auditEvents,
  feePayments,
  stripeWebhookEvents,
  successFeeHolds,
  successFees,
  users,
} from "../drizzle/schema";
import { closeDatabaseConnection, getDb } from "./db";
import { registerStripeWebhook } from "./stripeWebhook";

const enabled = process.env.HIRE_AI_DATABASE_ACCEPTANCE === "true";

describe
  .skipIf(!enabled)
  .sequential("Stripe webhook transaction acceptance on isolated MySQL", () => {
    const marker = `stripe-webhook-${randomUUID().replaceAll("-", "")}`;
    const constraints: Array<{ name: string; table: string }> = [];
    let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
    let userId = 0;
    let feeId = 0;
    let server: ReturnType<express.Express["listen"]> | null = null;
    let baseUrl = "";

    async function addCheckConstraint(table: string, expression: string) {
      const name = `hire_ai_stripe_${randomUUID().replaceAll("-", "")}`;
      constraints.push({ name, table });
      await db.execute(
        sql.raw(
          `ALTER TABLE \`${table}\` ADD CONSTRAINT \`${name}\` CHECK (${expression})`
        )
      );
    }

    async function removeCheckConstraints() {
      while (constraints.length) {
        const { name, table } = constraints.pop()!;
        await db.execute(
          sql.raw(`ALTER TABLE \`${table}\` DROP CHECK \`${name}\``)
        );
      }
    }

    async function postEvent(event: Record<string, unknown>) {
      return await fetch(`${baseUrl}/api/stripe/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
      });
    }

    function failedInvoiceEvent(
      eventId: string,
      type: "invoice.payment_failed" | "invoice.paid",
      invoiceId = `${marker}-invoice`
    ) {
      return {
        id: eventId,
        type,
        data: {
          object: {
            id: invoiceId,
            subscription: `${marker}-subscription`,
            customer: `${marker}-customer`,
            amount_due: 25000,
            amount_paid: 25000,
            currency: "usd",
            status_transitions: { paid_at: Math.floor(Date.now() / 1000) },
            period_start: Math.floor(Date.now() / 1000) - 30 * 86_400,
            period_end: Math.floor(Date.now() / 1000),
            lines: {
              has_more: false,
              data: [
                {
                  price: {
                    id: `${marker}-price`,
                    currency: "usd",
                    unit_amount: 25000,
                  },
                  quantity: 1,
                  amount: 25000,
                  currency: "usd",
                },
              ],
            },
          },
        },
      };
    }

    beforeAll(async () => {
      const target = new URL(process.env.DATABASE_URL || "");
      if (target.pathname !== "/hire_ai_acceptance") {
        throw new Error(
          "Stripe webhook acceptance requires the isolated hire_ai_acceptance database."
        );
      }
      const connection = await getDb();
      if (!connection)
        throw new Error(
          "MySQL is required; memory fallback is not integration acceptance."
        );
      db = connection;
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");

      const app = express();
      registerStripeWebhook(app);
      server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
        const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
      });
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Webhook acceptance server did not bind a TCP port.");
      baseUrl = `http://127.0.0.1:${address.port}`;

      const user = await db.insert(users).values({
        openId: marker,
        name: "Synthetic Stripe webhook acceptance user",
        stripeCustomerId: `${marker}-customer`,
      });
      userId = Number(user[0].insertId);
      const fee = await db.insert(successFees).values({
        userId,
        employerName: "Synthetic employer",
        jobTitle: "Synthetic remote role",
        monthlySalary: 500000,
        currency: "usd",
        feePercent: 5,
        monthlyFeeAmount: 25000,
        stripeSubscriptionId: `${marker}-subscription`,
        stripePriceId: `${marker}-price`,
        status: "active",
        lifecycleStatus: "active",
        startDate: new Date(),
      });
      feeId = Number(fee[0].insertId);
    }, 30000);

    afterAll(async () => {
      try {
        if (db) {
          await removeCheckConstraints();
          if (feeId) {
            await db
              .delete(adminReviewItems)
              .where(
                and(
                  eq(adminReviewItems.userId, userId),
                  eq(adminReviewItems.entityId, feeId)
                )
              );
            await db
              .delete(auditEvents)
              .where(
                and(
                  eq(auditEvents.userId, userId),
                  eq(auditEvents.entityId, feeId)
                )
              );
            await db
              .delete(feePayments)
              .where(eq(feePayments.successFeeId, feeId));
            await db
              .delete(stripeWebhookEvents)
              .where(
                sql`${stripeWebhookEvents.stripeEventId} like ${`evt_${marker}%`}`
              );
            await db.delete(successFees).where(eq(successFees.id, feeId));
          }
          if (userId) await db.delete(users).where(eq(users.id, userId));
        }
      } finally {
        if (server)
          await new Promise<void>(resolve => server!.close(() => resolve()));
        vi.unstubAllEnvs();
        await closeDatabaseConnection();
      }
    }, 30000);

    it("rolls back failures at audit, review, and processed-marker writes, then converges one failed-to-paid invoice", async () => {
      const eventId = `evt_${marker}`;
      const auditEvent = failedInvoiceEvent(eventId, "invoice.payment_failed");
      await addCheckConstraint(
        "audit_events",
        `NOT (entity_id = ${feeId} AND action = 'stripe_payment_failed')`
      );
      const first = await postEvent(auditEvent);
      expect(first.status).toBe(500);
      await removeCheckConstraints();
      await assertRolledBack(eventId);

      await addCheckConstraint(
        "admin_review_items",
        `NOT (entity_id = ${feeId} AND category = 'payment_failed')`
      );
      const second = await postEvent(auditEvent);
      expect(second.status).toBe(500);
      await removeCheckConstraints();
      await assertRolledBack(eventId);

      await addCheckConstraint(
        "stripe_webhook_events",
        `NOT (stripe_event_id = '${eventId}' AND status = 'processed')`
      );
      const third = await postEvent(auditEvent);
      expect(third.status).toBe(500);
      await removeCheckConstraints();
      await assertRolledBack(eventId);

      const recovered = await postEvent(auditEvent);
      expect(recovered.status).toBe(200);
      const paymentAfterFailure = await db
        .select()
        .from(feePayments)
        .where(eq(feePayments.stripeInvoiceId, `${marker}-invoice`));
      expect(paymentAfterFailure).toHaveLength(1);
      expect(paymentAfterFailure[0].status).toBe("failed");

      const paid = await postEvent(
        failedInvoiceEvent(`evt_${marker}_paid`, "invoice.paid")
      );
      expect(paid.status).toBe(200);
      const repeatedPaid = await postEvent(
        failedInvoiceEvent(`evt_${marker}_paid_duplicate`, "invoice.paid")
      );
      expect(repeatedPaid.status).toBe(200);
      const paymentAfterRecovery = await db
        .select()
        .from(feePayments)
        .where(eq(feePayments.stripeInvoiceId, `${marker}-invoice`));
      expect(paymentAfterRecovery).toHaveLength(1);
      expect(paymentAfterRecovery[0].status).toBe("paid");
      expect(
        await db
          .select({ status: successFees.status })
          .from(successFees)
          .where(eq(successFees.id, feeId))
      ).toMatchObject([{ status: "active" }]);
      expect(
        await db
          .select()
          .from(stripeWebhookEvents)
          .where(eq(stripeWebhookEvents.stripeEventId, `evt_${marker}_paid`))
      ).toMatchObject([{ status: "processed" }]);
    }, 30000);

    it("clears only the payment hold while preserving a separate legal hold", async () => {
      await db.insert(successFeeHolds).values({
        successFeeId: feeId,
        holdType: "legal",
        reason: "Synthetic unresolved legal review hold.",
        createdByActor: "admin",
      });
      await db
        .update(successFees)
        .set({ status: "disputed" })
        .where(eq(successFees.id, feeId));

      const failed = await postEvent(
        failedInvoiceEvent(
          `evt_${marker}_legal_failure`,
          "invoice.payment_failed",
          `${marker}-legal-invoice`
        )
      );
      expect(failed.status).toBe(200);
      const failedStatus = await db
        .select({ status: successFees.status })
        .from(successFees)
        .where(eq(successFees.id, feeId));
      expect(failedStatus).toMatchObject([{ status: "disputed" }]);

      const paid = await postEvent(
        failedInvoiceEvent(
          `evt_${marker}_legal_paid`,
          "invoice.paid",
          `${marker}-legal-invoice`
        )
      );
      expect(paid.status).toBe(200);
      expect(
        await db
          .select({ status: successFees.status })
          .from(successFees)
          .where(eq(successFees.id, feeId))
      ).toMatchObject([{ status: "disputed" }]);
      expect(
        await db
          .select({
            holdType: successFeeHolds.holdType,
            resolvedAt: successFeeHolds.resolvedAt,
          })
          .from(successFeeHolds)
          .where(eq(successFeeHolds.successFeeId, feeId))
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ holdType: "legal", resolvedAt: null }),
          expect.objectContaining({
            holdType: "payment",
            resolvedAt: expect.any(Date),
          }),
        ])
      );
    }, 30000);

    async function assertRolledBack(eventId: string) {
      expect(
        await db
          .select()
          .from(feePayments)
          .where(eq(feePayments.stripeInvoiceId, `${marker}-invoice`))
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(auditEvents)
          .where(
            and(eq(auditEvents.userId, userId), eq(auditEvents.entityId, feeId))
          )
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(adminReviewItems)
          .where(
            and(
              eq(adminReviewItems.userId, userId),
              eq(adminReviewItems.entityId, feeId)
            )
          )
      ).toHaveLength(0);
      expect(
        await db
          .select({ status: successFees.status })
          .from(successFees)
          .where(eq(successFees.id, feeId))
      ).toMatchObject([{ status: "active" }]);
      expect(
        await db
          .select({ status: stripeWebhookEvents.status })
          .from(stripeWebhookEvents)
          .where(eq(stripeWebhookEvents.stripeEventId, eventId))
      ).toMatchObject([{ status: "failed" }]);
    }
  });
