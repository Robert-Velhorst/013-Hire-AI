import express, { type Express } from "express";
import fs from "node:fs";
import path from "node:path";

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1_000;

export function productionAssetCacheControl(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, "/");
  return normalizedPath.includes("/assets/")
    ? "public, max-age=31536000, immutable"
    : "no-cache";
}

export function serveStatic(
  app: Express,
  distPath = path.resolve(import.meta.dirname, "public")
) {
  if (!fs.existsSync(distPath)) {
    throw new Error(`Production client bundle is missing at ${distPath}.`);
  }

  app.use(
    express.static(distPath, {
      etag: true,
      maxAge: ONE_YEAR_MS,
      immutable: true,
      setHeaders(res, filePath) {
        res.setHeader("Cache-Control", productionAssetCacheControl(filePath));
      },
    })
  );
  app.use("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
