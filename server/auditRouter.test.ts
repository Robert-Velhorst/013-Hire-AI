import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";
import { createAuditEvent, getAuditEventsForEntity } from "./db";

function createContext(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `audit-user-${userId}`,
      name: "Audit User",
      email: `audit-${userId}@example.local`,
      loginMethod: "test",
      role: "user",
      stripeCustomerId: null,
      accountStatus: "active",
      tosAcceptedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("audit router", () => {
  it("returns only audit events for the authenticated user", async () => {
    const userId = 97101;
    const otherUserId = 97102;
    const entityId = 42001;

    await createAuditEvent({
      userId,
      entityType: "application",
      entityId,
      action: "approval_requested",
      actor: "system",
      source: "auditRouter.test",
      riskLevel: "high",
    });
    await createAuditEvent({
      userId: otherUserId,
      entityType: "application",
      entityId,
      action: "other_user_approval_requested",
      actor: "system",
      source: "auditRouter.test",
      riskLevel: "high",
    });

    const caller = appRouter.createCaller(createContext(userId));
    const userEvents = await caller.audit.getForUser({ limit: 10 });
    const entityEvents = await caller.audit.getForEntity({
      entityType: "application",
      entityId,
    });

    expect(userEvents.some((event) => event.action === "approval_requested")).toBe(true);
    expect(userEvents.some((event) => event.action === "other_user_approval_requested")).toBe(false);
    expect(entityEvents).toHaveLength(1);
    expect(entityEvents[0].action).toBe("approval_requested");
  });

  it("bounds interactive entity history while retaining the complete internal ledger", async () => {
    const userId = 97103;
    const entityId = 42002;
    for (let index = 0; index < 12; index += 1) {
      await createAuditEvent({
        userId,
        entityType: "application",
        entityId,
        action: `bounded_event_${index}`,
        actor: "system",
        source: "auditRouter.test",
        riskLevel: "low",
      });
    }

    const caller = appRouter.createCaller(createContext(userId));
    const visibleEvents = await caller.audit.getForEntity({
      entityType: "application",
      entityId,
      limit: 5,
    });

    expect(visibleEvents).toHaveLength(5);
    expect(await getAuditEventsForEntity(userId, "application", entityId)).toHaveLength(12);
  });
});
