import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { getAuditEventsForUser } from "./db";
import { appRouter } from "./routers";

function createContext(userId: number, role: "user" | "admin" = "user"): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `privacy-review-${userId}`,
      name: role === "admin" ? "Privacy Admin" : "Privacy User",
      email: `privacy-review-${userId}@example.local`,
      loginMethod: "test",
      role,
      stripeCustomerId: null,
      accountStatus: "active",
      tosAcceptedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("privacy deletion review workflow", () => {
  it("creates one open review and returns only user-safe status fields", async () => {
    const caller = appRouter.createCaller(createContext(98101));

    const first = await caller.privacy.requestDeletion({ reason: "Remove my account." });
    const second = await caller.privacy.requestDeletion({ reason: "Remove my account." });
    const current = await caller.privacy.getDeletionRequest();

    expect(first).toMatchObject({ status: "open" });
    expect(second?.id).toBe(first?.id);
    expect(current?.id).toBe(first?.id);
    expect(current).not.toHaveProperty("description");
    expect(current).not.toHaveProperty("resolution");
    expect(current).not.toHaveProperty("assignedTo");
  });

  it("allows only the requesting user to cancel their open review", async () => {
    const owner = appRouter.createCaller(createContext(98102));
    const otherUser = appRouter.createCaller(createContext(98103));

    await owner.privacy.requestDeletion();
    await expect(otherUser.privacy.cancelDeletionRequest()).rejects.toThrow(
      "No open deletion request was found."
    );

    const cancelled = await owner.privacy.cancelDeletionRequest();
    expect(cancelled?.status).toBe("dismissed");
  });

  it("attributes the admin retention decision to the affected user without claiming deletion", async () => {
    const userId = 98104;
    const adminUserId = 98105;
    const userCaller = appRouter.createCaller(createContext(userId));
    const adminCaller = appRouter.createCaller(createContext(adminUserId, "admin"));
    const request = await userCaller.privacy.requestDeletion();
    const internalResolution = "Retain billing evidence; revoke eligible provider grants in separate execution work.";

    await adminCaller.admin.resolveReviewItem({
      reviewItemId: request!.id,
      status: "resolved",
      resolution: internalResolution,
    });

    const userEvents = await getAuditEventsForUser(userId, 20);
    const decisionEvent = userEvents.find((event) => event.action === "privacy_deletion_review_recorded");
    expect(decisionEvent).toBeDefined();
    expect(decisionEvent?.actor).toBe("admin");
    expect(decisionEvent?.afterState).toContain('"dataDeleted":false');
    expect(decisionEvent?.afterState).not.toContain(internalResolution);

    const current = await userCaller.privacy.getDeletionRequest();
    expect(current?.status).toBe("resolved");
  });
});
