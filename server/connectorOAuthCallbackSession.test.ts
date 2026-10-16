import express from "express";
import { createServer, request as httpRequest, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "@shared/const";
import { ENV } from "./_core/env";
import { sdk } from "./_core/sdk";
import * as connectorOAuth from "./connectorOAuth";
import * as database from "./db";
import { registerConnectorOAuthRoutes } from "./connectorOAuthRoutes";

const servers: Server[] = [];
const baselineScopes = [
  "email.metadata.read",
  "email.messages.read_recruiting",
];
const sendScopes = [...baselineScopes, "email.messages.send"];
const stateSecret = "connector-oauth-session-binding-test-secret-32-bytes";
let originalRedirectUri: string;
let originalStateSecret: string;

async function startServer() {
  const app = express();
  app.set("trust proxy", true);
  registerConnectorOAuthRoutes(app);
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test server did not bind.");
  return `http://127.0.0.1:${address.port}`;
}

async function callback(
  baseUrl: string,
  state: string,
  options: {
    cookie?: string;
    code?: string;
    error?: string;
    host?: string;
  } = {}
) {
  const query = new URLSearchParams({ state });
  if (options.code) query.set("code", options.code);
  if (options.error) query.set("error", options.error);
  const target = new URL(baseUrl);
  return await new Promise<{
    status: number;
    location: string | undefined;
    body: string;
  }>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: `/api/connectors/oauth/callback?${query}`,
        method: "GET",
        headers: {
          host: options.host ?? "hire.example.test",
          "x-forwarded-proto": "https",
          ...(options.cookie
            ? { cookie: `${COOKIE_NAME}=${options.cookie}` }
            : {}),
        },
      },
      response => {
        const chunks: Buffer[] = [];
        response.on("data", chunk => chunks.push(Buffer.from(chunk)));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            location: response.headers.location,
            body: Buffer.concat(chunks).toString("utf8"),
          })
        );
      }
    );
    request.on("error", reject);
    request.end();
  });
}

function signedState(
  provider: connectorOAuth.OAuthConnectorProvider = "gmail",
  consentScopes = baselineScopes
) {
  return connectorOAuth.createConnectorOAuthState(
    {
      provider,
      userId: 928310,
      consentScopes,
    },
    stateSecret
  );
}

let intentConsumed: boolean;
let consumeIntent: ReturnType<typeof vi.spyOn>;
let activeIntentConsentScopes: string;
let activeSessionBinding: string;

beforeEach(() => {
  vi.restoreAllMocks();
  originalRedirectUri = ENV.connectorOAuthRedirectUri;
  originalStateSecret = ENV.connectorOAuthStateSecret;
  ENV.connectorOAuthRedirectUri =
    "https://hire.example.test/api/connectors/oauth/callback";
  ENV.connectorOAuthStateSecret = stateSecret;
  intentConsumed = false;
  activeIntentConsentScopes = JSON.stringify(baselineScopes);
  activeSessionBinding = connectorOAuth.createConnectorOAuthSessionBinding(
    "initiating-session",
    stateSecret
  );
  vi.spyOn(sdk, "authenticateRequest").mockResolvedValue({
    id: 928310,
    accountStatus: "active",
  } as Awaited<ReturnType<typeof sdk.authenticateRequest>>);
  consumeIntent = vi
    .spyOn(database, "consumeConnectorOAuthIntent")
    .mockImplementation(async input => {
      if (
        intentConsumed ||
        input.userId !== 928310 ||
        input.provider !== "gmail" ||
        input.consentScopes !== activeIntentConsentScopes ||
        input.sessionBinding !== activeSessionBinding ||
        input.applicationOrigin !== "https://hire.example.test"
      ) {
        return false;
      }
      intentConsumed = true;
      return true;
    });
  vi.spyOn(database, "getUserConnectorAccount").mockResolvedValue(null);
  vi.spyOn(database, "upsertConnectorAuthorization").mockResolvedValue(
    undefined as never
  );
  vi.spyOn(database, "upsertUserConnectorAccount").mockResolvedValue(
    undefined as never
  );
  vi.spyOn(database, "createAuditEvent").mockResolvedValue(undefined as never);
  vi.spyOn(connectorOAuth, "getConnectorOAuthCallbackOrigin").mockReturnValue(
    "https://hire.example.test"
  );
  vi.spyOn(connectorOAuth, "getConnectorOAuthConfig").mockReturnValue(
    {} as never
  );
  vi.spyOn(connectorOAuth, "encryptConnectorToken").mockReturnValue(
    "encrypted-token"
  );
  vi.spyOn(
    connectorOAuth,
    "exchangeConnectorAuthorizationCode"
  ).mockResolvedValue({
    accessToken: "provider-access-token",
    refreshToken: "provider-refresh-token",
    expiresAt: new Date(Date.now() + 3_600_000),
    accessTokenLifetime: "expiring",
    tokenType: "Bearer",
    grantedScopes: ["https://www.googleapis.com/auth/gmail.metadata"],
    scopeWasReturned: true,
  });
});

afterEach(async () => {
  ENV.connectorOAuthRedirectUri = originalRedirectUri;
  ENV.connectorOAuthStateSecret = originalStateSecret;
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>(resolve => {
          server.close(() => resolve());
          server.closeAllConnections();
        })
    )
  );
  vi.restoreAllMocks();
});

describe("connector OAuth callback session binding", () => {
  it("rate-limits invalid callback bursts before OAuth work", async () => {
    const server = await startServer();
    const responses = await Promise.all(
      Array.from({ length: 31 }, () => callback(server, "invalid-state"))
    );

    expect(responses.filter((response) => response.status === 429)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 400)).toHaveLength(30);
    expect(consumeIntent).not.toHaveBeenCalled();
    expect(connectorOAuth.exchangeConnectorAuthorizationCode).not.toHaveBeenCalled();
  });

  it("connects only after the initiating session consumes its matching intent", async () => {
    const server = await startServer();
    const state = signedState();

    const response = await callback(server, state, {
      cookie: "initiating-session",
      code: "provider-code",
    });

    expect(sdk.authenticateRequest).toHaveBeenCalled();
    expect(response.status, response.body).toBe(302);
    expect(response.location).toBe(
      "/profile?connector=gmail&connectorStatus=connected"
    );
    expect(consumeIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 928310,
        provider: "gmail",
        consentScopes: JSON.stringify(baselineScopes),
        sessionBinding: connectorOAuth.createConnectorOAuthSessionBinding(
          "initiating-session",
          stateSecret
        ),
        applicationOrigin: "https://hire.example.test",
      })
    );
    expect(
      connectorOAuth.exchangeConnectorAuthorizationCode
    ).toHaveBeenCalledTimes(1);
    expect(database.upsertConnectorAuthorization).toHaveBeenCalledTimes(1);
  });

  it("requires the original active session and rejects logout or a different signed-in user before token exchange", async () => {
    const server = await startServer();
    const state = signedState();
    const loggedOut = await callback(server, state, { code: "provider-code" });
    expect(loggedOut.status).toBe(400);
    expect(sdk.authenticateRequest).not.toHaveBeenCalled();

    vi.mocked(sdk.authenticateRequest).mockResolvedValueOnce({
      id: 928311,
      accountStatus: "active",
    } as Awaited<ReturnType<typeof sdk.authenticateRequest>>);
    const otherUser = await callback(server, state, {
      cookie: "other-session",
      code: "provider-code",
    });
    expect(otherUser.status).toBe(400);
    expect(consumeIntent).not.toHaveBeenCalled();
    expect(
      connectorOAuth.exchangeConnectorAuthorizationCode
    ).not.toHaveBeenCalled();

    vi.mocked(sdk.authenticateRequest).mockResolvedValueOnce({
      id: 928310,
      accountStatus: "active",
    } as Awaited<ReturnType<typeof sdk.authenticateRequest>>);
    const otherBrowser = await callback(server, state, {
      cookie: "different-browser-session",
      code: "provider-code",
    });
    expect(otherBrowser.status).toBe(400);
    expect(consumeIntent).toHaveBeenCalledTimes(1);
    expect(
      connectorOAuth.exchangeConnectorAuthorizationCode
    ).not.toHaveBeenCalled();
  });

  it("rejects a revoked session before consuming the intent", async () => {
    const server = await startServer();
    const state = signedState();
    vi.mocked(sdk.authenticateRequest).mockRejectedValueOnce(
      new Error("Session revoked")
    );

    const response = await callback(server, state, {
      cookie: "revoked-session",
      code: "provider-code",
    });

    expect(response.status).toBe(400);
    expect(consumeIntent).not.toHaveBeenCalled();
    expect(
      connectorOAuth.exchangeConnectorAuthorizationCode
    ).not.toHaveBeenCalled();
  });

  it("rejects a suspended account even if the old browser cookie still authenticates", async () => {
    const server = await startServer();
    const state = signedState();
    vi.mocked(sdk.authenticateRequest).mockResolvedValueOnce({
      id: 928310,
      accountStatus: "suspended",
    } as Awaited<ReturnType<typeof sdk.authenticateRequest>>);

    const response = await callback(server, state, {
      cookie: "initiating-session",
      code: "provider-code",
    });

    expect(response.status).toBe(400);
    expect(consumeIntent).not.toHaveBeenCalled();
    expect(
      connectorOAuth.exchangeConnectorAuthorizationCode
    ).not.toHaveBeenCalled();
  });

  it("rejects provider- and scope-swapped state before token exchange", async () => {
    const server = await startServer();
    const wrongProvider = await callback(server, signedState("google_drive"), {
      cookie: "initiating-session",
      code: "provider-code",
    });
    expect(wrongProvider.status).toBe(400);

    const wrongScopes = await callback(
      server,
      signedState("gmail", sendScopes),
      {
        cookie: "initiating-session",
        code: "provider-code",
      }
    );
    expect(wrongScopes.status).toBe(400);
    expect(
      connectorOAuth.exchangeConnectorAuthorizationCode
    ).not.toHaveBeenCalled();
  });

  it("rejects callbacks sent to a different application origin", async () => {
    const server = await startServer();
    const response = await callback(server, signedState(), {
      cookie: "initiating-session",
      code: "provider-code",
      host: "other.example.test",
    });

    expect(response.status).toBe(400);
    expect(consumeIntent).not.toHaveBeenCalled();
    expect(
      connectorOAuth.exchangeConnectorAuthorizationCode
    ).not.toHaveBeenCalled();
  });

  it("completes an explicit consent upgrade without a second callback consuming the same intent", async () => {
    const server = await startServer();
    activeIntentConsentScopes = JSON.stringify(sendScopes);
    vi.spyOn(database, "getUserConnectorAccount").mockResolvedValue({
      status: "connected",
    } as never);
    vi.mocked(
      connectorOAuth.exchangeConnectorAuthorizationCode
    ).mockResolvedValueOnce({
      accessToken: "provider-access-token",
      refreshToken: "provider-refresh-token",
      expiresAt: new Date(Date.now() + 3_600_000),
      accessTokenLifetime: "expiring",
      tokenType: "Bearer",
      grantedScopes: [
        "https://www.googleapis.com/auth/gmail.metadata",
        "https://www.googleapis.com/auth/gmail.send",
      ],
      scopeWasReturned: true,
    });
    const state = signedState("gmail", sendScopes);

    const [first, concurrent] = await Promise.all([
      callback(server, state, {
        cookie: "initiating-session",
        code: "provider-code",
      }),
      callback(server, state, {
        cookie: "initiating-session",
        code: "provider-code",
      }),
    ]);

    expect([first.status, concurrent.status].sort()).toEqual([302, 400]);
    expect(
      connectorOAuth.exchangeConnectorAuthorizationCode
    ).toHaveBeenCalledTimes(1);
    expect(database.upsertUserConnectorAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "connected",
        consentScopes: JSON.stringify(sendScopes),
      })
    );
  });

  it("keeps an existing connector connected when an optional consent upgrade is denied", async () => {
    const server = await startServer();
    activeIntentConsentScopes = JSON.stringify(sendScopes);
    vi.spyOn(database, "getUserConnectorAccount").mockResolvedValue({
      status: "connected",
    } as never);

    const response = await callback(server, signedState("gmail", sendScopes), {
      cookie: "initiating-session",
      error: "access_denied",
    });

    expect(response.status).toBe(302);
    expect(response.location).toBe(
      "/profile?connector=gmail&connectorStatus=denied"
    );
    expect(database.upsertUserConnectorAccount).not.toHaveBeenCalled();
    expect(database.createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "connector_oauth_denied",
        afterState: expect.stringContaining("authorizationUpgradeCancelled"),
      })
    );
  });

  it("consumes provider denial and rejects retry after a failed token exchange", async () => {
    const server = await startServer();
    const denied = await callback(server, signedState(), {
      cookie: "initiating-session",
      error: "access_denied",
    });
    expect(denied.status).toBe(302);
    expect(denied.location).toBe(
      "/profile?connector=gmail&connectorStatus=denied"
    );
    expect(
      connectorOAuth.exchangeConnectorAuthorizationCode
    ).not.toHaveBeenCalled();

    intentConsumed = false;
    vi.mocked(
      connectorOAuth.exchangeConnectorAuthorizationCode
    ).mockRejectedValueOnce(new Error("Provider unavailable"));
    const retryState = signedState();
    const failed = await callback(server, retryState, {
      cookie: "initiating-session",
      code: "one-use-code",
    });
    const retry = await callback(server, retryState, {
      cookie: "initiating-session",
      code: "one-use-code",
    });

    expect(failed.status).toBe(302);
    expect(failed.location).toBe(
      "/profile?connector=gmail&connectorStatus=failed"
    );
    expect(retry.status).toBe(400);
    expect(
      connectorOAuth.exchangeConnectorAuthorizationCode
    ).toHaveBeenCalledTimes(1);
  });
});
