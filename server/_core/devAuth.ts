import { COOKIE_NAME } from "@shared/const";
import type { Express, Request, Response } from "express";
import { getUserByOpenId, upsertUser } from "../db";
import { seedDevAdminUser, seedDevReviewQueueUser } from "../devReviewQueueSeed";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import { sdk } from "./sdk";
import { logOperationalFailure } from "../operationalFailureLog";

const DEV_SESSION_MS = 1000 * 60 * 60 * 6;
const DEV_SESSION_SECRET = "hire-ai-review-queue-local-dev-secret";
const DEV_APP_ID = "hire-ai-review-queue-local-dev";
const DEV_SUSPENDED_OPEN_ID = "hire-ai-suspended-local-dev";

function getSafeRedirectPath(value: unknown, fallback: string) {
  if (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//")
  ) {
    return value;
  }

  return fallback;
}

function ensureDevSessionConfig() {
  if (!ENV.cookieSecret) {
    ENV.cookieSecret = DEV_SESSION_SECRET;
  }
  if (!ENV.appId) {
    ENV.appId = DEV_APP_ID;
  }
}

export function registerDevAuthRoutes(app: Express) {
  if (ENV.isProduction) {
    return;
  }

  app.get("/api/dev/login", async (req: Request, res: Response) => {
    try {
      ensureDevSessionConfig();
      const user = await seedDevReviewQueueUser();
      const sessionToken = await sdk.createSessionToken(user.openId, {
        name: user.name || "Review Queue QA",
        expiresInMs: DEV_SESSION_MS,
      });

      res.cookie(COOKIE_NAME, sessionToken, {
        ...getSessionCookieOptions(req),
        maxAge: DEV_SESSION_MS,
      });
      res.redirect(302, getSafeRedirectPath(req.query.redirect, "/dashboard"));
    } catch {
      logOperationalFailure("DevAuth", "Development session creation");
      res.status(500).json({ error: "Unable to create development session" });
    }
  });

  app.get("/api/dev/login-suspended", async (req: Request, res: Response) => {
    try {
      ensureDevSessionConfig();
      await upsertUser({
        openId: DEV_SUSPENDED_OPEN_ID,
        name: "Suspended Account QA",
        email: "suspended-account@hire-ai.local",
        loginMethod: "development",
        accountStatus: "suspended",
        lastSignedIn: new Date(),
      });
      const user = await getUserByOpenId(DEV_SUSPENDED_OPEN_ID);
      if (!user) throw new Error("Suspended development user was not persisted");
      const sessionToken = await sdk.createSessionToken(user.openId, {
        name: user.name || "Suspended Account QA",
        expiresInMs: DEV_SESSION_MS,
      });

      res.cookie(COOKIE_NAME, sessionToken, {
        ...getSessionCookieOptions(req),
        maxAge: DEV_SESSION_MS,
      });
      res.redirect(302, getSafeRedirectPath(req.query.redirect, "/dashboard"));
    } catch {
      logOperationalFailure("DevAuth", "Suspended development session creation");
      res.status(500).json({ error: "Unable to create suspended development session" });
    }
  });

  app.get("/api/dev/login-review-queue", async (req: Request, res: Response) => {
    try {
      ensureDevSessionConfig();
      const user = await seedDevReviewQueueUser();
      const sessionToken = await sdk.createSessionToken(user.openId, {
        name: user.name || "Review Queue QA",
        expiresInMs: DEV_SESSION_MS,
      });

      res.cookie(COOKIE_NAME, sessionToken, {
        ...getSessionCookieOptions(req),
        maxAge: DEV_SESSION_MS,
      });
      res.redirect(302, "/review-queue");
    } catch {
      logOperationalFailure("DevAuth", "Review queue session creation");
      res.status(500).json({ error: "Unable to create development review queue session" });
    }
  });

  app.get("/api/dev/login-admin", async (req: Request, res: Response) => {
    try {
      ensureDevSessionConfig();
      const user = await seedDevAdminUser();
      const sessionToken = await sdk.createSessionToken(user.openId, {
        name: user.name || "Admin QA",
        expiresInMs: DEV_SESSION_MS,
      });

      res.cookie(COOKIE_NAME, sessionToken, {
        ...getSessionCookieOptions(req),
        maxAge: DEV_SESSION_MS,
      });
      res.redirect(302, "/admin");
    } catch {
      logOperationalFailure("DevAuth", "Admin session creation");
      res.status(500).json({ error: "Unable to create development admin session" });
    }
  });
}
