import express from "express";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  productionAssetCacheControl,
  registerApiNotFound,
  serveStatic,
} from "./static";

const cleanupDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupDirectories
      .splice(0)
      .map(directory => rm(directory, { recursive: true, force: true }))
  );
});

describe("production static caching", () => {
  it("caches fingerprinted Vite assets immutably", () => {
    expect(
      productionAssetCacheControl("C:\\app\\public\\assets\\index-D9LZbWku.js")
    ).toBe("public, max-age=31536000, immutable");
  });

  it("requires revalidation for the app shell and non-fingerprinted files", () => {
    expect(productionAssetCacheControl("C:\\app\\public\\index.html")).toBe(
      "no-cache"
    );
    expect(productionAssetCacheControl("/app/public/favicon.ico")).toBe(
      "no-cache"
    );
  });

  it("serves production assets with the intended HTTP cache behavior", async () => {
    const distPath = await mkdtemp(join(tmpdir(), "hire-ai-static-"));
    cleanupDirectories.push(distPath);
    await mkdir(join(distPath, "assets"));
    await writeFile(
      join(distPath, "index.html"),
      "<!doctype html><title>Hire.AI</title>"
    );
    await writeFile(
      join(distPath, "assets", "index-ABC123.js"),
      "console.log('ready')"
    );

    const app = express();
    app.get("/api/known", (_req, res) => res.json({ status: "ok" }));
    registerApiNotFound(app);
    serveStatic(app, distPath);
    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Test server did not bind to TCP.");

    try {
      const [shell, asset] = await Promise.all([
        fetch(`http://127.0.0.1:${address.port}/`, {
          headers: { Accept: "text/html" },
        }),
        fetch(`http://127.0.0.1:${address.port}/assets/index-ABC123.js`),
      ]);
      expect(shell.status).toBe(200);
      expect(shell.headers.get("cache-control")).toBe("no-cache");
      expect(asset.status).toBe(200);
      expect(asset.headers.get("cache-control")).toBe(
        "public, max-age=31536000, immutable"
      );

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
          { method, headers: { Accept: "text/html" } }
        );
        expect(response.status).toBe(404);
        expect(response.headers.get("content-type")).toContain(
          "application/json"
        );
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.text()).not.toContain("Hire.AI</title>");
      }

      for (const route of ["/profile", "/profile.json", "/profile%2Fresume"]) {
        const response = await fetch(
          `http://127.0.0.1:${address.port}${route}`,
          { headers: { Accept: "text/html" } }
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-cache");
        expect(await response.text()).toContain("Hire.AI</title>");
      }

      const nonHtmlNavigation = await fetch(
        `http://127.0.0.1:${address.port}/profile`,
        { headers: { Accept: "application/json" } }
      );
      expect(nonHtmlNavigation.status).toBe(404);
      expect(await nonHtmlNavigation.text()).not.toContain("Hire.AI</title>");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
    }
  });
});
