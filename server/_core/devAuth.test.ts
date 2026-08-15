import { describe, expect, it } from "vitest";
import { registerDevAuthRoutes } from "./devAuth";
import { ENV } from "./env";

type RouteHandler = (request: any, response: any) => Promise<void>;

describe("development authentication routes", () => {
  it("registers a generic development login route outside production", () => {
    const routes = new Map<string, RouteHandler>();
    const app = {
      get(path: string, handler: RouteHandler) {
        routes.set(path, handler);
      },
    };

    expect(ENV.isProduction).toBe(false);
    registerDevAuthRoutes(app as any);

    expect(routes.has("/api/dev/login")).toBe(true);
    expect(routes.has("/api/dev/login-suspended")).toBe(true);
    expect(routes.has("/api/dev/login-review-queue")).toBe(true);
    expect(routes.has("/api/dev/login-admin")).toBe(true);
  });
});
