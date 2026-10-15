import { isIP } from "node:net";

export const DEFAULT_TRUSTED_PROXY_IPS = Object.freeze(["127.0.0.1", "::1"]);
const MAX_TRUSTED_PROXY_IPS = 16;

function normalizeAddress(value) {
  if (typeof value !== "string") return null;
  let address = value.trim().toLowerCase();
  if (
    !address ||
    isIP(address) === 0 ||
    address === "0.0.0.0" ||
    address === "::"
  )
    return null;
  if (address.startsWith("::ffff:")) {
    const tail = address.slice("::ffff:".length);
    if (isIP(tail) === 4) address = tail;
  }
  if (isIP(address) === 6) {
    address = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    if (address.startsWith("::ffff:")) {
      const tail = address.slice("::ffff:".length);
      if (isIP(tail) === 4) {
        address = tail;
      } else {
        const groups = tail.split(":");
        if (groups.length === 2 || groups.length === 1) {
          const numeric = groups.reduce(
            (value, group) => value * 0x10000n + BigInt(`0x${group}`),
            0n
          );
          address = [24n, 16n, 8n, 0n]
            .map(shift => Number((numeric >> shift) & 255n))
            .join(".");
        }
      }
    }
  }
  if (address === "0.0.0.0" || address === "::") return null;
  return address;
}

export function resolveTrustedProxyPolicy(value, isProduction = false) {
  const configured = typeof value === "string" ? value.trim() : "";
  if (!configured) {
    return isProduction
      ? {
          addresses: [],
          issue:
            "TRUSTED_PROXY_IPS is required in production and must list exact immediate proxy IP addresses.",
        }
      : { addresses: [...DEFAULT_TRUSTED_PROXY_IPS], issue: null };
  }

  const entries = configured.split(",").map(entry => entry.trim());
  if (entries.length > MAX_TRUSTED_PROXY_IPS || entries.some(entry => !entry)) {
    return {
      addresses: [],
      issue: `TRUSTED_PROXY_IPS must contain 1-${MAX_TRUSTED_PROXY_IPS} comma-separated exact IP addresses.`,
    };
  }

  const addresses = [];
  for (const entry of entries) {
    const normalized = normalizeAddress(entry);
    if (!normalized) {
      return {
        addresses: [],
        issue:
          "TRUSTED_PROXY_IPS accepts exact IPv4 or IPv6 addresses only; CIDRs, wildcards, hostnames, and unspecified addresses are not allowed.",
      };
    }
    if (addresses.includes(normalized)) {
      return {
        addresses: [],
        issue: "TRUSTED_PROXY_IPS must not contain duplicate addresses.",
      };
    }
    addresses.push(normalized);
  }

  return { addresses, issue: null };
}

export function isTrustedProxyAddress(address, trustedProxyIps) {
  const normalized = normalizeAddress(address);
  return (
    normalized !== null &&
    trustedProxyIps.some(
      trustedAddress => normalizeAddress(trustedAddress) === normalized
    )
  );
}
