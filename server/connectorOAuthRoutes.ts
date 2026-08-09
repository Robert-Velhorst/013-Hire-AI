import type { Express, Request, Response } from "express";
import {
  encryptConnectorToken,
  exchangeConnectorAuthorizationCode,
  getConnectorOAuthConfig,
  isOAuthConnectorProvider,
  verifyConnectorOAuthState,
} from "./connectorOAuth";
import {
  createAuditEvent,
  getUserConnectorAccount,
  upsertConnectorAuthorization,
  upsertUserConnectorAccount,
} from "./db";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

type ConnectorCallbackProvider = "gmail" | "google_drive" | "dropbox" | "outlook" | "linkedin" | "github";

function defaultConnectorConsentScopes(provider: ConnectorCallbackProvider) {
  switch (provider) {
    case "gmail":
      return ["email.metadata.read", "email.messages.read_recruiting"];
    case "outlook":
      return ["mail.metadata.read", "mail.messages.read_recruiting"];
    case "google_drive":
    case "dropbox":
      return ["files.metadata.read", "files.content.read_resume_candidates"];
    case "linkedin":
      return ["profile.basic.read"];
    case "github":
      return ["profile.basic.read", "repositories.metadata.read"];
  }
}

function allowedConnectorConsentScopes(provider: ConnectorCallbackProvider) {
  const baselineScopes = defaultConnectorConsentScopes(provider);
  if (provider === "gmail") return [...baselineScopes, "email.messages.send"];
  if (provider === "outlook") return [...baselineScopes, "mail.messages.send"];
  return baselineScopes;
}

export function connectorConsentScopes(
  provider: ConnectorCallbackProvider,
  requestedScopes: readonly string[] | undefined
) {
  const requested = requestedScopes?.map((scope) => scope.trim()).filter(Boolean);
  const allowed = new Set(allowedConnectorConsentScopes(provider));
  const baseline = defaultConnectorConsentScopes(provider);
  if (!requested || requested.length === 0 || baseline.some((scope) => !requested.includes(scope))) {
    return baseline;
  }
  return Array.from(new Set(requested.filter((scope) => allowed.has(scope))));
}

const requiredProviderScopes: Record<ConnectorCallbackProvider, readonly string[]> = {
  gmail: ["https://www.googleapis.com/auth/gmail.metadata"],
  google_drive: ["https://www.googleapis.com/auth/drive.readonly"],
  dropbox: ["files.metadata.read", "files.content.read"],
  outlook: ["Mail.Read"],
  linkedin: ["openid", "profile", "email"],
  github: ["read:user"],
};

/**
 * The internal consent labels describe the approved Hire.AI use case, while
 * OAuth scopes prove whether the provider token can perform it. Do not mark a
 * connector ready when those two records disagree.
 */
export function getMissingProviderScopes(
  provider: ConnectorCallbackProvider,
  grantedScopes: readonly string[],
  consentScopes: readonly string[] = defaultConnectorConsentScopes(provider)
) {
  const granted = new Set(grantedScopes.map((scope) => scope.trim()).filter(Boolean));
  const required = [...requiredProviderScopes[provider]];
  if (provider === "gmail" && consentScopes.includes("email.messages.send")) {
    required.push("https://www.googleapis.com/auth/gmail.send");
  }
  if (provider === "outlook" && consentScopes.includes("mail.messages.send")) {
    required.push("Mail.Send");
  }
  return required.filter((scope) => !granted.has(scope));
}

function completeRedirect(provider: string, status: "connected" | "denied" | "failed") {
  return `/profile?connector=${encodeURIComponent(provider)}&connectorStatus=${status}`;
}

export function registerConnectorOAuthRoutes(app: Express) {
  app.get("/api/connectors/oauth/callback", async (req: Request, res: Response) => {
    const state = getQueryParam(req, "state");
    const code = getQueryParam(req, "code");
    const providerError = getQueryParam(req, "error");
    if (!state) {
      res.status(400).json({ error: "Invalid connector authorization state." });
      return;
    }

    const verifiedState = verifyConnectorOAuthState(state);
    if (!verifiedState || !isOAuthConnectorProvider(verifiedState.provider)) {
      res.status(400).json({ error: "Invalid or expired connector authorization state." });
      return;
    }

    const provider = verifiedState.provider;
    const consentScopes = connectorConsentScopes(provider, verifiedState.consentScopes);
    const account = await getUserConnectorAccount(verifiedState.userId, provider);
    if (account?.status === "disabled") {
      res.redirect(302, completeRedirect(provider, "denied"));
      return;
    }

    if (providerError || !code) {
      if (account?.status !== "connected") {
        await upsertUserConnectorAccount({
          userId: verifiedState.userId,
          provider,
          status: "needs_reauth",
          consentScopes: JSON.stringify(consentScopes),
        });
      }
      await createAuditEvent({
        userId: verifiedState.userId,
        entityType: "user",
        entityId: verifiedState.userId,
        action: "connector_oauth_denied",
        actor: "user",
        source: "connectors.oauth.callback",
        afterState: JSON.stringify({
          provider,
          status: account?.status === "connected" ? "connected" : "needs_reauth",
          authorizationUpgradeCancelled: account?.status === "connected",
        }),
        riskLevel: "medium",
      });
      res.redirect(302, completeRedirect(provider, "denied"));
      return;
    }

    const config = getConnectorOAuthConfig(provider, undefined, consentScopes);
    if (!config) {
      res.status(503).json({ error: "Connector OAuth is not configured for this provider." });
      return;
    }

    try {
      const token = await exchangeConnectorAuthorizationCode(config, code);
      const missingScopes = getMissingProviderScopes(provider, token.grantedScopes, consentScopes);
      if (missingScopes.length > 0) {
        throw new Error("Required connector consent was not granted.");
      }
      await upsertConnectorAuthorization({
        userId: verifiedState.userId,
        provider,
        encryptedAccessToken: encryptConnectorToken(token.accessToken),
        encryptedRefreshToken: token.refreshToken ? encryptConnectorToken(token.refreshToken) : null,
        accessTokenExpiresAt: token.expiresAt,
        tokenType: token.tokenType,
        grantedScopes: JSON.stringify(token.grantedScopes),
      });
      await upsertUserConnectorAccount({
        userId: verifiedState.userId,
        provider,
        status: "connected",
        consentScopes: JSON.stringify(consentScopes),
        lastVerifiedAt: new Date(),
        disconnectedAt: null,
      });
      await createAuditEvent({
        userId: verifiedState.userId,
        entityType: "user",
        entityId: verifiedState.userId,
        action: "connector_oauth_connected",
        actor: "user",
        source: "connectors.oauth.callback",
        afterState: JSON.stringify({
          provider,
          status: "connected",
          tokenExpiresAt: token.expiresAt?.toISOString() ?? null,
        }),
        riskLevel: "medium",
      });
      res.redirect(302, completeRedirect(provider, "connected"));
    } catch {
      if (account?.status !== "connected") {
        await upsertUserConnectorAccount({
          userId: verifiedState.userId,
          provider,
          status: "needs_reauth",
          consentScopes: JSON.stringify(consentScopes),
        });
      }
      await createAuditEvent({
        userId: verifiedState.userId,
        entityType: "user",
        entityId: verifiedState.userId,
        action: "connector_oauth_failed",
        actor: "system",
        source: "connectors.oauth.callback",
        afterState: JSON.stringify({ provider, status: "needs_reauth" }),
        riskLevel: "medium",
      });
      res.redirect(302, completeRedirect(provider, "failed"));
    }
  });
}
