import express, { type Express, type RequestHandler } from "express";
import fs from "node:fs";
import path from "node:path";

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1_000;

export function resolveProductionClientBundlePath(
  runtimeDirectory = import.meta.dirname
) {
  return path.resolve(runtimeDirectory, "../public");
}

export function productionAssetCacheControl(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, "/");
  return normalizedPath.includes("/assets/")
    ? "public, max-age=31536000, immutable"
    : "no-cache";
}

export function registerApiNotFound(app: Express) {
  app.use("/api", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(404).json({
      error: { code: "not_found", message: "Not found" },
    });
  });
}

function explicitlyAcceptsHtml(acceptHeader: string | undefined) {
  return (acceptHeader ?? "").split(",").some(entry => {
    const [mediaType, ...parameters] = entry.split(";");
    if (!/^(text\/html|application\/xhtml\+xml)$/i.test(mediaType.trim())) {
      return false;
    }

    const quality = parameters.find(parameter => /^\s*q\s*=/i.test(parameter));
    if (!quality) return true;
    const value = Number(quality.split("=")[1]);
    return Number.isFinite(value) && value > 0 && value <= 1;
  });
}

export function registerSpaNavigationFallback(
  app: Express,
  renderNavigation: RequestHandler
) {
  app.get("*", (req, res, next) => {
    if (!explicitlyAcceptsHtml(req.get("accept"))) {
      next();
      return;
    }

    renderNavigation(req, res, next);
  });
}

export function serveStatic(
  app: Express,
  distPath = resolveProductionClientBundlePath()
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
  registerSpaNavigationFallback(app, (_req, res, next) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.resolve(distPath, "index.html"), error => {
      if (error) next(error);
    });
  });
}
