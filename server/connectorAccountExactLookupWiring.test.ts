import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SINGLE_PROVIDER_PATHS = [
  "inboxResponseDiscovery.ts",
  "followUpMailDelivery.ts",
  "cloudDocumentDiscovery.ts",
  "githubProfileDiscovery.ts",
  "linkedInProfileDiscovery.ts",
  "connectorOAuthRoutes.ts",
];

describe("single-provider connector account wiring", () => {
  it("uses the indexed exact lookup instead of hydrating every account", () => {
    for (const file of SINGLE_PROVIDER_PATHS) {
      const source = readFileSync(resolve(process.cwd(), "server", file), "utf8");
      expect(source, file).toContain("getUserConnectorAccount");
      expect(source, file).not.toContain("listUserConnectorAccounts");
    }

    const routers = readFileSync(resolve(process.cwd(), "server", "routers.ts"), "utf8");
    expect(routers).toContain("getUserConnectorAccount(ctx.user.id, input.provider)");
    expect(routers).toContain("getUserConnectorAccount(ctx.user.id, candidate.provider)");

    const database = readFileSync(resolve(process.cwd(), "server", "db.ts"), "utf8");
    const lookup = database.slice(
      database.indexOf("export async function getUserConnectorAccount"),
      database.indexOf("export async function upsertUserConnectorAccount")
    );
    expect(lookup).toContain("eq(userConnectorAccounts.userId, userId)");
    expect(lookup).toContain("eq(userConnectorAccounts.provider, provider)");
    expect(lookup).toContain(".limit(1)");
  });
});
