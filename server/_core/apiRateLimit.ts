import type { Express, NextFunction, Request, Response } from "express";

export const API_RATE_LIMIT_POLICY = Object.freeze({
  windowMs: 60_000,
  maxRequests: 600,
  maxClients: 10_000,
});

type ClientWindow = {
  count: number;
  resetAt: number;
};

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  maxClients: number;
  now?: () => number;
  clientKey?: (req: Request) => string;
}

export type RateLimitMiddleware = ((
  req: Request,
  res: Response,
  next: NextFunction
) => void) & {
  activeClientCount(): number;
};

export function createRateLimitMiddleware(
  options: RateLimitOptions
): RateLimitMiddleware {
  if (!Number.isSafeInteger(options.windowMs) || options.windowMs < 1_000) {
    throw new Error("Rate-limit window must be at least one second.");
  }
  if (!Number.isSafeInteger(options.maxRequests) || options.maxRequests < 1) {
    throw new Error("Rate-limit request count must be positive.");
  }
  if (!Number.isSafeInteger(options.maxClients) || options.maxClients < 1) {
    throw new Error("Rate-limit client capacity must be positive.");
  }

  const now = options.now ?? Date.now;
  const clientKey =
    options.clientKey ??
    ((req: Request) => req.ip || req.socket.remoteAddress || "unknown");
  const clients = new Map<string, ClientWindow>();
  let nextSweepAt = now() + options.windowMs;

  const sweep = (timestamp: number) => {
    if (timestamp < nextSweepAt) return;
    clients.forEach((window, key) => {
      if (window.resetAt <= timestamp) clients.delete(key);
    });
    nextSweepAt = timestamp + options.windowMs;
  };

  const middleware = ((req: Request, res: Response, next: NextFunction) => {
    const timestamp = now();
    sweep(timestamp);
    const key = clientKey(req);
    let window = clients.get(key);

    if (!window || window.resetAt <= timestamp) {
      if (window) clients.delete(key);
      if (clients.size >= options.maxClients) {
        const oldestKey = clients.keys().next().value as string | undefined;
        if (oldestKey !== undefined) clients.delete(oldestKey);
      }
      window = { count: 0, resetAt: timestamp + options.windowMs };
      clients.set(key, window);
    }

    window.count += 1;
    const resetSeconds = Math.max(
      1,
      Math.ceil((window.resetAt - timestamp) / 1_000)
    );
    res.setHeader("RateLimit-Limit", String(options.maxRequests));
    res.setHeader(
      "RateLimit-Remaining",
      String(Math.max(0, options.maxRequests - window.count))
    );
    res.setHeader("RateLimit-Reset", String(resetSeconds));
    res.setHeader(
      "RateLimit-Policy",
      `${options.maxRequests};w=${Math.ceil(options.windowMs / 1_000)}`
    );

    if (window.count > options.maxRequests) {
      res.setHeader("Retry-After", String(resetSeconds));
      res.status(429).json({ error: "Too many requests. Retry later." });
      return;
    }

    next();
  }) as RateLimitMiddleware;

  middleware.activeClientCount = () => clients.size;
  return middleware;
}

export function registerApiRateLimit(app: Express) {
  const limiter = createRateLimitMiddleware(API_RATE_LIMIT_POLICY);
  app.use("/api", limiter);
  return limiter;
}
