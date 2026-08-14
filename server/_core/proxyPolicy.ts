import type { Express } from "express";

export const TRUSTED_PROXY_RANGE = "loopback";

/**
 * The Windows/ngrok deployment terminates TLS in a local ngrok process. Trust
 * forwarded metadata only when the immediate peer is loopback; direct network
 * clients cannot promote their own forwarded headers to trusted request state.
 */
export function applyTrustedProxyPolicy(app: Express) {
  app.set("trust proxy", TRUSTED_PROXY_RANGE);
}
