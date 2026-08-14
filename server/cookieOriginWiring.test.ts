import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("cookie-origin middleware wiring", () => {
  it("leaves signed/token service routes ahead of browser-session enforcement", () => {
    const entrypoint = readFileSync(
      resolve(process.cwd(), "server", "_core", "index.ts"),
      "utf8"
    );
    const stripe = entrypoint.indexOf("registerStripeWebhook(app)");
    const hai = entrypoint.indexOf("registerHaiConnectorRoutes(app)");
    const origin = entrypoint.indexOf("registerCookieOriginProtection(app)");
    const parsers = entrypoint.indexOf("registerApplicationBodyParsers(app)");
    const trpc = entrypoint.indexOf('app.use(\n    "/api/trpc"');

    expect(stripe).toBeGreaterThan(-1);
    expect(hai).toBeGreaterThan(stripe);
    expect(origin).toBeGreaterThan(hai);
    expect(parsers).toBeGreaterThan(origin);
    expect(trpc).toBeGreaterThan(parsers);
  });
});
