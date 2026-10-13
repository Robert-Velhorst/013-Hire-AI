import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  auditRuntimeDatabaseSchema,
  expectedRuntimeSchema,
} from "./databaseSchemaValidation";
import { hasDatabaseSchemaDrift } from "../scripts/lib/database-schema-audit";

describe("production runtime schema gate", () => {
  it("extracts actual runtime tables and rejects an empty database", async () => {
    const query = vi.fn().mockResolvedValue([[]]);
    const result = await auditRuntimeDatabaseSchema({ query } as never);
    expect(expectedRuntimeSchema().tables.size).toBeGreaterThan(40);
    expect(result.missingTables).toContain("users");
    expect(hasDatabaseSchemaDrift(result)).toBe(true);
    expect(query).toHaveBeenCalledTimes(3);
    for (const [options] of query.mock.calls) {
      expect(options.timeout).toBe(15000);
      expect(options.sql).toContain("DATABASE()");
      expect(options.sql).not.toMatch(/INSERT|UPDATE |DELETE |ALTER |DROP /);
    }
  });
  it("propagates a failed metadata query instead of reporting compatibility", async () => {
    const query = vi
      .fn()
      .mockRejectedValue(new Error("connection unavailable"));
    await expect(
      auditRuntimeDatabaseSchema({ query } as never)
    ).rejects.toThrow();
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("enforces schema validation before catalog writes and listening", () => {
    const source = readFileSync("server/_core/index.ts", "utf8");
    const validation = source.indexOf(
      "await assertProductionDatabaseSchema(ENV.databaseUrl)"
    );
    expect(validation).toBeGreaterThan(0);
    expect(validation).toBeLessThan(
      source.indexOf("await ensureScraperPlatformCatalog()")
    );
    expect(validation).toBeLessThan(source.indexOf("server.listen("));
    expect(source).toContain('startupStage = "database schema validation"');
  });
});
