import { describe, expect, it, vi } from "vitest";
import {
  buildConnectorAuthorizationUrl,
  createConnectorOAuthState,
  decryptConnectorToken,
  encryptConnectorToken,
  exchangeConnectorAuthorizationCode,
  getConnectorOAuthAvailability,
  getConnectorOAuthConfig,
  refreshConnectorAccessToken,
  verifyConnectorOAuthState,
  type ConnectorOAuthEnvironment,
} from "./connectorOAuth";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const environment: ConnectorOAuthEnvironment = {
  connectorOAuthRedirectUri: "https://hire.example.com/api/connectors/oauth/callback",
  connectorTokenEncryptionKey: encryptionKey,
  connectorOAuthStateSecret: "connector-state-secret-for-tests",
  googleOAuthClientId: "google-client-id",
  googleOAuthClientSecret: "google-client-secret",
  dropboxOAuthClientId: "dropbox-client-id",
  dropboxOAuthClientSecret: "dropbox-client-secret",
  microsoftOAuthClientId: "microsoft-client-id",
  microsoftOAuthClientSecret: "microsoft-client-secret",
  linkedInOAuthClientId: "linkedin-client-id",
  linkedInOAuthClientSecret: "linkedin-client-secret",
  githubOAuthClientId: "github-client-id",
  githubOAuthClientSecret: "github-client-secret",
};

describe("external connector OAuth boundary", () => {
  it("requires provider credentials, callback, state signing, and token encryption before OAuth is available", () => {
    expect(getConnectorOAuthAvailability("gmail", environment)).toMatchObject({
      provider: "gmail",
      available: true,
    });
    expect(getConnectorOAuthAvailability("gmail", {
      ...environment,
      connectorTokenEncryptionKey: "not-a-32-byte-key",
    }).available).toBe(false);
    expect(getConnectorOAuthAvailability("gmail", {
      ...environment,
      googleOAuthClientSecret: "",
    }).available).toBe(false);
    expect(getConnectorOAuthAvailability("gmail", {
      ...environment,
      connectorOAuthStateSecret: "short",
    }).available).toBe(false);
  });

  it("builds an authorization URL without including client secrets", () => {
    const config = getConnectorOAuthConfig("google_drive", environment)!;
    const state = createConnectorOAuthState(
      { provider: "google_drive", userId: 42 },
      environment.connectorOAuthStateSecret,
      1_000
    );
    const url = new URL(buildConnectorAuthorizationUrl(config, state));

    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe(environment.googleOAuthClientId);
    expect(url.searchParams.get("scope")).toContain("drive.readonly");
    expect(url.searchParams.get("state")).toBe(state);
    expect(url.toString()).not.toContain(environment.googleOAuthClientSecret);
  });

  it("keeps mailbox authorization read-only until explicit outbound-send consent is selected", () => {
    const config = getConnectorOAuthConfig("gmail", environment)!;
    const sendConfig = getConnectorOAuthConfig("gmail", environment, [
      "email.metadata.read",
      "email.messages.read_recruiting",
      "email.messages.send",
    ])!;

    expect(config.scopes).toEqual(["https://www.googleapis.com/auth/gmail.metadata"]);
    expect(sendConfig.scopes).toEqual([
      "https://www.googleapis.com/auth/gmail.metadata",
      "https://www.googleapis.com/auth/gmail.send",
    ]);
    expect(config.scopes).not.toContain("https://www.googleapis.com/auth/gmail.readonly");
    expect(getConnectorOAuthConfig("outlook", environment)!.scopes).toEqual(["offline_access", "Mail.Read"]);
    expect(getConnectorOAuthConfig("outlook", environment, ["mail.messages.send"])!.scopes).toContain("Mail.Send");
  });

  it("accepts only untampered, short-lived OAuth state", () => {
    const state = createConnectorOAuthState(
      { provider: "gmail", userId: 73 },
      environment.connectorOAuthStateSecret,
      1_000
    );

    expect(verifyConnectorOAuthState(state, environment.connectorOAuthStateSecret, 1_001)).toMatchObject({
      provider: "gmail",
      userId: 73,
    });
    expect(verifyConnectorOAuthState(`${state}x`, environment.connectorOAuthStateSecret, 1_001)).toBeNull();
    expect(verifyConnectorOAuthState(state, environment.connectorOAuthStateSecret, 1_000 + 10 * 60 * 1000 + 1)).toBeNull();
    expect(() => createConnectorOAuthState(
      { provider: "gmail", userId: 73 },
      "short",
      1_000
    )).toThrow("state signing is not configured");
  });

  it("encrypts provider tokens with authenticated encryption", () => {
    const encrypted = encryptConnectorToken("access-token-value", encryptionKey);

    expect(encrypted).not.toContain("access-token-value");
    expect(decryptConnectorToken(encrypted, encryptionKey)).toBe("access-token-value");
    expect(() => decryptConnectorToken(encrypted, Buffer.alloc(32, 8).toString("base64"))).toThrow(
      "could not be decrypted"
    );
  });

  it("exchanges a code through the configured token endpoint without returning secrets", async () => {
    const config = getConnectorOAuthConfig("gmail", environment)!;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      access_token: "provider-access-token",
      refresh_token: "provider-refresh-token",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "https://www.googleapis.com/auth/gmail.readonly",
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await exchangeConnectorAuthorizationCode(config, "authorization-code", fetcher);

    expect(result).toMatchObject({
      refreshToken: "provider-refresh-token",
      tokenType: "Bearer",
    });
    expect(result.accessToken).toBe("provider-access-token");
    expect(fetcher).toHaveBeenCalledWith(config.tokenEndpoint, expect.objectContaining({
      method: "POST",
      body: expect.stringContaining("grant_type=authorization_code"),
      redirect: "error",
      signal: expect.any(AbortSignal),
    }));
  });

  it("uses the same protected token endpoint to refresh an expiring connector grant", async () => {
    const config = getConnectorOAuthConfig("google_drive", environment)!;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      access_token: "refreshed-access-token",
      expires_in: 3600,
      token_type: "Bearer",
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await refreshConnectorAccessToken(config, "stored-refresh-token", fetcher);

    expect(result.accessToken).toBe("refreshed-access-token");
    expect(result.refreshToken).toBeNull();
    expect(fetcher).toHaveBeenCalledWith(config.tokenEndpoint, expect.objectContaining({
      method: "POST",
      body: expect.stringContaining("grant_type=refresh_token"),
      redirect: "error",
      signal: expect.any(AbortSignal),
    }));
  });

  it("rejects insecure token endpoints before sending client credentials", async () => {
    const config = {
      ...getConnectorOAuthConfig("gmail", environment)!,
      tokenEndpoint: "http://oauth.example.test/token",
    };
    const fetcher = vi.fn<typeof fetch>();

    await expect(exchangeConnectorAuthorizationCode(config, "authorization-code", fetcher))
      .rejects.toThrow("credential-free HTTPS");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects oversized token responses without exposing provider content", async () => {
    const config = getConnectorOAuthConfig("gmail", environment)!;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", {
      status: 200,
      headers: { "content-length": String(1024 * 1024 + 1) },
    }));

    await expect(exchangeConnectorAuthorizationCode(config, "authorization-code", fetcher))
      .rejects.toThrow("Connector OAuth token exchange failed");
  });

  it("rejects provider tokens that exceed the encrypted credential budget", async () => {
    const config = getConnectorOAuthConfig("gmail", environment)!;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      access_token: "a".repeat(16 * 1024 + 1),
      refresh_token: "provider-refresh-token",
    }), { status: 200 }));

    await expect(refreshConnectorAccessToken(config, "stored-refresh-token", fetcher))
      .rejects.toThrow("Connector OAuth token exchange failed");
  });
});
