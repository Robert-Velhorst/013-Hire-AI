import { randomUUID } from "node:crypto";
import { and, asc, eq, lt, or, sql } from "drizzle-orm";
import { stripeReconciliationCommands, successFees, users } from "../drizzle/schema";
import { getDb } from "./db";
import { getStripeClient } from "./stripeClient";
import { logOperationalFailure } from "./operationalFailureLog";

const COMMAND_LEASE_MS = 2 * 60 * 1000;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 6 * 60 * 60 * 1000;
const COMMANDS_PER_CYCLE = 25;

export type StripeReconciliationCommand = typeof stripeReconciliationCommands.$inferSelect;

export function getStripeCommandRetryDelayMs(attemptCount: number) {
  const exponent = Math.max(0, Math.min(Math.floor(attemptCount) - 1, 10));
  return Math.min(RETRY_BASE_MS * 2 ** exponent, RETRY_MAX_MS);
}

function getSafeStripeErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return "provider_error";
  const candidate = (error as { code?: unknown }).code;
  if (typeof candidate !== "string") return "provider_error";
  return /^[a-z0-9_]{1,120}$/i.test(candidate) ? candidate : "provider_error";
}

async function claimNextCommand(): Promise<StripeReconciliationCommand | null> {
  const db = await getDb();
  if (!db) return null;
  const now = new Date();
  const leaseId = randomUUID();
  return db.transaction(async tx => {
    const [candidate] = await tx
      .select()
      .from(stripeReconciliationCommands)
      .where(or(
        and(
          or(eq(stripeReconciliationCommands.status, "pending"), eq(stripeReconciliationCommands.status, "failed")),
          lt(stripeReconciliationCommands.nextAttemptAt, now)
        ),
        and(
          eq(stripeReconciliationCommands.status, "processing"),
          lt(stripeReconciliationCommands.leaseExpiresAt, now)
        )
      ))
      .orderBy(asc(stripeReconciliationCommands.createdAt), asc(stripeReconciliationCommands.id))
      .limit(1)
      .for("update");
    if (!candidate) return null;

    await tx
      .update(stripeReconciliationCommands)
      .set({
        status: "processing",
        attemptCount: sql`${stripeReconciliationCommands.attemptCount} + 1`,
        lastAttemptAt: now,
        leaseId,
        leaseExpiresAt: new Date(now.getTime() + COMMAND_LEASE_MS),
        lastErrorCode: null,
      })
      .where(eq(stripeReconciliationCommands.id, candidate.id));
    return {
      ...candidate,
      status: "processing",
      attemptCount: candidate.attemptCount + 1,
      lastAttemptAt: now,
      leaseId,
      leaseExpiresAt: new Date(now.getTime() + COMMAND_LEASE_MS),
    };
  });
}

export async function executeStripeReconciliationCommand(
  command: StripeReconciliationCommand,
  stripe = getStripeClient()
) {
  if (command.action === "pause") {
    await stripe.subscriptions.update(command.stripeSubscriptionId, {
      pause_collection: { behavior: "void" },
    }, { idempotencyKey: command.commandKey });
  } else if (command.action === "resume") {
    await stripe.subscriptions.update(command.stripeSubscriptionId, {
      pause_collection: "",
    } as any, { idempotencyKey: command.commandKey });
  } else {
    await stripe.subscriptions.cancel(command.stripeSubscriptionId, {}, {
      idempotencyKey: command.commandKey,
    });
  }
}

export function isStripeCommandStillDesired(
  action: StripeReconciliationCommand["action"],
  feeStatus: StripeReconciliationCommand["status"] | string,
  accountStatus: string
) {
  return (action === "pause" && ["paused", "suspended", "disputed"].includes(feeStatus)) ||
    (action === "resume" && feeStatus === "active" && accountStatus === "active") ||
    (action === "cancel" && feeStatus === "ended");
}

async function processCommand(command: StripeReconciliationCommand) {
  const db = await getDb();
  if (!db || !command.leaseId) return;
  try {
    const [current] = await db.select({
      feeStatus: successFees.status,
      accountStatus: users.accountStatus,
    }).from(successFees)
      .innerJoin(users, eq(users.id, successFees.userId))
      .where(eq(successFees.id, command.successFeeId))
      .limit(1);
    const stillDesired = current && isStripeCommandStillDesired(
      command.action,
      current.feeStatus,
      current.accountStatus
    );
    if (!stillDesired) {
      await db.update(stripeReconciliationCommands)
        .set({ status: "superseded", completedAt: new Date(), leaseId: null, leaseExpiresAt: null })
        .where(and(
          eq(stripeReconciliationCommands.id, command.id),
          eq(stripeReconciliationCommands.leaseId, command.leaseId),
          eq(stripeReconciliationCommands.status, "processing")
        ));
      return;
    }
    await executeStripeReconciliationCommand(command);
    await db.update(stripeReconciliationCommands)
      .set({
        status: "succeeded",
        completedAt: new Date(),
        leaseId: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
      })
      .where(and(
        eq(stripeReconciliationCommands.id, command.id),
        eq(stripeReconciliationCommands.leaseId, command.leaseId),
        eq(stripeReconciliationCommands.status, "processing")
      ));
  } catch (error) {
    const nextAttemptAt = new Date(Date.now() + getStripeCommandRetryDelayMs(command.attemptCount));
    await db.update(stripeReconciliationCommands)
      .set({
        status: "failed",
        lastErrorCode: getSafeStripeErrorCode(error),
        nextAttemptAt,
        leaseId: null,
        leaseExpiresAt: null,
      })
      .where(and(
        eq(stripeReconciliationCommands.id, command.id),
        eq(stripeReconciliationCommands.leaseId, command.leaseId),
        eq(stripeReconciliationCommands.status, "processing")
      ));
    logOperationalFailure("Stripe reconciliation", "Provider command");
  }
}

export async function reconcileStripeCommandsOnce() {
  let processed = 0;
  while (processed < COMMANDS_PER_CYCLE) {
    const command = await claimNextCommand();
    if (!command) break;
    await processCommand(command);
    processed += 1;
  }
  return processed;
}

export class StripeReconciliationWorker {
  private interval: NodeJS.Timeout | null = null;
  private activeCycle: Promise<void> | null = null;

  start() {
    if (this.interval) return;
    this.scheduleCycle();
    this.interval = setInterval(() => this.scheduleCycle(), 30_000);
    this.interval.unref();
  }

  async stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    await this.activeCycle;
  }

  private scheduleCycle() {
    if (this.activeCycle) return;
    this.activeCycle = reconcileStripeCommandsOnce()
      .then(() => undefined)
      .catch(() => logOperationalFailure("Stripe reconciliation", "Worker cycle"))
      .finally(() => { this.activeCycle = null; });
  }
}
