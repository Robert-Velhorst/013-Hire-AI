import { COOKIE_NAME } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createContext } from "./context";
import { ENV } from "./env";
import { sdk } from "./sdk";

const originalOAuthServerUrl = ENV.oAuthServerUrl;
const originalCookieSecret = ENV.cookieSecret;
const originalAppId = ENV.appId;
const contextOptions = {
  req: { headers: {} },
  res: {},
} as CreateExpressContextOptions;

describe("tRPC context authentication failures", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    ENV.oAuthServerUrl = originalOAuthServerUrl;
    ENV.cookieSecret = originalCookieSecret;
    ENV.appId = originalAppId;
  });

  it("keeps an invalid session anonymous for public procedures", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockRejectedValue(
      ForbiddenError("Invalid session cookie")
    );

    await expect(createContext(contextOptions)).resolves.toMatchObject({
      user: null,
    });
  });

  it("propagates an authentication dependency failure", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockRejectedValue(
      new Error("database unavailable")
    );

    await expect(createContext(contextOptions)).rejects.toThrow(
      "database unavailable"
    );
  });

  it("reports an identity-provider outage instead of treating the session as logged out", async () => {
    ENV.oAuthServerUrl = "https://identity.example.test";
    ENV.cookieSecret = "context-provider-outage-secret";
    ENV.appId = "context-provider-outage-app";
    const token = await sdk.createSessionToken(
      `provider-outage-${Date.now()}-${Math.random()}`,
      { name: "Provider Outage User" }
    );
    vi.spyOn(
      (sdk as unknown as { client: { post: (...args: unknown[]) => unknown } })
        .client,
      "post"
    ).mockRejectedValue({
      isAxiosError: true,
      response: { status: 503 },
    });

    await expect(
      createContext({
        req: { headers: { cookie: `${COOKIE_NAME}=${token}` } },
        res: {},
      } as CreateExpressContextOptions)
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: "Authentication service unavailable",
    });
  });
});
