import express from "express";
import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerApiNotFound } from "./static";

vi.mock("vite", () => ({ createServer: vi.fn() }));
vi.mock("../../vite.config", () => ({ createViteConfig: () => ({}) }));

import { createServer as createViteServer } from "vite";
import { setupVite } from "./vite";

describe("development Vite request routing", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps API misses out of the SPA fallback and serves HTML navigations", async () => {
    vi.mocked(createViteServer).mockResolvedValue({
      middlewares: (_req, _res, next) => next(),
      transformIndexHtml: async (_url, template) => template,
      ssrFixStacktrace: vi.fn(),
    } as never);

    const app = express();
    app.get("/api/known", (_req, res) => res.json({ status: "ok" }));
    registerApiNotFound(app);
    const server = createServer(app);
    await setupVite(app, server);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Test server did not bind to TCP.");

    try {
      const knownApi = await fetch(
        `http://127.0.0.1:${address.port}/api/known`
      );
      expect(knownApi.status).toBe(200);
      expect(await knownApi.json()).toEqual({ status: "ok" });

      for (const [method, route] of [
        ["GET", "/api/missing"],
        ["POST", "/api/known"],
        ["GET", "/api/missing.v1"],
        ["GET", "/api/missing%2Eroute"],
      ]) {
        const response = await fetch(
          `http://127.0.0.1:${address.port}${route}`,
          {
            method,
            headers: { Accept: "text/html" },
          }
        );
        expect(response.status).toBe(404);
        expect(response.headers.get("content-type")).toContain(
          "application/json"
        );
        expect(response.headers.get("cache-control")).toBe("no-store");
      }

      for (const route of ["/profile", "/profile.json", "/profile%2Fresume"]) {
        const response = await fetch(
          `http://127.0.0.1:${address.port}${route}`,
          {
            headers: { Accept: "text/html" },
          }
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/html");
        expect(await response.text()).toContain('id="root"');
      }

      for (const accept of ["application/json", "text/html;q=0"]) {
        const response = await fetch(
          `http://127.0.0.1:${address.port}/profile/settings`,
          { headers: { Accept: accept } }
        );
        expect(response.status).toBe(404);
        expect(await response.text()).not.toContain('id="root"');
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
    }
  });
});
