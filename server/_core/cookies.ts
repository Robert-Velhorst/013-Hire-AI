import type { CookieOptions, Request } from "express";
import { ENV } from "./env";

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  // Production cookies stay secure even if proxy metadata is misconfigured.
  const secure = ENV.isProduction || req.secure;

  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure,
  };
}
