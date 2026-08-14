import { COOKIE_NAME } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import type { Express, NextFunction, Request, Response } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function hasSessionCookie(req: Request) {
  const header = req.headers.cookie;
  if (!header) return false;
  try {
    return Boolean(parseCookieHeader(header)[COOKIE_NAME]);
  } catch {
    return false;
  }
}

export function requestOriginMatchesHost(req: Request) {
  const origin = req.get("origin");
  const host = req.get("host");
  if (!origin || !host) return false;

  try {
    return (
      new URL(origin).origin === new URL(`${req.protocol}://${host}`).origin
    );
  } catch {
    return false;
  }
}

export function requireCookieWriteOrigin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (SAFE_METHODS.has(req.method) || !hasSessionCookie(req)) {
    next();
    return;
  }

  if (!requestOriginMatchesHost(req)) {
    res.status(403).json({ error: "The request origin is not allowed." });
    return;
  }

  next();
}

export function registerCookieOriginProtection(app: Express) {
  app.use(requireCookieWriteOrigin);
}
