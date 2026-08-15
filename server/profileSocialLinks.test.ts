import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import { getUserProfile } from "./db";
import type { TrpcContext } from "./_core/context";

function createAuthContext(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `profile-social-links-${userId}`,
      email: `profile-social-links-${userId}@example.com`,
      name: "Profile Social Links Test",
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

describe("profile social links", () => {
  it("persists explicit clears without changing the other profile fields", async () => {
    const userId = 710_001;
    const caller = appRouter.createCaller(createAuthContext(userId));

    await caller.profile.update({
      linkedinUrl: "https://www.linkedin.com/in/example-user",
      githubUrl: "https://github.com/example-user",
      portfolioUrl: "https://example-user.dev",
    });

    await caller.profile.update({
      linkedinUrl: null,
      githubUrl: null,
      portfolioUrl: null,
    });

    await expect(getUserProfile(userId)).resolves.toMatchObject({
      linkedinUrl: null,
      githubUrl: null,
      portfolioUrl: null,
    });
  });
});
