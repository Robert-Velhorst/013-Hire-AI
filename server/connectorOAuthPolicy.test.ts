import { describe, expect, it } from "vitest";
import {
  inspectConnectorOAuthPolicy,
  type ConnectorOAuthPolicyInput,
} from "./_core/connectorOAuthPolicy";

const configured: ConnectorOAuthPolicyInput = {
  connectorOAuthRedirectUri: "https://hire.example.test/api/connectors/oauth/callback",
  connectorTokenEncryptionKey: Buffer.alloc(32, 7).toString("base64"),
  connectorOAuthStateSecret: "connector-policy-state-secret-at-least-32-characters",
  googleOAuthClientId: "google-client-id",
  googleOAuthClientSecret: "google-client-secret",
  dropboxOAuthClientId: "",
  dropboxOAuthClientSecret: "",
  microsoftOAuthClientId: "",
  microsoftOAuthClientSecret: "",
  linkedInOAuthClientId: "",
  linkedInOAuthClientSecret: "",
  githubOAuthClientId: "",
  githubOAuthClientSecret: "",
};

describe("connector OAuth deployment policy", () => {
  it("treats a completely absent connector configuration as intentionally disabled", () => {
    const result = inspectConnectorOAuthPolicy(
      Object.fromEntries(Object.keys(configured).map((key) => [key, ""])) as unknown as ConnectorOAuthPolicyInput
    );

    expect(result).toEqual({ enabled: false, configuredProviders: [], issues: [] });
  });

  it("ignores unrelated fields when inspecting the full runtime environment", () => {
    const empty = Object.fromEntries(Object.keys(configured).map((key) => [key, ""]));
    const result = inspectConnectorOAuthPolicy({
      ...empty,
      appId: "hire-ai-production",
      databaseUrl: "mysql://configured",
    } as unknown as ConnectorOAuthPolicyInput);

    expect(result).toEqual({ enabled: false, configuredProviders: [], issues: [] });
  });

  it("accepts complete shared controls and provider credential pairs", () => {
    expect(inspectConnectorOAuthPolicy(configured)).toEqual({
      enabled: true,
      configuredProviders: ["gmail", "google_drive"],
      issues: [],
    });
  });

  it.each([
    [{ connectorOAuthStateSecret: "short" }, "state_signing_secret"],
    [{ connectorOAuthStateSecret: "hire-ai-local-dev-connector-state-secret" }, "state_signing_secret"],
    [{ connectorTokenEncryptionKey: Buffer.alloc(31).toString("base64") }, "token_encryption_key"],
    [{ connectorTokenEncryptionKey: `${Buffer.alloc(32).toString("base64")}garbage` }, "token_encryption_key"],
    [{ connectorOAuthRedirectUri: "http://public.example.test/api/connectors/oauth/callback" }, "redirect_uri"],
    [{ connectorOAuthRedirectUri: "https://hire.example.test/not-the-callback" }, "redirect_uri"],
    [{ connectorOAuthRedirectUri: "https://user:pass@hire.example.test/api/connectors/oauth/callback" }, "redirect_uri"],
    [{ googleOAuthClientSecret: "" }, "google_credentials"],
    [{ dropboxOAuthClientId: "dropbox-id", dropboxOAuthClientSecret: "" }, "dropbox_credentials"],
  ] as const)("rejects unsafe or partial connector configuration", (override, issue) => {
    const result = inspectConnectorOAuthPolicy({ ...configured, ...override });

    expect(result.enabled).toBe(true);
    expect(result.issues).toContain(issue);
  });

  it("rejects shared controls without any provider and provider credentials without shared controls", () => {
    const sharedOnly = inspectConnectorOAuthPolicy({
      ...configured,
      googleOAuthClientId: "",
      googleOAuthClientSecret: "",
    });
    const providerOnly = inspectConnectorOAuthPolicy({
      ...configured,
      connectorOAuthRedirectUri: "",
      connectorTokenEncryptionKey: "",
      connectorOAuthStateSecret: "",
    });

    expect(sharedOnly.issues).toContain("provider_credentials");
    expect(providerOnly.issues).toEqual(expect.arrayContaining([
      "redirect_uri",
      "token_encryption_key",
      "state_signing_secret",
    ]));
  });
});
