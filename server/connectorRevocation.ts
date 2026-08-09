import {
  getConnectorOAuthConfig,
  type OAuthConnectorProvider,
} from "./connectorOAuth";

export type ConnectorRevocationResult = {
  status: "revoked" | "manual_required";
  detail: string;
};

const MANUAL_REVOCATION: Partial<Record<OAuthConnectorProvider, string>> = {
  outlook:
    "Remove Hire.AI from Microsoft account permissions. Microsoft does not provide an app-scoped token revocation endpoint for this delegated connection.",
  linkedin:
    "Remove Hire.AI from LinkedIn permitted services. LinkedIn does not document an app-scoped token revocation endpoint for this connection.",
};

function basicAuthorization(clientId: string, clientSecret: string) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
}

async function requireSuccessfulRevocation(response: Response) {
  if (!response.ok) {
    throw new Error(
      `Connector provider revocation failed with HTTP ${response.status}.`
    );
  }
}

export async function revokeConnectorGrant(
  provider: OAuthConnectorProvider,
  accessToken: string,
  fetcher: typeof fetch = fetch
): Promise<ConnectorRevocationResult> {
  const manualDetail = MANUAL_REVOCATION[provider];
  if (manualDetail) return { status: "manual_required", detail: manualDetail };

  const signal = AbortSignal.timeout(15_000);
  if (provider === "gmail" || provider === "google_drive") {
    await requireSuccessfulRevocation(
      await fetcher("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: accessToken }),
        signal,
      })
    );
    return {
      status: "revoked",
      detail:
        "Google OAuth access was revoked. This also invalidates other Hire.AI Google grants for the same account.",
    };
  }

  if (provider === "dropbox") {
    await requireSuccessfulRevocation(
      await fetcher("https://api.dropboxapi.com/2/auth/token/revoke", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        signal,
      })
    );
    return { status: "revoked", detail: "Dropbox OAuth access was revoked." };
  }

  const config = getConnectorOAuthConfig("github");
  if (!config)
    throw new Error(
      "GitHub OAuth revocation is not configured for this deployment."
    );
  await requireSuccessfulRevocation(
    await fetcher(
      `https://api.github.com/applications/${encodeURIComponent(config.clientId)}/grant`,
      {
        method: "DELETE",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: basicAuthorization(
            config.clientId,
            config.clientSecret
          ),
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        body: JSON.stringify({ access_token: accessToken }),
        signal,
      }
    )
  );
  return {
    status: "revoked",
    detail: "GitHub OAuth authorization was revoked.",
  };
}
