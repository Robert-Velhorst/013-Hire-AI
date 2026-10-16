import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminReviewItems,
  employmentVerifications,
  feePayments,
  operationalFailureSignals,
  stripeReconciliationCommands,
  stripeWebhookEvents,
  successFeeHolds,
  successFees,
  users,
} from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import { closeDatabaseConnection, getDb } from "./db";
import { adminRouter } from "./routers/admin";

const enabled = process.env.HIRE_AI_DATABASE_ACCEPTANCE === "true";
const PAGE_SIZE = 100;
const ROW_COUNT = 205;
type Cursor = { timestamp: Date; id: number };
type CursorPage<T> = {
  items: T[];
  total: number;
  hasMore: boolean;
  nextCursor: Cursor | null;
};
type FailureCursorPage<T> = {
  signals: T[];
  totalFailures: number;
  uniqueSignals: number;
  hasMore: boolean;
  nextCursor: { id: number } | null;
};

async function collectPages<T>(
  firstPage: CursorPage<T>,
  fetchPage: (cursor: Cursor) => Promise<CursorPage<T>>
) {
  const items = [...firstPage.items];
  let page = firstPage;
  while (page.nextCursor) {
    page = await fetchPage(page.nextCursor);
    items.push(...page.items);
  }
  return items;
}

async function collectFailurePages<T>(
  firstPage: FailureCursorPage<T>,
  fetchPage: (cursor: { id: number }) => Promise<FailureCursorPage<T>>
) {
  const signals = [...firstPage.signals];
  let page = firstPage;
  while (page.nextCursor) {
    page = await fetchPage(page.nextCursor);
    signals.push(...page.signals);
  }
  return signals;
}

describe.skipIf(!enabled).sequential("admin operating queue pagination on isolated MySQL", () => {
  const marker = `admin-queues-${randomUUID().replaceAll("-", "")}`;
  let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
  let userId = 0;
  let originalFeeIds: number[] = [];

  function createAdminContext(role: "admin" | "user" = "admin"): TrpcContext {
    const now = new Date();
    return {
      user: {
        id: userId,
        openId: marker,
        name: "Synthetic queue acceptance admin",
        email: `${marker}@example.test`,
        loginMethod: "test",
        role,
        stripeCustomerId: null,
        accountStatus: "active",
        tosAcceptedAt: now,
        createdAt: now,
        updatedAt: now,
        lastSignedIn: now,
      },
      req: {} as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };
  }

  const insertNewerFee = async () => {
    const now = new Date();
    await db.insert(successFees).values({
      userId,
      employerName: `${marker}-newer`,
      jobTitle: "Newly inserted remote role",
      monthlySalary: 500_000,
      currency: "USD",
      feePercent: 5,
      monthlyFeeAmount: 25_000,
      status: "active",
      lifecycleStatus: "active",
      startDate: now,
      createdAt: new Date(now.getTime() + 60_000),
    });
  };

  const insertNewerHold = async () => {
    await db.insert(successFeeHolds).values({
      successFeeId: originalFeeIds[0]!,
      holdType: "administrator",
      reason: `${marker}-newer-hold`,
      createdByActor: "admin",
      createdAt: new Date(Date.now() + 60_000),
    });
  };

  const insertNewerReconciliationCommand = async () => {
    await db.insert(stripeReconciliationCommands).values({
      successFeeId: originalFeeIds[0]!,
      stripeSubscriptionId: `${marker}-newer-sub`,
      commandKey: `${marker}-newer-cmd`,
      action: "pause",
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: new Date(Date.now() + 60_000),
      createdAt: new Date(Date.now() + 60_000),
    });
  };

  const insertNewerWebhookIssue = async () => {
    await db.insert(stripeWebhookEvents).values({
      stripeEventId: `${marker}-newer-event`,
      eventType: "synthetic.queue_test",
      status: "failed",
      errorMessage: "Synthetic newer issue.",
      receivedAt: new Date(Date.now() + 60_000),
    });
  };

  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL || "");
    if (target.pathname !== "/hire_ai_acceptance") {
      throw new Error("Admin queue acceptance requires the isolated hire_ai_acceptance database.");
    }
    const connection = await getDb();
    if (!connection) throw new Error("MySQL is required; memory fallback is not integration acceptance.");
    db = connection;

    const user = await db.insert(users).values({
      openId: marker,
      name: "Synthetic queue acceptance admin",
      email: `${marker}@example.test`,
      role: "admin",
      accountStatus: "active",
    });
    userId = Number(user[0].insertId);

    const baseTimestamp = Date.now() - 60_000;
    const feeRows = Array.from({ length: ROW_COUNT }, (_, index) => {
      const createdAt = new Date(baseTimestamp - Math.floor(index / 2) * 1_000);
      return {
        userId,
        employerName: `${marker}-employer-${index}`,
        jobTitle: `Synthetic remote role ${index}`,
        monthlySalary: 500_000,
        currency: "USD",
        feePercent: 5,
        monthlyFeeAmount: 25_000,
        status: "active" as const,
        lifecycleStatus: "active" as const,
        startDate: createdAt,
        nextVerificationDue: new Date(baseTimestamp - 90 * 86_400_000),
        verificationGraceExpiry: new Date(baseTimestamp - 60 * 86_400_000),
        createdAt,
      };
    });
    await db.insert(successFees).values(feeRows);
    const selectedFees = await db.select({ id: successFees.id, employerName: successFees.employerName })
      .from(successFees)
      .where(like(successFees.employerName, `${marker}-employer-%`));
    originalFeeIds = selectedFees.map((fee) => fee.id);
    if (originalFeeIds.length !== ROW_COUNT) throw new Error("Failed to seed all synthetic success fees.");

    await db.insert(feePayments).values(selectedFees.map((fee, index) => ({
      userId,
      successFeeId: fee.id,
      amount: 25_000,
      currency: "USD",
      status: (["failed", "paid", "pending", "refunded"] as const)[index % 4]!,
      createdAt: new Date(baseTimestamp - Math.floor(index / 2) * 1_000),
    })));
    await db.insert(employmentVerifications).values(selectedFees.map((fee, index) => ({
      userId,
      successFeeId: fee.id,
      verificationType: index % 2 === 0 ? "initial" as const : "quarterly" as const,
      status: "pending" as const,
      submittedAt: new Date(baseTimestamp - Math.floor(index / 2) * 1_000),
    })));
    await db.insert(adminReviewItems).values(selectedFees.map((fee, index) => ({
      userId,
      entityType: "success_fee" as const,
      entityId: fee.id,
      category: "application_review" as const,
      status: (["open", "in_progress", "resolved", "dismissed"] as const)[index % 4]!,
      priority: "medium" as const,
      title: `${marker}-review-${index}`,
      description: "Synthetic admin queue pagination record.",
      createdAt: new Date(baseTimestamp - Math.floor(index / 2) * 1_000),
    })));
    await db.insert(operationalFailureSignals).values(Array.from({ length: ROW_COUNT }, (_, index) => ({
      scope: `${marker}-${index}`,
      operation: "synthetic-queue-test",
      count: 1,
      firstOccurredAt: new Date(baseTimestamp - index * 1_000),
      lastOccurredAt: new Date(Date.now() + 10_000 + index),
    })));
    await db.insert(successFeeHolds).values(selectedFees.map((fee, index) => ({
      successFeeId: fee.id,
      holdType: "administrator" as const,
      reason: `${marker}-hold-${index}`,
      createdByActor: "admin" as const,
      createdAt: new Date(baseTimestamp - Math.floor(index / 2) * 1_000),
    })));
    await db.insert(stripeReconciliationCommands).values(selectedFees.map((fee, index) => ({
      successFeeId: fee.id,
      stripeSubscriptionId: `${marker}-sub-${index}`,
      commandKey: `${marker}-cmd-${index}`,
      action: (["pause", "resume", "cancel"] as const)[index % 3]!,
      status: (["pending", "processing", "failed", "succeeded"] as const)[index % 4]!,
      attemptCount: 0,
      nextAttemptAt: new Date(baseTimestamp - Math.floor(index / 2) * 1_000),
      createdAt: new Date(baseTimestamp - Math.floor(index / 2) * 1_000),
    })));
    await db.insert(stripeWebhookEvents).values(Array.from({ length: ROW_COUNT }, (_, index) => ({
      stripeEventId: `${marker}-event-${index}`,
      eventType: "synthetic.queue_test",
      status: (index % 2 === 0 ? "failed" : "quarantined") as "failed" | "quarantined",
      errorMessage: `${marker}-webhook-${index}`,
      receivedAt: new Date(baseTimestamp - Math.floor(index / 2) * 1_000),
    })));
  }, 30_000);

  afterAll(async () => {
    try {
      if (db) {
        if (userId) {
          if (originalFeeIds.length) {
            await db.delete(successFeeHolds).where(inArray(successFeeHolds.successFeeId, originalFeeIds));
          }
          await db.delete(employmentVerifications).where(eq(employmentVerifications.userId, userId));
          await db.delete(feePayments).where(eq(feePayments.userId, userId));
          await db.delete(adminReviewItems).where(eq(adminReviewItems.userId, userId));
          await db.delete(successFees).where(eq(successFees.userId, userId));
          await db.delete(users).where(eq(users.id, userId));
        }
        await db.delete(stripeReconciliationCommands)
          .where(like(stripeReconciliationCommands.commandKey, `${marker}%`));
        await db.delete(stripeWebhookEvents)
          .where(like(stripeWebhookEvents.stripeEventId, `${marker}%`));
        await db.delete(operationalFailureSignals)
          .where(like(operationalFailureSignals.scope, `${marker}%`));
      }
    } finally {
      await closeDatabaseConnection();
    }
  }, 30_000);

  it("pages past 100 rows, retains filtered totals, and excludes records inserted ahead of an active cursor", async () => {
    const caller = adminRouter.createCaller(createAdminContext());
    const firstFees = await caller.listFees({ status: "all", limit: PAGE_SIZE });
    expect(firstFees.total).toBe(ROW_COUNT);
    expect(firstFees.items).toHaveLength(PAGE_SIZE);
    expect(firstFees.hasMore).toBe(true);

    await insertNewerFee();
    const feeRows = await collectPages(firstFees, cursor => caller.listFees({
      status: "all",
      limit: PAGE_SIZE,
      cursor,
    }));
    expect(feeRows).toHaveLength(ROW_COUNT);
    expect(new Set(feeRows.map(row => row.id)).size).toBe(ROW_COUNT);
    expect(new Set(feeRows.map(row => row.id))).toEqual(new Set(originalFeeIds));
    const refreshedFees = await caller.listFees({ status: "all", limit: PAGE_SIZE });
    expect(refreshedFees.total).toBe(ROW_COUNT + 1);
    expect(refreshedFees.items[0]?.employerName).toBe(`${marker}-newer`);

    const paymentPage = await caller.listPayments({ status: "all", limit: PAGE_SIZE });
    const payments = await collectPages(paymentPage, cursor => caller.listPayments({
      status: "all",
      limit: PAGE_SIZE,
      cursor,
    }));
    expect(paymentPage.total).toBe(ROW_COUNT);
    expect(payments).toHaveLength(ROW_COUNT);
    expect(new Set(payments.map(row => row.id)).size).toBe(ROW_COUNT);
    const failedPayments = await caller.listPayments({ status: "failed", limit: PAGE_SIZE });
    expect(failedPayments.total).toBe(52);
    expect(failedPayments.items.every(row => row.status === "failed")).toBe(true);

    const verificationPage = await caller.listPendingVerifications({ limit: PAGE_SIZE });
    const verifications = await collectPages(verificationPage, cursor => caller.listPendingVerifications({
      limit: PAGE_SIZE,
      cursor,
    }));
    expect(verificationPage.total).toBe(ROW_COUNT);
    expect(verifications).toHaveLength(ROW_COUNT);
    expect(new Set(verifications.map(row => row.id)).size).toBe(ROW_COUNT);

    const overduePage = await caller.listOverdueVerifications({ limit: PAGE_SIZE });
    const overdue = await collectPages(overduePage, cursor => caller.listOverdueVerifications({
      limit: PAGE_SIZE,
      cursor,
    }));
    expect(overduePage.total).toBe(ROW_COUNT);
    expect(overdue).toHaveLength(ROW_COUNT);
    expect(new Set(overdue.map(row => row.id)).size).toBe(ROW_COUNT);

    const reviewPage = await caller.getReviewQueue({ status: "all", limit: PAGE_SIZE });
    const reviews = await collectPages(reviewPage, cursor => caller.getReviewQueue({
      status: "all",
      limit: PAGE_SIZE,
      cursor,
    }));
    expect(reviewPage.total).toBe(ROW_COUNT);
    expect(reviews).toHaveLength(ROW_COUNT);
    expect(new Set(reviews.map(row => row.id)).size).toBe(ROW_COUNT);
    const openReviews = await caller.getReviewQueue({ status: "open", limit: PAGE_SIZE });
    expect(openReviews.total).toBe(52);
    expect(openReviews.items.every(row => row.status === "open")).toBe(true);

    const holdPage = await caller.getSuccessFeeHolds({ limit: PAGE_SIZE });
    expect(holdPage.total).toBe(ROW_COUNT);
    expect(holdPage.items).toHaveLength(PAGE_SIZE);
    expect(holdPage.hasMore).toBe(true);
    await insertNewerHold();
    const holds = await collectPages(holdPage, cursor => caller.getSuccessFeeHolds({ limit: PAGE_SIZE, cursor }));
    const markerHolds = holds.filter(hold => hold.reason.startsWith(`${marker}-hold-`));
    expect(markerHolds).toHaveLength(ROW_COUNT);
    expect(new Set(markerHolds.map(hold => hold.id)).size).toBe(ROW_COUNT);
    expect(holds.some(hold => hold.reason === `${marker}-newer-hold`)).toBe(false);

    const reconciliationPage = await caller.getStripeReconciliationStatus({ limit: PAGE_SIZE });
    expect(reconciliationPage.pending).toBe(52);
    expect(reconciliationPage.processing).toBe(51);
    expect(reconciliationPage.failed).toBe(51);
    expect(reconciliationPage.commandTotal).toBe(154);
    expect(reconciliationPage.commands).toHaveLength(PAGE_SIZE);
    expect(reconciliationPage.commandHasMore).toBe(true);
    await insertNewerReconciliationCommand();
    const reconciliationCommands = [...reconciliationPage.commands];
    let commandPage = reconciliationPage;
    while (commandPage.commandNextCursor) {
      commandPage = await caller.getStripeReconciliationStatus({
        limit: PAGE_SIZE,
        cursor: commandPage.commandNextCursor,
      });
      reconciliationCommands.push(...commandPage.commands);
    }
    const markerCommands = reconciliationCommands.filter(command => command.stripeSubscriptionId.startsWith(`${marker}-sub-`));
    expect(markerCommands).toHaveLength(154);
    expect(new Set(markerCommands.map(command => command.id)).size).toBe(154);
    expect(reconciliationCommands.some(command => command.stripeSubscriptionId === `${marker}-newer-sub`)).toBe(false);

    const webhookPage = await caller.getStripeWebhookIssues({ limit: PAGE_SIZE });
    expect(webhookPage.total).toBe(ROW_COUNT);
    expect(webhookPage.items).toHaveLength(PAGE_SIZE);
    expect(webhookPage.hasMore).toBe(true);
    await insertNewerWebhookIssue();
    const webhookIssues = await collectPages(webhookPage, cursor => caller.getStripeWebhookIssues({ limit: PAGE_SIZE, cursor }));
    const markerWebhookIssues = webhookIssues.filter(event => event.stripeEventId.startsWith(`${marker}-event-`));
    expect(markerWebhookIssues).toHaveLength(ROW_COUNT);
    expect(new Set(markerWebhookIssues.map(event => event.id)).size).toBe(ROW_COUNT);
    expect(webhookIssues.some(event => event.stripeEventId === `${marker}-newer-event`)).toBe(false);

    const failurePage = await caller.getOperationalFailures({ limit: PAGE_SIZE });
    expect(failurePage.signals).toHaveLength(PAGE_SIZE);
    expect(failurePage.hasMore).toBe(true);
    expect(failurePage.nextCursor).toEqual({ id: expect.any(Number) });
    expect(failurePage.uniqueSignals).toBeGreaterThanOrEqual(ROW_COUNT);
    const updatedSignal = failurePage.signals.find(signal => signal.scope.startsWith(marker));
    expect(updatedSignal).toBeDefined();
    const updatedSignalId = updatedSignal!.id;
    await db.update(operationalFailureSignals)
      .set({ count: 7, lastOccurredAt: new Date(Date.now() + 15_000) })
      .where(eq(operationalFailureSignals.id, updatedSignalId));
    const [updatedSignalInDb] = await db.select({ count: operationalFailureSignals.count })
      .from(operationalFailureSignals)
      .where(eq(operationalFailureSignals.id, updatedSignalId));
    expect(updatedSignalInDb?.count).toBe(7);

    await db.insert(operationalFailureSignals).values({
      scope: `${marker}-newer`,
      operation: "synthetic-queue-test",
      count: 1,
      firstOccurredAt: new Date(Date.now() + 20_000),
      lastOccurredAt: new Date(Date.now() + 20_000),
    });

    const failures = await collectFailurePages(failurePage, (cursor) => caller.getOperationalFailures({
      limit: PAGE_SIZE,
      cursor,
    }));
    const markerFailures = failures.filter(signal => signal.scope.startsWith(marker));
    expect(markerFailures).toHaveLength(ROW_COUNT);
    expect(new Set(markerFailures.map(signal => signal.id)).size).toBe(ROW_COUNT);
    expect(markerFailures.some(signal => signal.scope === `${marker}-newer`)).toBe(false);
    expect(markerFailures.find(signal => signal.id === updatedSignalId)?.count).toBe(1);

    const refreshedFailurePage = await caller.getOperationalFailures({ limit: PAGE_SIZE });
    expect(refreshedFailurePage.signals[0]?.scope).toBe(`${marker}-newer`);
    expect(refreshedFailurePage.uniqueSignals).toBe(failurePage.uniqueSignals + 1);
    const [lowestFailure] = await db.select({ id: operationalFailureSignals.id })
      .from(operationalFailureSignals)
      .orderBy(asc(operationalFailureSignals.id))
      .limit(1);
    const emptyFailurePage = await caller.getOperationalFailures({
      limit: PAGE_SIZE,
      cursor: { id: lowestFailure!.id },
    });
    expect(emptyFailurePage.signals).toHaveLength(0);
    expect(emptyFailurePage.hasMore).toBe(false);
    expect(emptyFailurePage.nextCursor).toBeNull();
  });

  it("keeps cursor ordering stable across status updates and rejects unauthorized or invalid requests", async () => {
    const caller = adminRouter.createCaller(createAdminContext());
    const openFirstPage = await caller.getReviewQueue({ status: "open", limit: 10 });
    expect(openFirstPage.total).toBe(52);
    const itemToResolve = openFirstPage.items[0];
    await db.update(adminReviewItems).set({ status: "resolved" })
      .where(and(eq(adminReviewItems.id, itemToResolve!.id), eq(adminReviewItems.userId, userId)));

    const nextOpenPage = await caller.getReviewQueue({
      status: "open",
      limit: 10,
      cursor: openFirstPage.nextCursor!,
    });
    expect(nextOpenPage.total).toBe(51);
    expect(nextOpenPage.items.some(item => item.id === itemToResolve!.id)).toBe(false);
    expect(nextOpenPage.items.some(item => openFirstPage.items.some(first => first.id === item.id))).toBe(false);

    const unauthorized = adminRouter.createCaller(createAdminContext("user"));
    await expect(unauthorized.getReviewQueue({ status: "all", limit: PAGE_SIZE }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(unauthorized.getSuccessFeeHolds({ limit: PAGE_SIZE }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(unauthorized.getStripeReconciliationStatus({ limit: PAGE_SIZE }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(unauthorized.getStripeWebhookIssues({ limit: PAGE_SIZE }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.listPendingVerifications({
      limit: 10,
      cursor: { timestamp: "not-a-date", id: 0 } as never,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.getOperationalFailures({
      limit: 10,
      cursor: { id: 0 },
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.getSuccessFeeHolds({
      limit: 10,
      cursor: { timestamp: "invalid", id: 0 } as never,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.getStripeReconciliationStatus({
      limit: 10,
      cursor: { timestamp: "invalid", id: 0 } as never,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.getStripeWebhookIssues({
      limit: 10,
      cursor: { timestamp: "invalid", id: 0 } as never,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(unauthorized.getOperationalFailures({ limit: PAGE_SIZE }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
