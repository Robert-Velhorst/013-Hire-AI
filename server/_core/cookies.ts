import type { CookieOptions, Request } from "express";
import { ENV } from "./env";

export function shouldUseSecureSessionCookie(isProduction: boolean, requestIsSecure: boolean) {
  return isProduction || requestIsSecure;
}

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  // Express derives `secure` from forwarded metadata only when the immediate
  // peer satisfies the app's explicit trusted-proxy policy.
  const secure = shouldUseSecureSessionCookie(ENV.isProduction, req.secure);

  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure,
  };
}
