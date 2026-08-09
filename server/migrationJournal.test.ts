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
      "jobs_platform_external_idx",
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

  it("enforces one data-preserving profile per account owner", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle", "schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle", "0043_user_profile_owner_unique.sql"),
      "utf8"
    );

    expect(schema).toContain('uniqueIndex("user_profiles_user_unique").on(table.userId)');
    expect(migration).toContain("CREATE TABLE `_migration_0043_user_profile_source`");
    expect(migration).toContain("DROP TABLE IF EXISTS `_migration_0043_user_profile_source`");
    expect(migration).toContain("ORDER BY `source`.`updated_at` DESC, `source`.`id` DESC LIMIT 1");
    expect(migration).toContain("WHERE `duplicate`.`id` <> `choice`.`canonical_id`");
    expect(migration).toContain("ADD UNIQUE INDEX `user_profiles_user_unique` (`user_id`)");
  });

  it("enforces one data-preserving interview preparation per user and job", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle", "schema.ts"), "utf8");
    const databaseSource = readFileSync(resolve(process.cwd(), "server", "db.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle", "0044_interview_preparation_unique.sql"),
      "utf8"
    );
    const upsertSource = databaseSource.slice(
      databaseSource.indexOf("export async function upsertInterviewPreparation"),
      databaseSource.indexOf("export async function getInterviewPreparationForJob")
    );

    expect(schema).toContain('uniqueIndex("interview_prep_user_job_unique").on(table.userId, table.jobId)');
    expect(migration).toContain("CREATE TABLE `_migration_0044_interview_prep_source`");
    expect(migration).toContain("GROUP BY `user_id`, `job_id`");
    expect(migration).toContain("ORDER BY `source`.`created_at` DESC, `source`.`id` DESC LIMIT 1");
    expect(migration).toContain("WHERE `duplicate`.`id` <> `choice`.`canonical_id`");
    expect(migration).toContain("ADD UNIQUE INDEX `interview_prep_user_job_unique` (`user_id`, `job_id`)");
    expect(upsertSource).toContain(".onDuplicateKeyUpdate({");
    expect(upsertSource).toContain("LAST_INSERT_ID(${interviewPreparation.id})");
    expect(upsertSource).not.toContain(".select(");
  });

  it("keeps one latest-state public social profile per user and platform", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle", "schema.ts"), "utf8");
    const databaseSource = readFileSync(resolve(process.cwd(), "server", "db.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle", "0045_public_social_profile_unique.sql"),
      "utf8"
    );
    const setterSource = databaseSource.slice(
      databaseSource.indexOf("export async function setPublicSocialProfile"),
      databaseSource.indexOf("export async function listUserConnectorAccounts")
    );

    expect(schema).toContain('uniqueIndex("social_profiles_user_platform_unique").on(table.userId, table.platform)');
    expect(migration).toContain("CREATE TABLE `_migration_0045_social_profile_source`");
    expect(migration).toContain("GROUP BY `user_id`, `platform`");
    expect(migration).toContain("ORDER BY `source`.`updated_at` DESC, `source`.`id` DESC LIMIT 1");
    expect(migration).toContain("WHERE `duplicate`.`id` <> `choice`.`canonical_id`");
    expect(migration).toContain("ADD UNIQUE INDEX `social_profiles_user_platform_unique` (`user_id`, `platform`)");
    expect(setterSource).toContain(".onDuplicateKeyUpdate({");
    expect(setterSource).toContain("LAST_INSERT_ID(${socialMediaProfiles.id})");
  });

  it("creates the employer-response interview link used by the runtime schema", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle", "schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle", "0046_employer_response_interview_link.sql"),
      "utf8"
    );

    expect(schema).toContain('interviewId: int("interview_id")');
    expect(migration).toContain("ADD COLUMN `interview_id` int NULL");
  });

  it("keeps the employer-response classification enum aligned with runtime", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle", "schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle", "0047_employer_response_no_response.sql"),
      "utf8"
    );

    expect(schema).toMatch(/"employer_question",\s*"no_response",\s*"other",/);
    expect(migration).toContain("'employer_question','no_response','other'");
  });

  it("keeps the due job-alert index aligned with the schema", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle", "schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle", "0068_job_alert_check_lease.sql"),
      "utf8"
    );
    const indexName = "job_alerts_due_lease_idx";

    expect(schema).toContain(`index("${indexName}")`);
    expect(migration).toContain(`\`${indexName}\``);
    expect(schema).toContain('lastCheckedAt: timestamp("last_checked_at")');
    expect(migration).toContain("`check_lease_id`");
    expect(migration).toContain("`check_lease_until`");
  });

  it("keeps the autonomous profile scheduling index aligned with the schema", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle", "schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle", "0069_autonomous_profile_schedule_index.sql"),
      "utf8"
    );

    expect(schema).toContain('autonomousEnabled: int("autonomous_enabled").default(0).notNull()');
    expect(schema).toContain(
      'index("user_profiles_autonomous_user_idx").on(table.autonomousEnabled, table.userId)'
    );
    expect(migration).toContain(
      "ADD INDEX `user_profiles_autonomous_user_idx` (`autonomous_enabled`, `user_id`)"
    );
    expect(migration).toContain("IF(JSON_VALID(`preferences`), `preferences`, '{}')");
  });

  it("keeps the application ledger cursor index aligned with the schema", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle", "schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle", "0039_application_ledger_cursor.sql"),
      "utf8"
    );

    expect(schema).toContain(
      'index("applications_user_created_idx").on(table.userId, table.createdAt, table.id)'
    );
    expect(migration).toContain(
      "ADD INDEX `applications_user_created_idx` (`user_id`, `created_at`, `id`)"
    );
  });

  it("keeps the saved-job cursor index aligned with the schema", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle", "schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle", "0056_saved_job_cursor_index.sql"),
      "utf8"
    );

    expect(schema).toContain(
      'index("saved_jobs_user_updated_idx").on(table.userId, table.updatedAt, table.id)'
    );
    expect(migration).toContain(
      "ADD INDEX `saved_jobs_user_updated_idx` (`user_id`, `updated_at`, `id`)"
    );
  });

  it("keeps the job-alert cursor index aligned with the schema", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle", "schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle", "0057_job_alert_cursor_index.sql"),
      "utf8"
    );

    expect(schema).toContain(
      'index("job_alerts_user_created_idx").on(table.userId, table.createdAt, table.id)'
    );
    expect(migration).toContain(
      "CREATE INDEX `job_alerts_user_created_idx` ON `job_alerts` (`user_id`, `created_at`, `id`)"
    );
  });

  it("keeps the resume-version cursor index aligned with the schema", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle", "schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle", "0058_resume_version_cursor_index.sql"),
      "utf8"
    );

    expect(schema).toContain(
      'index("user_resumes_user_version_cursor_idx").on(table.userId, table.version, table.id)'
    );
    expect(migration).toContain(
      "CREATE INDEX `user_resumes_user_version_cursor_idx` ON `user_resumes` (`user_id`, `version`, `id`)"
    );
  });

  it("keeps the public job-catalog cursor index aligned with the schema", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle", "schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle", "0059_job_catalog_cursor_index.sql"),
      "utf8"
    );

    expect(schema).toContain(
      'index("jobs_active_posted_created_cursor_idx").on(table.isActive, table.postedDate, table.createdAt, table.id)'
    );
    expect(migration).toContain(
      "CREATE INDEX `jobs_active_posted_created_cursor_idx` ON `jobs` (`is_active`,`posted_date`,`created_at`,`id`)"
    );
    expect(migration).toContain("DROP INDEX `jobs_active_posted_created_idx`");
    expect(schema).not.toContain('index("jobs_active_posted_created_idx")');
  });

  it("keeps the payment-history cursor index aligned with the schema", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle", "schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle", "0060_fee_payment_cursor_index.sql"),
      "utf8"
    );

    expect(schema).toContain(
      'index("fee_payments_user_created_id_idx").on(table.userId, table.createdAt, table.id)'
    );
    expect(migration).toContain(
      "CREATE INDEX `fee_payments_user_created_id_idx` ON `fee_payments` (`user_id`,`created_at`,`id`)"
    );
  });

  it("keeps bounded admin operating queue indexes aligned with the schema", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle", "schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle", "0061_admin_operating_queue_indexes.sql"),
      "utf8"
    );
    for (const indexName of [
      "admin_review_items_status_created_id_idx",
      "employment_verifications_status_submitted_id_idx",
      "fee_payments_created_id_idx",
      "success_fees_status_due_id_idx",
    ]) {
      expect(schema).toContain(`index("${indexName}")`);
      expect(migration).toContain(`CREATE INDEX \`${indexName}\``);
    }
  });

  it("keeps profile-evidence operating indexes aligned with the schema", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle", "schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle", "0062_profile_evidence_limits.sql"),
      "utf8"
    );
    for (const indexName of [
      "work_experiences_user_start_id_idx",
      "education_entries_user_end_id_idx",
      "user_skills_user_sort_id_idx",
      "user_projects_user_sort_id_idx",
    ]) {
      expect(schema).toContain(`index("${indexName}")`);
      expect(migration).toContain(`CREATE INDEX \`${indexName}\``);
    }
  });

  it("keeps application-ledger window indexes aligned with the schema", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle", "schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle", "0063_application_ledger_windows.sql"),
      "utf8"
    );
    for (const indexName of [
      "application_attempts_application_created_id_idx",
      "employer_responses_application_received_id_idx",
      "audit_events_entity_created_id_idx",
    ]) {
      expect(schema).toContain(`index("${indexName}")`);
      expect(migration).toContain(`CREATE INDEX \`${indexName}\``);
    }
  });

  it("keeps the follow-up cursor index aligned with the schema", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle", "schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle", "0064_follow_up_cursor_index.sql"),
      "utf8"
    );
    const indexName = "follow_ups_application_created_id_idx";

    expect(schema).toContain(`index("${indexName}").on(table.applicationId, table.createdAt, table.id)`);
    expect(migration).toContain(`CREATE INDEX \`${indexName}\``);
  });

  it("keeps the bounded operating-window index aligned with the schema", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle", "schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle", "0040_application_operating_window.sql"),
      "utf8"
    );
    const indexName = "applications_user_status_activity_idx";

    expect(schema).toContain(`index("${indexName}")`);
    expect(migration).toContain(
      `ADD INDEX \`${indexName}\` (\`user_id\`, \`status\`, \`last_activity\`, \`created_at\`, \`id\`)`
    );
  });

  it("keeps the account locale migration aligned with the schema", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle", "schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle", "0041_user_locale.sql"),
      "utf8"
    );

    expect(schema).toContain('locale: varchar("locale", { length: 10 }).default("en").notNull()');
    expect(migration).toContain("ADD COLUMN `locale` varchar(10) NOT NULL DEFAULT 'en'");
  });

  it("keeps workspace governance constraints and indexes aligned with the schema", () => {
    const schema = readFileSync(resolve(process.cwd(), "drizzle", "schema.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle", "0042_workspace_governance.sql"),
      "utf8"
    );
    const requiredNames = [
      "workspaces_creator_status_idx",
      "workspace_members_workspace_user_unique",
      "workspace_members_user_status_idx",
      "workspace_members_workspace_status_role_idx",
      "workspace_invitations_token_unique",
      "workspace_invitations_workspace_created_idx",
      "workspace_invitations_email_expiry_idx",
    ];
    for (const name of requiredNames) {
      expect(schema).toContain(name);
      expect(migration).toContain(`\`${name}\``);
    }
    expect(migration).toContain("ON DELETE CASCADE");
    expect(migration).toContain("ON DELETE RESTRICT");
    expect(migration).toContain("ON DELETE SET NULL");
    expect(migration).toContain("'workspace'");
  });
});
