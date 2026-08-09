import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("bounded entity detail wiring", () => {
  it("keeps complete readers internal and exposes bounded route readers", () => {
    const router = readFileSync(resolve(process.cwd(), "server", "routers.ts"), "utf8");
    const database = readFileSync(resolve(process.cwd(), "server", "db.ts"), "utf8");
    const features = readFileSync(resolve(process.cwd(), "server", "applicationFeatures.ts"), "utf8");

    expect(router).toContain("getRecentAuditEventsForEntity");
    expect(router).toContain("getRecentEmployerResponses");
    expect(router).toContain("getRecentApplicationNotes");
    expect(router).not.toContain("return await getAuditEventsForEntity(ctx.user.id");
    expect(router).not.toContain("return await getEmployerResponses(input.applicationId");
    expect(router).not.toContain("return await getApplicationNotes(input.applicationId");
    expect(database).toContain("export async function getAuditEventsForEntity(");
    expect(database).toContain("export async function getEmployerResponses(");
    expect(features).toContain("export async function getApplicationNotes(");
  });

  it("keeps bounded detail indexes aligned with migration 0066", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle", "schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle", "0066_bounded_entity_detail_indexes.sql"),
      "utf8"
    );
    for (const indexName of [
      "audit_events_user_entity_created_id_idx",
      "application_notes_application_created_id_idx",
    ]) {
      expect(schema).toContain(indexName);
      expect(migration).toContain(indexName);
    }
    expect(migration).toContain("`user_id`,`entity_type`,`entity_id`,`created_at`,`id`");
    expect(migration).toContain("`application_id`,`created_at`,`id`");
  });
});
