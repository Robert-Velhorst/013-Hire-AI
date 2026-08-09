import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("provider event idempotency contracts", () => {
  it("locks the account before checking and recording employer response evidence", () => {
    const source = readFileSync(resolve(process.cwd(), "server", "applicationFeatures.ts"), "utf8");
    const transaction = source.slice(
      source.indexOf("return await db.transaction(async (tx) =>", source.indexOf("export async function recordEmployerResponse")),
      source.indexOf("export async function scheduleInterview")
    );

    const ownerLock = transaction.indexOf('.from(users)');
    const evidenceLookup = transaction.indexOf('.from(employerResponses)');
    const responseInsert = transaction.indexOf('tx.insert(employerResponses)');

    expect(ownerLock).toBeGreaterThanOrEqual(0);
    expect(transaction.slice(ownerLock, evidenceLookup)).toContain('.for("update")');
    expect(evidenceLookup).toBeGreaterThan(ownerLock);
    expect(responseInsert).toBeGreaterThan(evidenceLookup);
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
