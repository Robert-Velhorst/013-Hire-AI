import { COOKIE_NAME } from "@shared/const";
import express from "express";
import { createServer, request } from "node:http";
import { describe, expect, it } from "vitest";
import { registerCookieOriginProtection } from "./cookieOriginProtection";
import { applyTrustedProxyPolicy } from "./proxyPolicy";

async function withProtectedServer(
  run: (baseUrl: string, routeCalls: () => number) => Promise<void>
) {
  const app = express();
  applyTrustedProxyPolicy(app);
  registerCookieOriginProtection(app);
  let calls = 0;
  app.post("/write", (_req, res) => {
    calls += 1;
    res.sendStatus(204);
  });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test server did not bind to TCP.");

  try {
    await run(`http://127.0.0.1:${address.port}`, () => calls);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  }
}

describe("cookie-authenticated write origin protection", () => {
  it("allows unauthenticated service requests without imposing browser-session rules", async () => {
    await withProtectedServer(async (baseUrl, routeCalls) => {
      const response = await fetch(`${baseUrl}/write`, { method: "POST" });
      expect(response.status).toBe(204);
      expect(routeCalls()).toBe(1);
    });
  });

  it("allows a cookie-authenticated same-origin write", async () => {
    await withProtectedServer(async (baseUrl, routeCalls) => {
      const response = await fetch(`${baseUrl}/write`, {
        method: "POST",
        headers: { cookie: `${COOKIE_NAME}=session`, origin: baseUrl },
      });
      expect(response.status).toBe(204);
      expect(routeCalls()).toBe(1);
    });
  });

  it.each([
    ["missing", undefined],
    ["cross-site", "https://attacker.example"],
    ["opaque", "null"],
  ])(
    "rejects a cookie-authenticated %s origin before route execution",
    async (_name, origin) => {
      await withProtectedServer(async (baseUrl, routeCalls) => {
        const headers: Record<string, string> = {
          cookie: `${COOKIE_NAME}=session`,
        };
        if (origin) headers.origin = origin;
        const response = await fetch(`${baseUrl}/write`, {
          method: "POST",
          headers,
        });
        expect(response.status).toBe(403);
        expect(routeCalls()).toBe(0);
      });
    }
  );

  it("accepts the public HTTPS origin through the trusted local ngrok peer", async () => {
    await withProtectedServer(async (baseUrl, routeCalls) => {
      const status = await new Promise<number | undefined>(
        (resolve, reject) => {
          const outgoing = request(
            `${baseUrl}/write`,
            {
              method: "POST",
              headers: {
                cookie: `${COOKIE_NAME}=session`,
                host: "hire.example.ngrok.app",
                origin: "https://hire.example.ngrok.app",
                "x-forwarded-proto": "https",
              },
            },
            response => {
              response.resume();
              response.once("end", () => resolve(response.statusCode));
            }
          );
          outgoing.once("error", reject);
          outgoing.end();
        }
      );
      expect(status).toBe(204);
      expect(routeCalls()).toBe(1);
    });
  });
});
