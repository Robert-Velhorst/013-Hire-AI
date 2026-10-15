import express from "express";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { applyTrustedProxyPolicy } from "./proxyPolicy";

describe("trusted reverse-proxy policy", () => {
  it("trusts only loopback peers by default", () => {
    const app = express();
    applyTrustedProxyPolicy(app);

    const trust = app.get("trust proxy fn") as (
      address: string,
      hop: number
    ) => boolean;
    expect(trust("127.0.0.1", 0)).toBe(true);
    expect(trust("::1", 0)).toBe(true);
    expect(trust("::ffff:127.0.0.1", 0)).toBe(true);
    expect(trust("::ffff:7f00:1", 0)).toBe(true);
    expect(trust("10.0.0.8", 0)).toBe(false);
    expect(trust("203.0.113.8", 0)).toBe(false);
  });

  it("trusts only explicitly configured proxy peers", () => {
    const app = express();
    applyTrustedProxyPolicy(app, ["10.0.0.8", "2001:0db8:0:0:0:0:0:1"]);
    const trust = app.get("trust proxy fn") as (
      address: string,
      hop: number
    ) => boolean;

    expect(trust("10.0.0.8", 0)).toBe(true);
    expect(trust("2001:db8::1", 0)).toBe(true);
    expect(trust("10.0.0.9", 0)).toBe(false);
    expect(trust("203.0.113.8", 0)).toBe(false);
  });

  it("does not accept an empty production allowlist", () => {
    expect(() => applyTrustedProxyPolicy(express(), [])).toThrow(
      "At least one exact trusted proxy IP is required."
    );
  });

  it("recognizes trusted local TLS termination as a secure request", async () => {
    const app = express();
    applyTrustedProxyPolicy(app);
    app.get("/protocol", (req, res) =>
      res.json({ protocol: req.protocol, secure: req.secure })
    );
    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Test server did not bind to TCP.");

    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/protocol`,
        {
          headers: { "x-forwarded-proto": "https" },
        }
      );
      expect(await response.json()).toEqual({
        protocol: "https",
        secure: true,
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
    }
  });

  it("uses forwarded identity only when the immediate peer is allowlisted", async () => {
    const start = async (trustedProxyIps: string[]) => {
      const app = express();
      applyTrustedProxyPolicy(app, trustedProxyIps);
      app.get("/request", (req, res) =>
        res.json({ ip: req.ip, protocol: req.protocol, secure: req.secure })
      );
      const server = createServer(app);
      await new Promise<void>(resolve =>
        server.listen(0, "127.0.0.1", resolve)
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Test server did not bind to TCP.");
      return { server, url: `http://127.0.0.1:${address.port}/request` };
    };
    const headers = {
      "x-forwarded-for": "198.51.100.8",
      "x-forwarded-proto": "https",
    };
    const trusted = await start(["127.0.0.1"]);
    const untrusted = await start(["127.0.0.2"]);

    try {
      expect(await (await fetch(trusted.url, { headers })).json()).toEqual({
        ip: "198.51.100.8",
        protocol: "https",
        secure: true,
      });
      const untrustedResult = (await (
        await fetch(untrusted.url, { headers })
      ).json()) as {
        ip: string;
        protocol: string;
        secure: boolean;
      };
      expect(untrustedResult).toMatchObject({
        protocol: "http",
        secure: false,
      });
      expect(untrustedResult.ip).not.toBe("198.51.100.8");
    } finally {
      await Promise.all(
        [trusted.server, untrusted.server].map(
          server =>
            new Promise<void>((resolve, reject) =>
              server.close(error => (error ? reject(error) : resolve()))
            )
        )
      );
    }
  });
});
