import express from "express";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import {
  applyTrustedProxyPolicy,
  parseTrustedProxyIps,
  TRUSTED_PROXY_RANGE,
} from "./proxyPolicy";

describe("trusted reverse-proxy policy", () => {
  it("trusts loopback peers without trusting private or public network peers", () => {
    const app = express();
    applyTrustedProxyPolicy(app);
    expect(app.get("trust proxy")).toEqual([TRUSTED_PROXY_RANGE]);

    const trust = app.get("trust proxy fn") as (address: string, hop: number) => boolean;
    expect(trust("127.0.0.1", 0)).toBe(true);
    expect(trust("::1", 0)).toBe(true);
    expect(trust("10.0.0.8", 0)).toBe(false);
    expect(trust("203.0.113.8", 0)).toBe(false);
  });

  it("allows exact proxy peers and rejects broad or unresolved proxy rules", () => {
    expect(parseTrustedProxyIps(undefined, false)).toEqual([TRUSTED_PROXY_RANGE]);
    expect(parseTrustedProxyIps(undefined, true)).toEqual([]);
    expect(parseTrustedProxyIps("loopback,172.22.0.1,2001:db8::1", true)).toEqual([
      "loopback",
      "172.22.0.1",
      "2001:db8::1",
    ]);
    expect(() => parseTrustedProxyIps("172.22.0.0/16", true)).toThrow(
      "exact IP addresses"
    );
    expect(() => parseTrustedProxyIps("proxy.internal", true)).toThrow(
      "exact IP addresses"
    );
    expect(() => parseTrustedProxyIps("0.0.0.0", true)).toThrow(
      "exact IP addresses"
    );
    const addresses = Array.from({ length: 17 }, (_, index) => `10.0.0.${index + 1}`);
    expect(() => parseTrustedProxyIps(addresses.join(","), true)).toThrow("at most 16");
  });

  it("trusts only explicitly configured Docker proxy peers", () => {
    const app = express();
    applyTrustedProxyPolicy(app, ["172.22.0.1"]);
    const trust = app.get("trust proxy fn") as (address: string, hop: number) => boolean;

    expect(trust("172.22.0.1", 0)).toBe(true);
    expect(trust("172.22.0.2", 0)).toBe(false);
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
