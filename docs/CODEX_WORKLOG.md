# Codex Worklog

## 2026-08-09 - Account-backed localization foundation

- Added migration `0041` and a validated English/Dutch locale contract, preserving the preference across OAuth user upserts and both MySQL and standalone memory runtimes.
- Added an authenticated, user-scoped locale mutation with before/after audit evidence; focused testing exposed and fixed memory-mode before-state aliasing.
- Wired the account language through the React provider, HTML `lang`, shared navigation/auth shell, and Settings while documenting remaining untranslated workflow copy honestly.
- Restored the root `CURRENT_STATUS.md` referenced by the README and corrected the user-guide link.

## 2026-08-08 - Giant goal prompt implementation pass

- Audited the 116-phase prompt against current `main` at `e00ca3a`.
- Added server-owned privacy export and replaced the incomplete client-only Settings export.
- Added health/readiness probes and response security headers.
- Added `pnpm doctor`, Docker build files, connector environment examples, focused tests, and the required evidence documents.
- Kept unsupported external automation outside the product boundary. Production provider verification, legal review, Docker execution, and deployment remain explicitly partial.
- Ran the full regression suite successfully: 153 test files and 783 tests.
- Built the application successfully, verified the doctor command fails closed for incomplete production configuration, and checked the local `/healthz` and `/readyz` routes on port 3040.
- Exercised the Settings data export through Playwright; the generated file excluded connector credentials, private document bytes, and resume file URLs.

## 2026-08-09 - Privacy lifecycle and authorization pass

- Added one-at-a-time account-deletion review requests with user cancellation, bounded status responses, migration `0035`, and affected-user audit attribution.
- Reused the admin operating-review queue with privacy-specific evidence and language that resolving a review does not execute deletion.
- Fixed AdminPanel so privileged queries remain disabled until the authenticated user is known to be an admin; regular-user Access Denied no longer generates authorization errors.
- Verified the Settings request/cancel flow on desktop and 390 x 844 mobile with Playwright after the in-app browser connection timed out.
- Passed TypeScript, the production build, 156 test files / 793 tests, and the focused resume-import stability check.

## 2026-08-09 - Retention inventory pass

- Added privacy policy `2026-08-09.v1` covering the identity row, every direct user-owned table, four application-linked child tables, five private-object fields, and connector revocation requirements.
- Added an admin-only, count-only erasure preview to Review Evidence. It fails closed without a persistent database and explicitly cannot execute deletion.
- Added a schema-source regression so newly introduced direct user-owned tables fail tests until a retention action is assigned.

## 2026-08-09 - Windows, ngrok, and HAI interoperability pass

- Added an explicit loopback-first network configuration with fixed production ports and bounded development fallback.
- Added native Windows and ngrok launchers that fail closed and report availability only after health verification.
- Added a disabled-by-default, token-protected HAI A2A 1.0 status connector. It exposes bounded aggregate operational state only and cannot execute applications, send messages, or return user content.
- Verified local Agent Card discovery, unauthenticated endpoint concealment, authenticated aggregate status, and an A2A completed task on port 3040.
- Confirmed ngrok 3.39.8 is installed and configured; public tunnel acceptance remains pending an operator-owned reserved HTTPS hostname.
- Removed unnecessary real resume parser/storage initialization from router tests and capped Vitest at four workers to avoid resource-driven false timeouts.
- Passed TypeScript, the production build, and the full regression suite: 158 files and 800 tests.

## 2026-08-09 - Production bundle efficiency pass

- Measured a 367,750-byte production HTML shell and traced it to development-only Manus and JSX-location instrumentation.
- Limited both plugins to the Vite development server. The production shell is now 487 bytes, a 99.9% reduction, while route-level lazy loading remains intact.
- Added a build-time regression gate that rejects Manus/JSX-location markers and HTML shells larger than 25 KiB.
- Rendered the production output at 1440 x 900 and 390 x 844. The landing page remained correctly framed and the workflow-scroll interaction worked. The in-app browser timed out, so the recorded fallback used the bundled Playwright runtime; the static-only preview predictably could not serve tRPC requests.

## 2026-08-09 - Dashboard request efficiency and development runtime pass

- Replaced seven overlapping dashboard queries with one operating snapshot containing readiness, planner summary, success-fee summary, exact counts, and at most 10 projected recent applications.
- Removed campaign writes from the protected ledger GET and skipped global admin-review reads for non-admin users. Campaign synchronization remains available to autonomous service paths that explicitly request persistence.
- Corrected the dashboard’s jobs metric to describe the bounded roles scanned by the planner rather than implying a total inventory count.
- Fixed the embedded development server after command-aware Vite configuration caused `/src/main.tsx` to fall through to HTML. CLI and embedded startup now use the same tested configuration factory.
- Passed TypeScript, production build, focused dashboard/campaign/configuration tests, and the full regression suite: 159 files and 804 tests.

## 2026-08-09 - Operating query and persistence contract pass

- Added migration `0036` with 17 indexes covering the operating snapshot, profile readiness, application lifecycle, admin review, interview, resume, and success-fee query paths.
- Added a migration/schema alignment regression so an operating index cannot be declared in only one source of truth.
- Replaced full-table privacy-review and admin-evidence reads with bounded indexed lookups.
- Replaced the job aggregation source lookup's full duplicate-table scan with indexed direct/group queries.
- Corrected the in-memory admin-review store to expose the same complete row contract as MySQL, removing optional-status defects in privacy routes and admin evidence rendering.
- Batched offer-attribution evidence into one ownership-scoped response query and replaced repeated application searches with indexed in-memory maps.
- Consolidated operating-ledger child evidence into three ownership-scoped batch reads for responses, interview schedules, and follow-ups. All scheduling, outcome, notification, suppression, and reply projections reuse the grouped result.
- Replaced one interview-preparation existence query per upcoming interview with one user-scoped preparation read and a local job-ID set.
- Reused the ledger's preloaded applications, approvals, and employer responses for offer-attribution projection, while filtering every supplied row by user ownership and running remaining post-evidence projections concurrently.
- Moved the application-campaign row into the initial parallel snapshot read.
- Replaced the admin operating ledger's global review-table read with a capped user/status query backed by the existing `(user_id, status)` index.
- Replaced employment-verification resolution's global review-table scan with an exact affected-user/entity lookup for active review items.
- Replaced user-wide approval reads in standalone application lifecycle and admin evidence paths with an ownership-scoped application lookup that retains legacy entity links.
- Replaced admin evidence's full application and decision history reads with exact owned-record lookups and parallel evidence assembly.
- Replaced standalone lifecycle and approval-resolution list scans with exact owned application and approval lookups across confirmation, response, interview, follow-up, withdrawal, acceptance, and offer-decline paths.
- Replaced three preparation-route application-history scans with an exact pending `(user, canonical job)` lookup backed by the existing unique key.
- Reused the exact pending application and application-scoped approval lookups when save/ignore decisions close prepared work.
- Replaced employer-reply preparation's full response-history load with one ownership-scoped exact/latest-replyable lookup.
- Replaced interview-preparation context's repeated ownership and full schedule reads with one owned, future-status, ordered, limited query.
- Batched autonomous follow-up responses, interview schedules, and existing follow-ups into three ownership-scoped reads per run instead of up to three reads per candidate.
- Added migration `0037` for indexed due-alert selection, avoided loading jobs/platforms when no alert is due, and stopped job matching at the first hit.
- Replaced the due-alert scheduler's unbounded active-job materialization with 250-row canonical-job pages and one bulk timestamp update for matched alerts.
- Added a dedicated `windows-latest` CI job for PowerShell launcher parsing, network/HAI contracts, TypeScript, dependency-lock integrity, and the production build.
- Verified both the complete Ubuntu job and the new Windows runtime job in GitHub Actions run `31291576077`.
- Upgraded vulnerable Vitest/Vite dependencies, moved the ignored Nano ID override into active pnpm workspace settings, and enforced high/critical advisory scanning in CI.
- Verified the dependency audit reports no high or critical advisories.
- Aligned local and CI dependency resolution on pnpm 11, restricted install scripts to esbuild, patched Mermaid/DOMPurify/PostCSS/esbuild transitive paths, and raised CI enforcement to moderate severity.
- Verified `pnpm security:audit` reports no known vulnerabilities at any severity.
- Passed TypeScript and the full regression suite: 163 files and 846 tests.

## 2026-08-09 - Database recovery pass

- Added Windows-compatible streaming MySQL backup and restore commands with credentials excluded from process arguments and manifests.
- Backups now publish only complete, non-empty dumps with a versioned manifest, byte count, and SHA-256 checksum; failed runs remove partial bundles.
- Restore now fails before database mutation on malformed or modified bundles, database-name mismatch, or missing target-specific confirmation.
- Added operator procedures and adversarial tests for first-run backup directories, tampering, target mismatch, and confirmation enforcement.

## 2026-08-09 - Discovery traffic-control pass

- Propagated abort signals through every network scraper so source deadlines cancel active fetches.
- Serialized overlapping scans per source while retaining a configurable 1-10 cross-source concurrency cap.
- Replaced unconditional fixed-delay retries with transient-only exponential backoff, bounded `Retry-After` handling, and abortable per-source pacing.
- Added production doctor enforcement for explicit scheduled-source allowlisting and valid timeout/concurrency settings.
- Exposed the effective execution policy through the admin API and source-health UI, with cross-adapter regression coverage.

## 2026-08-09 - Container and fresh-database acceptance pass

- Built the production image on Windows Docker Desktop and repaired its stale pnpm 10 pin and missing workspace override configuration.
- Added a non-root runtime, Docker health check, bundled production doctor, and bundled lock-protected database migrator.
- Repaired migration `0030`'s overlong MySQL foreign-key identifier and made its related DDL atomic; added missing statement boundaries to migration `0036`.
- Added migration contracts for statement boundaries and MySQL's 64-character identifier limit.
- Applied all 38 migrations from an empty MySQL 8.4 database, verified 38 tables and released migration lock, and reran the bundled migrator idempotently.
- Removed the production server's Vite runtime dependency and verified the pruned image becomes healthy, reports production database readiness, and serves the frontend.
- Added a Linux CI container job that repeats fail-closed startup, full migration, image health, readiness, and frontend checks.
- Passed TypeScript and the full regression suite: 164 files and 852 tests.

## 2026-08-09 - Connector revocation and cleanup pass

- Repaired connector disconnect ordering so Hire.AI access is disabled before provider cleanup and encrypted grants are not destroyed before revocation can be attempted.
- Added bounded app-scoped revocation for Google, Dropbox, and GitHub without logging provider bodies or token values.
- Made Google revocation disable and clean both Gmail and Drive records because the provider invalidates the shared project grant.
- Kept Microsoft and LinkedIn truthful and narrow: local credentials are removed and account-side removal guidance is returned instead of invoking broad sign-in-session revocation.
- Retained encrypted grants after provider failure solely for retry, with high-risk audit status and user-visible warning.

## 2026-08-09 - Durable privacy cleanup planning pass

- Added migration `0038` with idempotent erasure runs, secret-free itemized tasks, bounded execution leases, retry state, and manual-cleanup evidence.
- Added separately confirmed transactional database finalization with policy-coverage drift protection, rollback/retry behavior, account pseudonymization, erasable-record deletion, retained-ledger scrubbing, regulated-record preservation, and clean-MySQL acceptance.
- Centralized sensitive-document scanning at the storage boundary, added authenticated and timeout-bounded HTTP scanning for cloud deployments, native Microsoft Defender scanning for Windows standalone, and removed the unused direct resume-storage bypass.
- Added credential-safe Docker MySQL client support to backup/restore and completed a two-container isolated recovery drill with checksum, migration, table, and sentinel reconciliation.
- Removed nested primary landmarks from the shared routed shell, made brand/account navigation screen-reader and keyboard identifiable, and fixed a browser-confirmed 390-pixel dashboard overflow caused by sentence-length status badges.
- Made resolved privacy reviews create a non-destructive plan before the review is closed, preventing resolved-without-plan failure.
- Added exact-confirmation admin controls for provider/object cleanup and evidence controls for unsupported provider revocation.
- Made private-object deletion idempotent when storage already reports the object missing.
- Applied all 39 migrations to clean MySQL 8.4 and verified plan idempotency, no copied token/object values, lease-protected cleanup, manual action, and `ready_for_database` transition.

## 2026-08-09 - Application ledger scalability pass

- Replaced the primary unbounded application-list read with stable 50-row keyset pages capped at 100 rows per request.
- Added one-query whole-ledger aggregates and an exact ownership-scoped deep-link lookup so counts and direct navigation do not depend on loaded pages.
- Replaced the platform-name scalar lookup with a joined projection and added migration `0039` for the `(user_id, created_at, id)` cursor index.
- Added same-timestamp traversal, aggregate, cross-owner, and migration-alignment regressions; passed 169 test files and 877 tests, TypeScript, production build, dependency audit, and the development doctor.
- A local disposable MySQL initialization did not reach its final TCP server within the fixed probe window; the existing health-gated container CI remains the authoritative clean 40-migration acceptance for this increment.

## 2026-08-09 - Bounded operating workload pass

- Removed complete joined application-history hydration from dashboard snapshots and autonomous cycles.
- Added an oldest-first 250-record active window, exact current-job application and user-decision lookups, and an exact same-day autonomous preparation counter so duplicate prevention and daily limits remain correct.
- Replaced full approval and decision histories with bounded operating queues plus exact aggregate totals; approved follow-up handoffs remain scoped to the loaded applications.
- Added migration `0040` for the user/status/activity operating index and explicit truncation fields in dashboard and durable autonomous-run output.
- Passed synthetic 260-application and 105-pending-approval workloads, exact ownership/current-job checks, TypeScript, and the full 169-file/883-test regression suite. Representative production-volume MySQL query plans remain deployment acceptance.
