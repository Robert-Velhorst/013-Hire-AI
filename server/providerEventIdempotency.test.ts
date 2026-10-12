import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("provider event idempotency contracts", () => {
  it("locks the account before checking and recording employer response evidence", () => {
    const source = readFileSync(resolve(process.cwd(), "server", "applicationFeatures.ts"), "utf8");
    const transaction = source.slice(
      source.indexOf("const persist = async (tx: DatabaseTransaction)", source.indexOf("export async function recordEmployerResponse")),
      source.indexOf("// ==================== INTERVIEW SCHEDULING ====================")
    );

    const ownerLock = transaction.indexOf('.from(users)');
    const evidenceLookup = transaction.indexOf('.from(employerResponses)');
    const responseInsert = transaction.indexOf('tx.insert(employerResponses)');

    expect(ownerLock).toBeGreaterThanOrEqual(0);
    expect(transaction.slice(ownerLock, evidenceLookup)).toContain('.for("update")');
    expect(evidenceLookup).toBeGreaterThan(ownerLock);
    expect(responseInsert).toBeGreaterThan(evidenceLookup);
    expect(source).toContain("return transaction ? persist(transaction) : db.transaction(persist);");
  });

  it("commits interview outcomes with employer response evidence in one database transaction", () => {
    const source = readFileSync(resolve(process.cwd(), "server", "applicationFeatures.ts"), "utf8");
    const outcome = source.slice(
      source.indexOf("export async function recordInterviewOutcome"),
      source.indexOf("export async function rescheduleInterview")
    );
    const transaction = outcome.slice(outcome.indexOf("return await db.transaction(async (tx) => {"));

    expect(transaction).toContain("await recordEmployerResponse(responseInput, userId, tx)");
    expect(transaction.indexOf("await recordEmployerResponse(responseInput, userId, tx)")).toBeLessThan(
      transaction.indexOf('action: "interview_outcome_recorded"')
    );
  });

  it("keeps interview status, reschedule approval, activity, and audit writes transactional", () => {
    const source = readFileSync(resolve(process.cwd(), "server", "applicationFeatures.ts"), "utf8");
    const statusUpdate = source.slice(
      source.indexOf("export async function updateInterviewStatus"),
      source.indexOf("export type InterviewOutcomeType")
    );
    const reschedule = source.slice(
      source.indexOf("export async function rescheduleInterview"),
      source.indexOf("// ==================== FOLLOW-UP EMAILS ====================")
    );

    expect(statusUpdate).toContain("return await db.transaction(async (tx) => {");
    expect(statusUpdate).toContain("await tx.insert(auditEvents).values({");
    expect(reschedule).toContain("return await db.transaction(async (tx) => {");
    expect(reschedule).toContain("await tx.insert(applicationApprovals).values({");
    expect(reschedule).toContain(".set({ lastActivity: newDate })");
    expect(reschedule).toContain("await tx.insert(auditEvents).values({");
  });

  it("creates interview notifications with one atomic idempotent insert", () => {
    const source = readFileSync(resolve(process.cwd(), "server", "db.ts"), "utf8");
    const createNotification = source.slice(
      source.indexOf("export async function createInterviewNotification"),
      source.indexOf("export async function listUnreadInterviewNotifications")
    );

    expect(createNotification).toContain(".onDuplicateKeyUpdate({");
    expect(createNotification).toContain("LAST_INSERT_ID(${applicationNotifications.id})");
    expect(createNotification.match(/\.insert\(applicationNotifications\)/g)).toHaveLength(1);
  });
});
