import type { CookieOptions, Request } from "express";

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  // Express derives `secure` from forwarded metadata only when the immediate
  // peer satisfies the app's explicit trusted-proxy policy.
  const secure = req.secure;

  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure,
  };
}
