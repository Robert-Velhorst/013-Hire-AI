import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "@shared/const";
import type { TrpcContext } from "./_core/context";
import { ENV } from "./_core/env";
import * as connectorOAuth from "./connectorOAuth";
import * as database from "./db";
import { appRouter } from "./routers";

const userId = 928320;
const sessionCookie = "session-token-that-is-never-stored-in-the-intent";
const stateSecret = "connector-oauth-start-session-test-secret-32-bytes";
let originalRedirectUri: string;
let originalStateSecret: string;

function context(
  options: { cookie?: string; host?: string } = {}
): TrpcContext {
  return {
    user: {
      id: userId,
      openId: "connector-oauth-start-user",
      name: "OAuth Start User",
      email: "oauth-start@example.test",
      loginMethod: "test",
      role: "user",
      stripeCustomerId: null,
      accountStatus: "active",
      tosAcceptedAt: new Date(),
      sessionVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {
        cookie: options.cookie ? `${COOKIE_NAME}=${options.cookie}` : undefined,
      },
      get: (name: string) =>
        name.toLowerCase() === "host" ? options.host : undefined,
    } as unknown as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  originalRedirectUri = ENV.connectorOAuthRedirectUri;
  originalStateSecret = ENV.connectorOAuthStateSecret;
  ENV.connectorOAuthRedirectUri =
    "https://hire.example.test/api/connectors/oauth/callback";
  ENV.connectorOAuthStateSecret = stateSecret;
  vi.spyOn(connectorOAuth, "getConnectorOAuthAvailability").mockReturnValue({
    provider: "gmail",
    available: true,
  });
  vi.spyOn(connectorOAuth, "getConnectorOAuthConfig").mockReturnValue({
    provider: "gmail",
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    scopes: ["https://www.googleapis.com/auth/gmail.metadata"],
    authorizationParams: { access_type: "offline", prompt: "consent" },
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    redirectUri: ENV.connectorOAuthRedirectUri,
  });
  vi.spyOn(database, "getUserConnectorAccount").mockResolvedValue(null);
});

afterEach(() => {
  ENV.connectorOAuthRedirectUri = originalRedirectUri;
  ENV.connectorOAuthStateSecret = originalStateSecret;
  vi.restoreAllMocks();
});

describe("connector OAuth start session binding", () => {
  it("persists a session-bound one-time intent before returning provider state", async () => {
    const createIntent = vi.spyOn(database, "createConnectorOAuthIntent");
    const caller = appRouter.createCaller(
      context({ cookie: sessionCookie, host: "hire.example.test" })
    );

    const result = await caller.connectors.startOAuth({ provider: "gmail" });

    expect(result.success).toBe(true);
    expect(createIntent).toHaveBeenCalledTimes(1);
    const intent = createIntent.mock.calls[0]![0];
    expect(intent).toMatchObject({
      userId,
      provider: "gmail",
      consentScopes: JSON.stringify([
        "email.metadata.read",
        "email.messages.read_recruiting",
      ]),
      sessionBinding: connectorOAuth.createConnectorOAuthSessionBinding(
        sessionCookie,
        stateSecret
      ),
      applicationOrigin: "https://hire.example.test",
    });
    expect(intent.sessionBinding).not.toContain(sessionCookie);
    expect(
      new URL(result.authorizationUrl).searchParams.get("state")
    ).toBeTruthy();
  });

  it("rejects missing sessions and untrusted origins without creating an intent", async () => {
    const createIntent = vi.spyOn(database, "createConnectorOAuthIntent");
    const missingSession = appRouter.createCaller(
      context({ host: "hire.example.test" })
    );
    await expect(
      missingSession.connectors.startOAuth({ provider: "gmail" })
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });

    const wrongOrigin = appRouter.createCaller(
      context({ cookie: sessionCookie, host: "attacker.example.test" })
    );
    await expect(
      wrongOrigin.connectors.startOAuth({ provider: "gmail" })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(createIntent).not.toHaveBeenCalled();
  });
});
