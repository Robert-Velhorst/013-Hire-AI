import { COOKIE_NAME } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { logOperationalFailure } from "../operationalFailureLog";
import { ENV } from "./env";
import { OAUTH_LOGIN_STATE_TTL_MS, createOAuthLoginState, verifyOAuthLoginState } from "./oauthState";
import { requireTrustedServiceBaseUrl } from "./trustedServiceUrl";

const OAUTH_STATE_COOKIE_NAME = "hire_ai_oauth_state";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/login", (req: Request, res: Response) => {
    try {
      if (!ENV.oAuthPortalUrl.trim()) {
        if (!ENV.isProduction) {
          res.redirect(302, "/api/dev/login");
          return;
        }
        res.status(503).json({ error: "OAuth login is not configured" });
        return;
      }
      const host = req.get("host");
      if (!host) {
        res.status(400).json({ error: "OAuth callback origin is invalid" });
        return;
      }
      const redirectUri = `${req.protocol}://${host}/api/oauth/callback`;
      const issued = createOAuthLoginState(redirectUri, ENV.cookieSecret);
      const portalUrl = requireTrustedServiceBaseUrl(ENV.oAuthPortalUrl);
      portalUrl.pathname = "/app-auth";
      portalUrl.searchParams.set("appId", ENV.appId);
      portalUrl.searchParams.set("redirectUri", redirectUri);
      portalUrl.searchParams.set("state", issued.state);
      portalUrl.searchParams.set("type", "signIn");
      res.cookie(OAUTH_STATE_COOKIE_NAME, issued.nonce, {
        ...getSessionCookieOptions(req),
        path: "/api/oauth/callback",
        maxAge: OAUTH_LOGIN_STATE_TTL_MS,
      });
      res.redirect(302, portalUrl.toString());
    } catch {
      logOperationalFailure("OAuth", "Login initiation");
      res.status(400).json({ error: "OAuth login could not be started" });
    }
  });

  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    const browserNonce = parseCookieHeader(req.headers.cookie || "")[OAUTH_STATE_COOKIE_NAME] || "";
    res.clearCookie(OAUTH_STATE_COOKIE_NAME, {
      ...getSessionCookieOptions(req),
      path: "/api/oauth/callback",
    });
    const verifiedState = verifyOAuthLoginState(state, browserNonce, ENV.cookieSecret);
    if (!verifiedState) {
      res.status(400).json({ error: "OAuth state is invalid or expired" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, verifiedState.redirectUri);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ENV.sessionTtlMs,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ENV.sessionTtlMs });

      res.redirect(302, "/");
    } catch {
      logOperationalFailure("OAuth", "Callback");
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
