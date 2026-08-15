import { describe, expect, it, vi } from "vitest";
import { getAuditEventsForUser } from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createAuthContext(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `public-social-profile-${userId}`,
      email: `public-social-profile-${userId}@example.local`,
      name: "Public Social Profile User",
      loginMethod: "test",
      role: "user",
      accountStatus: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("public social profile links", () => {
  it("stores validated Facebook and X/Twitter links without treating them as imported evidence", async () => {
    const userId = 710_101;
    const caller = appRouter.createCaller(createAuthContext(userId));

    const result = await caller.social.updatePublicProfiles({
      facebookUrl: "https://www.facebook.com/example.user",
      twitterUrl: "https://x.com/example_user",
    });
    const connections = await caller.social.getConnections();
    const auditEvents = await getAuditEventsForUser(userId, 10);

    expect(result.profiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ platform: "facebook", profileUrl: "https://www.facebook.com/example.user" }),
      expect.objectContaining({ platform: "twitter", profileUrl: "https://x.com/example_user" }),
    ]));
    expect(connections).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "facebook", connected: true }),
      expect.objectContaining({ type: "twitter", connected: true }),
    ]));
    expect(auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "public_social_profiles_updated",
        afterState: expect.stringContaining('"externalReadPerformed":false'),
      }),
    ]));
    expect(JSON.stringify(auditEvents)).not.toContain("example.user");
  });

  it("allows a user to clear one public social link without removing the other", async () => {
    const userId = 710_102;
    const caller = appRouter.createCaller(createAuthContext(userId));
    await caller.social.updatePublicProfiles({
      facebookUrl: "https://facebook.com/example.user",
      twitterUrl: "https://twitter.com/example_user",
    });

    const result = await caller.social.updatePublicProfiles({ facebookUrl: null });

    expect(result.profiles).toEqual([
      expect.objectContaining({ platform: "twitter", profileUrl: "https://twitter.com/example_user" }),
    ]);
  });

  it("rejects a URL that does not belong to the declared public platform", async () => {
    const caller = appRouter.createCaller(createAuthContext(710_103));

    await expect(caller.social.updatePublicProfiles({
      facebookUrl: "https://example.com/not-facebook",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.social.validateUrl({
      type: "twitter",
      url: "https://example.com/not-twitter",
    })).resolves.toMatchObject({ isValid: false });
  });
});
