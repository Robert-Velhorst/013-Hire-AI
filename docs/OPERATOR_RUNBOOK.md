# Operator Runbook

## Local operation

```powershell
pnpm install --frozen-lockfile
pnpm doctor
pnpm check
pnpm test
pnpm build
pnpm dev
```

The server exposes `/healthz` and `/readyz`. Development can use in-memory persistence for review, but it is not durable and must not be treated as production data.

For native production startup on Windows 11, use `npm.cmd run start:windows`. It builds, runs the production doctor, binds to loopback by default, and waits for local health. For a reserved ngrok origin and the local/private HAI A2A connector, follow `docs/WINDOWS_NGROK_HAI.md`; public health and Agent Card availability are necessary checks, not provider acceptance evidence.

## Database and workers

Set `DATABASE_URL`, then run `pnpm db:migrate`. The migrator uses a database-scoped advisory lock, a 15-second connection timeout, and a 60-second lock wait by default; `DB_MIGRATION_CONNECT_TIMEOUT_MS` and `DB_MIGRATION_LOCK_WAIT_SECONDS` provide bounded overrides. Each app instance defaults to 10 SQL connections, a 100-request wait queue, and a 60-second idle timeout; tune `DATABASE_POOL_LIMIT`, `DATABASE_POOL_QUEUE_LIMIT`, and `DATABASE_POOL_IDLE_TIMEOUT_MS` against the provisioned MySQL connection budget and replica count. `AUTONOMOUS_SCHEDULER_ENABLED` controls review-only autonomous planning. `JOB_SCRAPING_SCHEDULER_ENABLED` is off by default. Before enabling it, set an explicit `JOB_SCRAPING_ENABLED_PLATFORMS` allowlist, verify each source policy, and choose bounded `JOB_SCRAPING_MAX_CONCURRENT_SOURCES` (1-10) and `JOB_SCRAPING_SOURCE_TIMEOUT_MS` (5,000-300,000). Production doctor rejects scheduled discovery without an allowlist or with invalid traffic limits.

Each source adapter applies its own minimum request interval. Transient network, HTTP 408/425/429, and 5xx failures use bounded exponential backoff and honor `Retry-After` up to five minutes. Permanent HTTP failures are not retried. One source cannot have overlapping scans, cross-source concurrency is capped, and a source deadline aborts its underlying fetch rather than only abandoning the result. The Admin source-health view reports the effective concurrency and timeout policy.

## Database backup and restore

Install compatible MySQL client tools so `mysqldump` and `mysql` are available. On Windows with a MySQL Docker container, set `DATABASE_RECOVERY_DOCKER_CONTAINER=<exact-container-name>` or pass `--docker-container <name>`; the tools then run inside that container against its loopback MySQL service. The commands pass the database password through the child-process environment, never through the process argument list or backup manifest.

1. Disable autonomous and scraping workers and wait for active runs to finish.
2. Set `DATABASE_URL` for the source database and run `pnpm db:backup`. A successful run creates `backups/<database>-<UTC timestamp>/database.sql` and `manifest.json` only after a non-empty dump is complete.
3. Run `pnpm db:backup:verify -- <backup-directory>`. Move the verified bundle to encrypted, access-controlled storage outside the application host. The local `backups/` directory is intentionally ignored by Git.
4. For a restore drill, provision an isolated empty database with the same database name, point `DATABASE_URL` at it, and run `pnpm db:restore -- <backup-directory> --confirm RESTORE:<database>`.
5. Run `pnpm db:migrate`, `pnpm doctor`, application reconciliation checks, and representative read-only workflows against the restored target. Record the bundle checksum, restore target, timestamps, and results.
6. Never restore over the active production database as a test. Re-enable workers only after database and provider reconciliation succeeds.

The 2026-08-09 Windows drill used separate `mysql:8.4` source and target containers. A 60,071-byte bundle with SHA-256 `f89d253ede6fa5c9b1825ce0975feed4c91c133e7656ec04de99b40c6870f3e1` restored successfully; both sides reconciled to 40 tables, 39 migration records, one sentinel job, and one sentinel user before both containers were removed.

The restore command fails before starting `mysql` when the manifest is malformed, the dump is missing or changed, the source and target database names differ, or the exact target-specific confirmation is absent. Database backup does not copy private storage objects; the storage provider needs its own versioning and recovery policy.

## Incident response

1. Disable both scheduler flags.
2. Disconnect the affected connector or disable its provider configuration.
3. Preserve audit events and review records; do not fabricate completion evidence.
4. Investigate with admin source health and review queues.
5. Resume only after the provider policy, credentials, and test evidence are verified.

## Privacy deletion review

1. Confirm the request belongs to the account holder and inspect the user audit trail.
2. Identify active billing, employment verification, payment recovery, disputes, and legal holds.
3. Open Review Evidence and inspect the retention/erasure preview. It must use the current policy version, return an authoritative database count, and classify every table.
4. Record which data is eligible for erasure and the approved retention period and legal basis for everything that must remain.
5. Resolving a review on persistent storage creates one non-destructive run with itemized provider, private-object, retention-hold, and database-finalization tasks.
6. Type the exact run-specific confirmation in Admin before external cleanup. A five-minute lease prevents concurrent workers; failed tasks remain retryable without exposing provider responses, tokens, or object keys.
7. Complete Microsoft and LinkedIn account-side removal, then record bounded evidence against each blocked task. Never paste tokens or credentials into evidence.
8. At `ready_for_database`, enter the separate database confirmation and run finalization. Report erasure only after status is `completed`; reconcile the final deleted/scrubbed inventory and retained regulated records first.

## Deployment

Build with `docker build -t hire-ai .`. Apply migrations from the same immutable image with `docker run --rm --network <database-network> -e DATABASE_URL=<target> --entrypoint node hire-ai scripts/database-migrate.mjs`, then run the exact runtime-model check with the same network and `DATABASE_URL` using `--entrypoint node hire-ai dist/database-schema-audit.js`. Start the normal image only after both commands pass. The non-root container runs the production doctor before the server and reports Docker health through `/healthz`; missing configuration, schema drift, or malware scanning fails acceptance. Do not deploy until the doctor passes and a verified database backup and isolated restore drill have been recorded.
