import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readMigrationFiles } from "drizzle-orm/migrator";

type MigrationJournal = {
  entries: Array<{
    idx: number;
    tag: string;
  }>;
};

describe("Drizzle migration journal", () => {
  it("registers every committed SQL migration in order", () => {
    const migrationsDirectory = resolve(process.cwd(), "drizzle");
    const journalPath = resolve(migrationsDirectory, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as MigrationJournal;
    const migrationTags = readdirSync(migrationsDirectory)
      .filter((fileName) => /^\d{4}_.+\.sql$/.test(fileName))
      .sort()
      .map((fileName) => fileName.replace(/\.sql$/, ""));

    expect(journal.entries.map((entry) => entry.idx)).toEqual(
      journal.entries.map((_, index) => index)
    );
    expect(journal.entries.map((entry) => entry.tag)).toEqual(migrationTags);
  });

  it("keeps migration generation separate from deployment", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8")
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts).toMatchObject({
      "db:generate": "drizzle-kit generate",
      "db:migrate": "node scripts/database-migrate.mjs",
      "db:push": "node scripts/database-migrate.mjs",
    });
  });

  it("separates every MySQL statement into a migrator-safe chunk", () => {
    const migrations = readMigrationFiles({
      migrationsFolder: resolve(process.cwd(), "drizzle"),
    });

    for (const migration of migrations) {
      for (const statement of migration.sql) {
        const withoutTrailingTerminator = statement.replace(/;\s*$/, "");
        expect(
          withoutTrailingTerminator,
          `Migration ${migration.folderMillis} contains multiple SQL statements without a statement breakpoint`
        ).not.toMatch(/;\s*(?:alter|create|drop|insert|update|delete|rename|truncate)\b/i);
      }
    }
  });

  it("keeps MySQL identifiers within the 64-character limit", () => {
    const migrationsDirectory = resolve(process.cwd(), "drizzle");
    const migrationFiles = readdirSync(migrationsDirectory)
      .filter((fileName) => /^\d{4}_.+\.sql$/.test(fileName));

    for (const fileName of migrationFiles) {
      const migration = readFileSync(resolve(migrationsDirectory, fileName), "utf8");
      for (const [, identifier] of migration.matchAll(/`([^`]+)`/g)) {
        expect(identifier.length, `${fileName} contains an overlong MySQL identifier: ${identifier}`).toBeLessThanOrEqual(64);
      }
    }
  });

  it("keeps operating query indexes aligned with the schema", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle", "schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle", "0036_operating_query_indexes.sql"),
      "utf8"
    );
    const expectedIndexes = [
      "jobs_active_posted_created_idx",
      "jobs_platform_external_idx",
      "user_profiles_user_idx",
      "social_media_profiles_user_active_idx",
      "applications_user_created_idx",
      "application_decisions_user_updated_idx",
      "admin_review_items_status_created_idx",
      "admin_review_items_user_category_created_idx",
      "application_approvals_user_status_created_idx",
      "follow_ups_application_created_idx",
      "user_resumes_user_active_version_idx",
      "interview_schedules_application_scheduled_idx",
      "interview_schedules_status_scheduled_idx",
      "work_experiences_user_sort_idx",
      "education_entries_user_sort_idx",
      "user_skills_user_sort_idx",
      "success_fees_user_created_idx",
    ];

    for (const indexName of expectedIndexes) {
      expect(schema, `${indexName} is missing from the schema`).toContain(
        `index("${indexName}")`
      );
      expect(migration, `${indexName} is missing from the migration`).toContain(
        `\`${indexName}\``
      );
    }
  });

  it("keeps the due job-alert index aligned with the schema", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle", "schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle", "0037_job_alert_due_index.sql"),
      "utf8"
    );
    const indexName = "job_alerts_active_frequency_triggered_idx";

    expect(schema).toContain(`index("${indexName}")`);
    expect(migration).toContain(`\`${indexName}\``);
  });
});
