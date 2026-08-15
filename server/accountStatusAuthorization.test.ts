import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { appRouter } from "./routers";

function context(accountStatus: "active" | "suspended" | "pending", role: "user" | "admin") {
  return {
    req: {},
    res: { clearCookie: vi.fn() },
    user: {
      id: 41,
      openId: "account-state-user",
      role,
      accountStatus,
    },
  } as unknown as TrpcContext;
}

const authorizationRouter = router({
  publicAccountState: publicProcedure.query(({ ctx }) => ctx.user?.accountStatus ?? null),
  protectedValue: protectedProcedure.query(({ ctx }) => ctx.user.id),
  adminValue: adminProcedure.query(({ ctx }) => ctx.user.id),
});

describe("account status authorization", () => {
  it("allows active accounts through protected and role-authorized admin procedures", async () => {
    await expect(
      authorizationRouter.createCaller(context("active", "user")).protectedValue()
    ).resolves.toBe(41);
    await expect(
      authorizationRouter.createCaller(context("active", "admin")).adminValue()
    ).resolves.toBe(41);
  });

  it.each(["suspended", "pending"] as const)(
    "blocks %s accounts from every protected procedure",
    async (accountStatus) => {
      await expect(
        authorizationRouter.createCaller(context(accountStatus, "user")).protectedValue()
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "This account is not active.",
      });
    }
  );

  it("blocks a suspended administrator before privileged authorization", async () => {
    await expect(
      authorizationRouter.createCaller(context("suspended", "admin")).adminValue()
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "This account is not active.",
    });
  });

  it("keeps public account-state reads available for restriction and logout UI", async () => {
    await expect(
      authorizationRouter.createCaller(context("suspended", "user")).publicAccountState()
    ).resolves.toBe("suspended");
  });

  it("keeps the real account-state and logout procedures available to a suspended user", async () => {
    const ctx = context("suspended", "user");
    const caller = appRouter.createCaller(ctx);

    await expect(caller.auth.me()).resolves.toMatchObject({
      id: 41,
      accountStatus: "suspended",
    });
    await expect(caller.auth.logout()).resolves.toEqual({ success: true });
    expect(ctx.res.clearCookie).toHaveBeenCalled();
  });
});
