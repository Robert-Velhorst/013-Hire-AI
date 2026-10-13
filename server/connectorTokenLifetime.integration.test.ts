import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectorAuthorizations, users } from "../drizzle/schema";
import { closeDatabaseConnection, getDb, getConnectorAuthorization, upsertConnectorAuthorization } from "./db";

const enabled = process.env.HIRE_AI_DATABASE_ACCEPTANCE === "true";

describe.skipIf(!enabled).sequential("connector token lifetime persistence on isolated MySQL", () => {
  const marker = `connector-token-${randomUUID().replaceAll("-", "")}`;
  let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
  let userId = 0;

  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL || "");
    if (target.pathname !== "/hire_ai_acceptance") {
      throw new Error("Connector token lifetime acceptance requires the isolated hire_ai_acceptance database.");
    }
    const connection = await getDb();
    if (!connection) throw new Error("MySQL is required; memory fallback is not integration acceptance.");
    db = connection;
    const result = await db.insert(users).values({ openId: marker, name: "Synthetic connector token user" });
    userId = Number(result[0].insertId);
  });

  afterAll(async () => {
    if (userId) {
      await db.delete(connectorAuthorizations).where(eq(connectorAuthorizations.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
    await closeDatabaseConnection();
  });

  it("persists non-expiring, expiring, and unknown grants without inferring from a null expiry", async () => {
    await upsertConnectorAuthorization({
      userId,
      provider: "github",
      encryptedAccessToken: "encrypted-non-expiring",
      encryptedRefreshToken: "encrypted-obsolete-refresh",
      accessTokenExpiresAt: null,
      grantedScopes: JSON.stringify(["read:user"]),
    });
    await upsertConnectorAuthorization({
      userId,
      provider: "github",
      encryptedAccessToken: "encrypted-non-expiring",
      encryptedRefreshToken: null,
      accessTokenExpiresAt: null,
      grantedScopes: JSON.stringify(["read:user"]),
    });
    await upsertConnectorAuthorization({
      userId,
      provider: "gmail",
      encryptedAccessToken: "encrypted-unknown",
      encryptedRefreshToken: null,
      accessTokenExpiresAt: null,
      accessTokenLifetime: "unknown",
      grantedScopes: JSON.stringify(["https://www.googleapis.com/auth/gmail.metadata"]),
    });
    await upsertConnectorAuthorization({
      userId,
      provider: "linkedin",
      encryptedAccessToken: "encrypted-expiring",
      encryptedRefreshToken: "encrypted-refresh",
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      grantedScopes: JSON.stringify(["openid", "profile", "email"]),
    });

    const migration = await readFile(new URL("../drizzle/0080_connector_token_lifetime.sql", import.meta.url), "utf8");
    const backfill = migration.split("--> statement-breakpoint")[1]?.trim();
    if (!backfill) throw new Error("Connector token lifetime migration backfill is missing.");
    await db.execute(sql.raw(backfill));

    await expect(getConnectorAuthorization(userId, "github")).resolves.toMatchObject({
      accessTokenExpiresAt: null,
      accessTokenLifetime: "non_expiring",
      encryptedRefreshToken: null,
    });
    await expect(getConnectorAuthorization(userId, "gmail")).resolves.toMatchObject({
      accessTokenExpiresAt: null,
      accessTokenLifetime: "unknown",
    });
    await expect(getConnectorAuthorization(userId, "linkedin")).resolves.toMatchObject({
      accessTokenLifetime: "expiring",
    });
  });
});
