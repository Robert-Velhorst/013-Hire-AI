import { afterEach, describe, expect, it } from "vitest";
import { ENV } from "./env";
import { sdk } from "./sdk";

const originalCookieSecret = ENV.cookieSecret;
const originalAppId = ENV.appId;

describe("session application binding", () => {
  afterEach(() => {
    ENV.cookieSecret = originalCookieSecret;
    ENV.appId = originalAppId;
  });

  it("rejects a validly signed session issued for another application", async () => {
    ENV.cookieSecret = "session-application-binding-secret";
    ENV.appId = "hire-ai-application";
    const token = await sdk.signSession({
      openId: "cross-application-user",
      appId: "another-application",
      name: "Cross Application User",
    });

    await expect(sdk.verifySession(token)).resolves.toBeNull();
  });

  it("accepts a valid session issued for the configured application", async () => {
    ENV.cookieSecret = "session-application-binding-secret";
    ENV.appId = "hire-ai-application";
    const token = await sdk.createSessionToken("hire-ai-user", {
      name: "Hire AI User",
    });

    await expect(sdk.verifySession(token)).resolves.toEqual({
      openId: "hire-ai-user",
      appId: "hire-ai-application",
      name: "Hire AI User",
    });
  });
});
