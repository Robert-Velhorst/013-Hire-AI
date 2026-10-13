import type { Express } from "express";
import { isIP } from "node:net";

export const TRUSTED_PROXY_RANGE = "loopback";
export const DEFAULT_TRUSTED_PROXY_IPS = [TRUSTED_PROXY_RANGE];

export function parseTrustedProxyIps(
  value: string | undefined,
  isProduction: boolean
): string[] {
  const configured = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const addresses = configured?.length
    ? Array.from(new Set(configured))
    : isProduction
      ? []
      : DEFAULT_TRUSTED_PROXY_IPS;

  if (addresses.length > 16) {
    throw new Error("TRUSTED_PROXY_IPS may contain at most 16 entries.");
  }

  for (const address of addresses) {
    if (address === TRUSTED_PROXY_RANGE) continue;
    const family = isIP(address);
    if (
      family === 0 ||
      address === "0.0.0.0" ||
      address === "255.255.255.255" ||
      address === "::"
    ) {
      throw new Error(
        "TRUSTED_PROXY_IPS must contain exact IP addresses or the loopback token; CIDRs, hostnames, and wildcard addresses are not allowed."
      );
    }
  }

  return addresses;
}

/**
 * Local Windows/ngrok uses loopback. Production must add the exact peer IP for
 * its reverse proxy; never trust a network range or an arbitrary hop count.
 */
export function applyTrustedProxyPolicy(
  app: Express,
  trustedProxyIps: string[] = DEFAULT_TRUSTED_PROXY_IPS
) {
  app.set("trust proxy", trustedProxyIps);
}
