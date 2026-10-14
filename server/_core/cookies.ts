import type { CookieOptions, Request } from "express";
import { ENV } from "./env";

export function getSessionCookieOptions(
  req: Request,
  isProduction = ENV.isProduction
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  // Production cookies remain Secure even when TLS terminates before Express.
  const secure = isProduction || req.secure;

  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure,
  };
}
