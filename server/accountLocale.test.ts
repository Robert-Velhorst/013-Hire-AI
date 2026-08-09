import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { getAuditEventsForUser, getUserByOpenId, upsertUser } from "./db";
import { appRouter } from "./routers";

async function createContext(openId: string): Promise<TrpcContext> {
  await upsertUser({ openId, name: "Locale User", locale: "en" });
  const user = await getUserByOpenId(openId);
  if (!user) throw new Error("Test user was not created");
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("account locale", () => {
  it("persists only the authenticated account locale and records an audit event", async () => {
    const context = await createContext("locale-owner");
    await createContext("locale-other");
    const caller = appRouter.createCaller(context);

    await expect(caller.auth.updateLocale({ locale: "nl" })).resolves.toEqual({ locale: "nl" });
    await upsertUser({ openId: "locale-owner", name: "Locale User Signed In Again" });

    expect((await getUserByOpenId("locale-owner"))?.locale).toBe("nl");
    expect((await getUserByOpenId("locale-other"))?.locale).toBe("en");
    const events = await getAuditEventsForUser(context.user!.id, 10);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "account_locale_updated",
        source: "auth.updateLocale",
        beforeState: JSON.stringify({ locale: "en" }),
        afterState: JSON.stringify({ locale: "nl" }),
      }),
    ]));
  });

  it("rejects unsupported locale values at the API boundary", async () => {
    const caller = appRouter.createCaller(await createContext("locale-invalid"));
    await expect(caller.auth.updateLocale({ locale: "fr" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
