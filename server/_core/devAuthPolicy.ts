import { isIP } from "node:net";
import type { Request } from "express";
import { ENV } from "./env";
import { requestOriginMatchesHost } from "./cookieOriginProtection";
import { resolveBindHost } from "./network";

function isLoopbackAddress(address: string | undefined) {
  if (!address) return false;
  const normalized = address.toLowerCase().split("%", 1)[0];
  if (normalized === "::1") return true;
  const mappedIpv4 = normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
  return isIP(mappedIpv4) === 4 && mappedIpv4.startsWith("127.");
}

function isLoopbackHostHeader(host: string | undefined) {
  if (!host) return false;
  try {
    const hostname = new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return hostname === "localhost" || hostname === "::1" || isLoopbackAddress(hostname);
  } catch {
    return false;
  }
}

export function isDevQaAuthDeploymentEnabled() {
  if (ENV.isProduction || !ENV.devQaAuthEnabled) return false;
  try {
    const bindHost = resolveBindHost(process.env.HOST);
    return bindHost === "127.0.0.1" || bindHost === "::1";
  } catch {
    return false;
  }
}

export function isDirectLoopbackDevQaRequest(req: Request) {
  if (!isDevQaAuthDeploymentEnabled()) return false;
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
  if (!isLoopbackHostHeader(req.get("host"))) return false;
  if (Object.keys(req.headers).some((name) => name === "forwarded" || name.startsWith("x-forwarded-"))) {
    return false;
  }
  return true;
}

export function isDevQaAuthWriteRequest(req: Request) {
  return req.method === "POST" && isDirectLoopbackDevQaRequest(req) && requestOriginMatchesHost(req);
}
