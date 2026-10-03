# Operator Runbook

## Local operation

```powershell
pnpm install --frozen-lockfile
pnpm run doctor
pnpm check
pnpm test
pnpm build
pnpm dev
```

The server exposes `/healthz` and `/readyz`. Development can use in-memory persistence for review, but it is not durable and must not be treated as production data.

For native production startup on Windows 11, use `npm.cmd run start:windows`. It builds, runs the production doctor, binds to loopback by default, and waits for readiness bound to its own live child rather than any existing service on the port. The temporary `HIRE_AI_RUNTIME_INSTANCE_ID` is launcher-owned; do not persist it in `.env` or treat it as an access credential. For a reserved ngrok origin and the local/private HAI A2A connector, follow `docs/WINDOWS_NGROK_HAI.md`; public health and Agent Card availability are necessary checks, not provider acceptance evidence.

Generate `JWT_SECRET` with a cryptographically secure secret manager or random-byte generator and inject it at runtime. Production accepts 32-4096 characters with no surrounding whitespace or control characters; checked-in and local-development placeholders are rejected. Rotating this value invalidates every existing session, so schedule rotation and require users to sign in again. `pnpm run doctor` reports only whether the policy passes and never prints the value.

Set `OAUTH_PORTAL_URL` at runtime to the trusted Manus login portal base URL. Production accepts HTTPS; loopback HTTP is available only for local operation. Credentials, query parameters, and fragments are rejected. The browser opens `/api/oauth/login`, and the server derives the current direct or trusted-ngrok callback origin, creates signed browser-bound state, and redirects to the portal. The legacy `VITE_OAUTH_PORTAL_URL` name remains a migration alias, but new deployments must not bake portal configuration into the browser bundle.

OAuth sessions default to a seven-day absolute lifetime. Set `SESSION_TTL_MS` only to an integer from 900,000 (15 minutes) through 2,592,000,000 (30 days). The production doctor rejects malformed or out-of-range values, and the same effective value controls both the signed JWT expiry and browser-cookie age. Changing it affects newly issued sessions; use logout/session revocation when existing sessions must end immediately.

## AI requests

The current shared AI adapter uses `BUILT_IN_FORGE_API_KEY`, the optional trusted `BUILT_IN_FORGE_API_URL` (default `https://forge.manus.im`), and model `gemini-2.5-flash`. It does not read `OPENAI_API_KEY`; obtaining an OpenAI key alone does not configure this adapter or replace the identity/storage integrations.

Developers can pass `maxTokens` or `max_tokens` to `invokeLLM` to bound an individual response. The value must be an integer from 1 through 32,768. If both names are supplied, they must agree. Invalid limits fail before a provider request. Omitted limits retain the existing 32,768-token default; current feature callers omit them, so this repair alone is not a measured cost or latency reduction. Select smaller per-feature budgets only after testing complete outputs on representative inputs. These are response limits, not account spending caps.

AI requests retain the two-minute deadline, 8 MiB response limit and redirect rejection. For HTTP failures, only the numeric status is propagated; response bodies and status text are discarded because they can contain private input. Do not log raw provider responses to diagnose failures. No live AI/provider acceptance is implied by the synthetic adapter tests.

A successful HTTP response is not sufficient. The shared adapter validates the completion envelope and accepts only complete, nonempty assistant responses or the requested function-tool responses. Missing/unknown completion statuses, token-limit truncation, content filtering, refusals, malformed JSON and inconsistent message shapes are rejected without exposing response fragments or validation details. Job matching then uses its existing explicitly labelled deterministic fallback. Other callers retain their existing error handling; this does not manufacture a replacement AI result.

Function responses must use offered function names, respect explicit `toolChoice` restrictions and contain JSON-object arguments. Required function responses cannot be replaced with ordinary text. The adapter never executes a tool: consumers must still check business rules, authorization and the appropriate approval before external actions. The deprecated `function_call` response is not supported by this adapter. Status meanings follow the [Chat Completions response contract](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create); actual Forge-provider compatibility still needs live acceptance.

Structured response content is locally checked against the same JSON Schema supplied to the provider, including all four supported schema-option aliases. Offered function-argument schemas are checked too. `json_object` mode requires a parsed JSON object. Ajv validates without type coercion, inserted defaults or removal of unexpected properties. Invalid/unsupported schemas fail before any provider call; only trusted server-authored Draft-7-compatible schemas belong in this interface. Remote schema loading and asynchronous validators are not enabled.

Compiled validators use a 64-entry least-recently-used cache keyed by schema content, with at most 64 KiB per input schema. This avoids repeated compilation when callers recreate identical object literals; mutations produce different validators. Ajv's separate schema cache is released after compilation and per-validation errors are cleared instead of retaining provider-supplied field names. These policies follow [Ajv schema-management guidance](https://ajv.js.org/guide/managing-schemas.html). Schema validity does not prove that AI statements are factually correct or supported by the candidate's evidence.

## Resume imports and scanning

Local `resume.parseFile` uploads and `profile.importCloudResume` imports validate
size, type and file signature, then await `scanSensitiveUpload` before invoking a
document parser or AI. A failed scan leaves parsing, versioned storage and profile
updates unstarted. Production rejects an unavailable scanner; development retains
its existing explicitly unconfigured-scanner behavior. A successful scan is not
a guarantee that a document is harmless or that extracted statements are true.

The storage boundary still independently scans sensitive uploads. This protects
direct upload callers as well as imports, but means a successful imported resume
is currently scanned twice. There is no caller-provided bypass flag or reusable
cross-request clean verdict. The earlier check prevents unsafe parsing and wasted
AI work after a rejected scan; it is not a measured overall latency improvement.

HTTP scanner responses are read incrementally with a 64 KiB limit, including when
`Content-Length` is absent or inaccurate. Oversized and unsuccessful responses are
canceled rather than fully buffered or left unread. Existing scan timeouts and
concurrency limits remain in force, and failure releases the active scan permit.
Live Windows Defender and cloud-scanner acceptance must still be performed in the
chosen deployment environment.

After extraction, the shared resume parser rejects empty/whitespace-only text and
text exceeding `MAX_RESUME_TEXT_CHARS` (500,000 JavaScript string code units after
trimming) before contacting AI. This matches the existing pasted-text limit and
also covers imported files. Over-limit text is rejected, not silently truncated.
PDF page labels added by the parser library are disabled so a blank page cannot
masquerade as readable text. Image-only resumes still need OCR outside this path;
the error asks for a text-based document or pasted resume text. This post-extraction
limit bounds the AI input, not the PDF/DOCX engine's peak decompression memory.

Profile conversion omits completely blank work and education records before
formatting them. Formatting punctuation alone must not overwrite existing profile
evidence. Nonempty extracted information still requires factual review; structural
validation does not verify candidate claims.

Resume activation/deletion requires both the displayed `version` and immutable
`resumeId`. A version number can be reused after deletion and is not a durable
identity. The Profile page sends the ID from its owner-scoped history result and
refreshes its queries after a rejected stale action. Deploy the client and server
together; older callers that send only a version are rejected and must refresh or
adopt the new input. No database migration is needed for this contract change.

The general `profile.update` endpoint rejects supplied `resumeUrl` and
`resumeFileKey` values, including empty strings and nulls. Resume references must
come from the versioned upload/import, activation and deletion routes; ordinary
profile edits leave those references untouched. Rejection happens before saving
any part of the request. Legacy integrations must use `resume.uploadWithHistory`
or `resume.parseFile` instead of writing file metadata to the profile.

The versioned service writes the active resume reference inside the same
owner-locked transaction as uploads, activation and active-version deletion.
Local/cloud file imports pass parsed skills, experience, education and validated
social links into that transaction as well; missing parsed fields preserve
existing evidence and unrelated preferences are not overwritten. The routers no
longer reread and rewrite the profile after the version service returns. This
prevents an earlier request from overwriting a later committed resume selection.
Changing the active file alone does not reparse historical files or replace
manually edited profile evidence. No schema migration is required.

This input restriction does not repair historical profile references. Private
object erasure now separately validates the normalized key against the run's
user: resume objects must be under `resumes/<userId>/` and attempt screenshots
under `attempts/<userId>/`. Existing path-safety validation also runs before the
cleanup dependency is called. A task belonging to a different user, a missing or
invalid source-record ID, or a mismatched object prefix fails the task and prevents
database finalization. A null key remains an already-cleared no-op; an empty string
is an invalid key, not evidence of completed cleanup.

Legacy references outside these namespaces require operator review against the
user's resume ledger and authenticated storage inventory. Do not bypass the guard
or mark the task complete to clear a warning. No historical records are rewritten
by this check. Namespace validation enforces the application's storage-key
ownership convention; it does not independently inspect provider-side object
permissions or establish end-to-end erasure acceptance.

Deletion checks the owner and expected ID before private storage cleanup, then
rechecks the original record ID and object key under the owner lock before removing
its database row. A delayed deletion cannot remove a new row that reused the old
version number. The SQL row and profile reference now commit together, but object
storage and SQL remain separate systems. Storage calls deliberately happen outside
the owner lock. Failed upload transactions attempt object cleanup; cleanup failure
or an uncertain commit still needs reconciliation. If object deletion succeeds
and the SQL transaction fails, a retained ledger row can reference a missing
object. This change does not implement cross-system atomicity or recovery for
those cases. Match refresh and audit recording also remain post-commit operations.

## Database and workers

Set `DATABASE_URL`, then run `pnpm db:migrate`. The migrator uses a database-scoped advisory lock, a 15-second connection timeout, and a 60-second lock wait by default; `DB_MIGRATION_CONNECT_TIMEOUT_MS` and `DB_MIGRATION_LOCK_WAIT_SECONDS` provide bounded overrides. Each app instance defaults to 10 SQL connections, a 100-request wait queue, and a 60-second idle timeout; tune `DATABASE_POOL_LIMIT`, `DATABASE_POOL_QUEUE_LIMIT`, and `DATABASE_POOL_IDLE_TIMEOUT_MS` against the provisioned MySQL connection budget and replica count. `AUTONOMOUS_SCHEDULER_ENABLED` controls review-only autonomous planning. `JOB_SCRAPING_SCHEDULER_ENABLED` is off by default. Before enabling it, set an explicit `JOB_SCRAPING_ENABLED_PLATFORMS` allowlist, verify each source policy, and choose bounded `JOB_SCRAPING_MAX_CONCURRENT_SOURCES` (1-10) and `JOB_SCRAPING_SOURCE_TIMEOUT_MS` (5,000-300,000). Production doctor rejects scheduled discovery without an allowlist or with invalid traffic limits.

Each process limits non-Stripe `/api` traffic to 600 requests per trusted client per minute and stores at most 10,000 active client windows. Health probes and signed Stripe webhook retries are exempt. This protects the standalone Windows/ngrok process without adding SQL work; configure a distributed gateway/WAF rate policy before scaling to multiple public instances because process-local counters are not a global quota.

Each source adapter applies its own minimum request interval. Transient network, HTTP 408/425/429, and 5xx failures use bounded exponential backoff and honor `Retry-After` up to five minutes. Permanent HTTP failures are not retried. One source cannot have overlapping scans, cross-source concurrency is capped, and a source deadline aborts its underlying fetch rather than only abandoning the result. The Admin source-health view reports the effective concurrency and timeout policy.

## Database backup and restore

Install compatible MySQL client tools so `mysqldump` and `mysql` are available. On Windows with a MySQL Docker container, set `DATABASE_RECOVERY_DOCKER_CONTAINER=<exact-container-name>` or pass `--docker-container <name>`; the tools then run inside that container against its loopback MySQL service. The commands pass the database password through the child-process environment, never through the process argument list or backup manifest.

1. Disable autonomous and scraping workers and wait for active runs to finish.
2. Set `DATABASE_URL` for the source database and run `pnpm db:backup`. A successful run creates `backups/<database>-<UTC timestamp>/database.sql` and `manifest.json` only after a non-empty dump is complete.
3. Run `pnpm db:backup:verify -- <backup-directory>`. Move the verified bundle to encrypted, access-controlled storage outside the application host. The local `backups/` directory is intentionally ignored by Git.
4. For a restore drill, provision an isolated empty database with the same database name, point `DATABASE_URL` at it, and run `pnpm db:restore -- <backup-directory> --confirm RESTORE:<database>`.
5. Run `pnpm db:migrate`, `pnpm run doctor`, application reconciliation checks, and representative read-only workflows against the restored target. Record the bundle checksum, restore target, timestamps, and results.
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

For the online multi-user release at Hetzner, begin with [Hetzner Hosting](HETZNER_HOSTING.md) and use [Production Acceptance](PRODUCTION_ACCEPTANCE.md) as the release gate. The runtime now validates the shared schema contract itself before catalog initialization and HTTP listening, including direct `node dist/index.js` starts. Validation never applies migrations automatically. Docker health checks `/readyz`, not just process liveness. Live identity, private storage/scanning, provider and employer-submission acceptance are separate requirements.

Build with `docker build -t hire-ai .`. Inject `DATABASE_URL` securely into the operator environment. Apply migrations from the same immutable image with `docker run --rm --network <database-network> -e DATABASE_URL --entrypoint node hire-ai scripts/database-migrate.mjs`, then run the exact runtime-model check with the same network and inherited `DATABASE_URL` using `--entrypoint node hire-ai dist/database-schema-audit.js`. Start the normal image only after both commands pass. The non-root container runs the production doctor before the server and reports Docker health through `/readyz`; missing configuration, schema drift, or malware scanning fails acceptance. Do not deploy until the doctor passes and a verified database backup and isolated restore drill have been recorded.
