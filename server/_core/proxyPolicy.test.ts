import express from "express";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { applyTrustedProxyPolicy, TRUSTED_PROXY_RANGE } from "./proxyPolicy";

describe("trusted reverse-proxy policy", () => {
  it("trusts loopback peers without trusting private or public network peers", () => {
    const app = express();
    applyTrustedProxyPolicy(app);
    expect(app.get("trust proxy")).toBe(TRUSTED_PROXY_RANGE);

    const trust = app.get("trust proxy fn") as (address: string, hop: number) => boolean;
    expect(trust("127.0.0.1", 0)).toBe(true);
    expect(trust("::1", 0)).toBe(true);
    expect(trust("10.0.0.8", 0)).toBe(false);
    expect(trust("203.0.113.8", 0)).toBe(false);
  });

  it("recognizes trusted local TLS termination as a secure request", async () => {
    const app = express();
    applyTrustedProxyPolicy(app);
    app.get("/protocol", (req, res) => res.json({ protocol: req.protocol, secure: req.secure }));
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to TCP.");

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/protocol`, {
        headers: { "x-forwarded-proto": "https" },
      });
      expect(await response.json()).toEqual({ protocol: "https", secure: true });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
