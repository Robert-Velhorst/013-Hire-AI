import type { Express } from "express";
import {
  DEFAULT_TRUSTED_PROXY_IPS,
  isTrustedProxyAddress,
} from "@shared/trustedProxyPolicy.mjs";

export function applyTrustedProxyPolicy(
  app: Express,
  trustedProxyIps: readonly string[] = DEFAULT_TRUSTED_PROXY_IPS
) {
  if (trustedProxyIps.length === 0) {
    throw new Error("At least one exact trusted proxy IP is required.");
  }
  const addresses = [...trustedProxyIps];
  app.set("trust proxy", (address: string) =>
    isTrustedProxyAddress(address, addresses)
  );
}
