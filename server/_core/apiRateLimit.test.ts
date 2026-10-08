import express from "express";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { createRateLimitMiddleware } from "./apiRateLimit";
import { applyTrustedProxyPolicy } from "./proxyPolicy";

async function withLimitedServer(
  run: (
    baseUrl: string,
    limiter: ReturnType<typeof createRateLimitMiddleware>,
    advance: (milliseconds: number) => void
  ) => Promise<void>
) {
  let currentTime = 1_000_000;
  const limiter = createRateLimitMiddleware({
    windowMs: 10_000,
    maxRequests: 2,
    maxClients: 2,
    now: () => currentTime,
  });
  const app = express();
  applyTrustedProxyPolicy(app);
  app.use("/api", limiter);
  app.get("/api/value", (_req, res) => res.json({ ok: true }));
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test server did not bind to TCP.");

  try {
    await run(`http://127.0.0.1:${address.port}`, limiter, milliseconds => {
      currentTime += milliseconds;
    });
  } finally {
    currentTime += 20_000;
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  }
}

describe("bounded API rate limiting", () => {
  it("returns deterministic limits and retry guidance after the client budget", async () => {
    await withLimitedServer(async baseUrl => {
      const headers = { "x-forwarded-for": "198.51.100.1" };
      const first = await fetch(`${baseUrl}/api/value`, { headers });
      const second = await fetch(`${baseUrl}/api/value`, { headers });
      const blocked = await fetch(`${baseUrl}/api/value`, { headers });

      expect(first.status).toBe(200);
      expect(first.headers.get("ratelimit-remaining")).toBe("1");
      expect(first.headers.get("ratelimit-reset")).toBe("10");
      expect(first.headers.get("ratelimit-policy")).toBe("2;w=10");
      expect(second.status).toBe(200);
      expect(second.headers.get("ratelimit-remaining")).toBe("0");
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("retry-after")).toBe("10");
    });
  });

  it("resets expired budgets and leaves health checks outside the API budget", async () => {
    await withLimitedServer(async (baseUrl, limiter, advance) => {
      const headers = { "x-forwarded-for": "198.51.100.7" };
      await fetch(`${baseUrl}/api/value`, { headers });
      await fetch(`${baseUrl}/api/value`, { headers });
      expect((await fetch(`${baseUrl}/api/value`, { headers })).status).toBe(
        429
      );

      for (let index = 0; index < 4; index += 1) {
        expect((await fetch(`${baseUrl}/healthz`, { headers })).status).toBe(
          200
        );
      }
      expect(limiter.activeClientCount()).toBe(1);

      advance(10_000);
      expect((await fetch(`${baseUrl}/api/value`, { headers })).status).toBe(
        200
      );
    });
  });

  it("uses trusted forwarded client addresses as separate budgets", async () => {
    await withLimitedServer(async baseUrl => {
      for (const address of ["198.51.100.2", "198.51.100.3"]) {
        const response = await fetch(`${baseUrl}/api/value`, {
          headers: { "x-forwarded-for": address },
        });
        expect(response.status).toBe(200);
      }
    });
  });

  it("preserves active client budgets and rejects new clients at capacity", async () => {
    await withLimitedServer(async (baseUrl, limiter, advance) => {
      const clientA = { "x-forwarded-for": "198.51.100.4" };
      const clientB = { "x-forwarded-for": "198.51.100.5" };
      const clientC = { "x-forwarded-for": "198.51.100.6" };

      expect(
        (await fetch(`${baseUrl}/api/value`, { headers: clientA })).status
      ).toBe(200);
      advance(3_000);
      expect(
        (await fetch(`${baseUrl}/api/value`, { headers: clientB })).status
      ).toBe(200);
      const capacityResponse = await fetch(`${baseUrl}/api/value`, {
        headers: clientC,
      });
      expect(capacityResponse.status).toBe(503);
      expect(capacityResponse.headers.get("retry-after")).toBe("7");
      expect(limiter.activeClientCount()).toBe(2);

      expect(
        (await fetch(`${baseUrl}/api/value`, { headers: clientA })).status
      ).toBe(200);
      expect(
        (await fetch(`${baseUrl}/api/value`, { headers: clientA })).status
      ).toBe(429);

      advance(7_000);
      expect(
        (await fetch(`${baseUrl}/api/value`, { headers: clientC })).status
      ).toBe(200);
      expect(limiter.activeClientCount()).toBe(2);
      expect(
        (await fetch(`${baseUrl}/api/value`, { headers: clientB })).status
      ).toBe(200);
      expect(
        (await fetch(`${baseUrl}/api/value`, { headers: clientB })).status
      ).toBe(429);
    });
  });

  it("rejects invalid policies at startup", () => {
    expect(() =>
      createRateLimitMiddleware({
        windowMs: 999,
        maxRequests: 1,
        maxClients: 1,
      })
    ).toThrow();
    expect(() =>
      createRateLimitMiddleware({
        windowMs: 1_000,
        maxRequests: 0,
        maxClients: 1,
      })
    ).toThrow();
    expect(() =>
      createRateLimitMiddleware({
        windowMs: 1_000,
        maxRequests: 1,
        maxClients: 0,
      })
    ).toThrow();
  });
});
