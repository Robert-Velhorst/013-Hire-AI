import express from "express";
import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "./sdk";
import { ENV } from "./env";
import { applyTrustedProxyPolicy } from "./proxyPolicy";
import { registerOAuthRoutes } from "./oauth";

const originalPortalUrl = ENV.oAuthPortalUrl;
const originalQaAuthEnabled = ENV.devQaAuthEnabled;

afterEach(() => {
  ENV.oAuthPortalUrl = originalPortalUrl;
  ENV.devQaAuthEnabled = originalQaAuthEnabled;
  vi.restoreAllMocks();
});

describe("primary OAuth route rate limiting", () => {
  it("bounds combined sign-in and callback attempts before OAuth work", async () => {
    ENV.oAuthPortalUrl = "";
    ENV.devQaAuthEnabled = false;
    const exchange = vi.spyOn(sdk, "exchangeCodeForToken");
    const app = express();
    applyTrustedProxyPolicy(app);
    registerOAuthRoutes(app);
    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("OAuth test server did not bind to TCP.");
    }

    try {
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const results = await Promise.all(
        Array.from({ length: 30 }, (_, index) =>
          fetch(
            `${baseUrl}${index % 2 === 0 ? "/api/oauth/login" : "/api/oauth/callback"}`
          )
        )
      );
      expect(results.filter(response => response.status === 503)).toHaveLength(
        15
      );
      expect(results.filter(response => response.status === 400)).toHaveLength(
        15
      );

      const callback = await fetch(`${baseUrl}/api/oauth/callback`);
      const login = await fetch(`${baseUrl}/api/oauth/login`);
      expect(callback.status).toBe(429);
      expect(login.status).toBe(429);
      expect(callback.headers.get("retry-after")).toBeTruthy();
      expect(exchange).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
    }
  });
});
