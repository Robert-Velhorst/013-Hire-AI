# Codex Worklog

## 2026-08-14 - Cache-stable production browser bundles

- Split the 577,363-byte browser entry into a 284,254-byte application entry plus independently cacheable React and data-client runtimes while leaving route-specific UI dependencies lazy.
- Added build gates limiting every JavaScript chunk to 350 KiB and aggregate eagerly loaded JavaScript to 600 KiB; measured startup JavaScript remained slightly lower at 576,147 bytes instead of 577,363 bytes.
- Made production dependency selection deterministic even when a caller such as the test workflow exports `NODE_ENV=test`, preventing React's development runtime from entering release assets.
- Removed 2,355 lines of unreferenced component-showcase and source-backup code from the TypeScript project. Development and production-bundle browser checks rendered the landing page, switched EN to NL, and reported no console warnings or errors.

## 2026-08-14 - Deterministic admin fee query plans

- Split the admin success-fee page into an indexed, deterministic ID window followed by a bounded user-details join, preventing MySQL from choosing a user-scoped index for the global page.
- Added global creation/ID and status/creation/ID indexes plus a migration, and made timestamp ties deterministic with descending ID order.
- Added a rollback-only 5,000-row MySQL 8.4 query-plan audit to container CI. Local acceptance confirmed both windows use their exact indexes with backward index scans and no full scan or filesort.

## 2026-08-09 - Cursor-paged application follow-ups

- Replaced the selected-application full follow-up history read with deterministic 10-record cursor pages and incremental loading.
- Added an application/creation-time/ID index and preserved complete follow-up history for withdrawal, approval, and autonomous lifecycle logic.
- Removed the three-item display truncation so every loaded follow-up remains actionable and older history has an explicit load path.

## 2026-08-09 - Bounded application-ledger detail windows

- Limited selected-application attempt, employer-response, and audit reads to the newest records the interface can render, with one-row lookahead overflow signals.
- Added deterministic timestamp/ID ordering and matching database indexes for all three ledger streams.
- Updated the application detail summary and headings to describe recent windows truthfully instead of implying complete history.

## 2026-08-09 - Transactional profile-evidence ceilings

- Added transactionally enforced per-user limits for work history, education, skills, and projects, serializing concurrent inserts on the owning user record.
- Bounded every operating, matching, readiness, and Profile read to the same complete collection ceilings while retaining separate complete privacy-export reads for legacy overflow.
- Added stable limit-aligned indexes, strict field-size validation, visible capacity counters, and disabled add controls at capacity.

## 2026-08-09 - Bounded admin operating windows

- Capped global review, overdue-verification, and pending-verification reads at 100 ordered records and retained existing bounded fee/payment windows.
- Added one parallel database aggregate for exact queue, risk, category, fee, and payment totals so command-center decisions and badges no longer depend on truncated arrays.
- Added global operating indexes for review order, verification order, overdue selection, and payment order, with standalone-mode parity and truthful visible-window labels.

## 2026-08-09 - Scoped offer-attribution review reads

- Replaced interactive offer-review history scans with exact owner/application reads for Applications and the report-hire dialog.
- Bounded Billing's review panel to the newest 25 eligible pending reviews while retaining an exact total and a truthful overflow path to Applications.
- Removed the unused full-history API route and retained the separate five-item autonomous-planning aggregate.

## 2026-08-09 - Cursor-paged, currency-correct payment history

- Replaced Billing's complete payment-ledger read with owner-scoped 50-record cursor pages and incremental loading.
- Added exact paid and active-monthly totals grouped by currency, removing incorrect cross-currency dollar sums from the browser.
- Added an owner/time/ID payment index and kept complete regulated payment records available for retention and provider reconciliation.

## 2026-08-09 - Page-aligned job-match reads

- Replaced Job Search's complete account match-ledger read with owner-scoped lookups for only the loaded catalog jobs.
- Reused bounded 250-ID chunks as users load additional catalog pages, preserving refresh behavior after match recalculation.
- Kept the complete match ledger internal for autonomous processing while removing it from the interactive API surface.

## 2026-08-09 - Cursor-paged public job catalog

- Replaced Job Search's 250-record offset read with deterministic 50-record cursor pages ordered by posted time, creation time, and ID.
- Added an index-backed public page contract with explicit handling for listings without a posted date and incremental loading in the UI.
- Chunked owner-scoped application-decision lookups so loading beyond 250 jobs remains within the API's bounded input contract.

## 2026-08-09 - Transactional, cursor-paged resume history

- Serialized resume version assignment, activation, and deletion on the stable account row to prevent concurrent duplicate versions or multiple active resumes.
- Added uploaded-object cleanup when the database transaction fails and verified a target version before deactivating the current resume.
- Replaced Profile's full resume-history read with indexed cursor pagination while preserving complete privacy exports.

## 2026-08-09 - Cursor-paged job alerts

- Replaced the live Job Alerts full-history query with stable cursor pagination and incremental frontend loading.
- Added an owner/created-time/ID database index for deterministic, index-backed alert pages.
- Preserved complete alert reads only for explicit privacy export and internal alert processing.

## 2026-08-09 - Cursor-paged saved jobs

- Replaced the live saved-jobs full-history read with stable cursor pagination and incremental frontend loading.
- Added an owner/time/ID database index so equal-timestamp pages stay deterministic and index-backed.
- Kept complete saved-job reads available only for explicit privacy export and internal compatibility.

## 2026-08-09 - Bounded profile inbox-response review

- Replaced the Profile page's unbounded inbox-response route with an owner-validated 25-item page and exact pending total.
- Preserved review processing and dismissal refresh behavior while preventing the browser from loading an unlimited mailbox-derived queue.

## 2026-08-09 - Exact connector impact and bounded inbox candidates

- Added an exact owner-scoped application aggregate for inbox response monitoring instead of counting only the bounded operating window.
- Reduced dashboard inbox-candidate hydration from 100 records to five while retaining the database-counted total and truncation metadata.
- Added a 260-application regression proving connector impact remains exact beyond the operating window.

## 2026-08-09 - Exact follow-up readiness aggregates

- Moved total due-candidate and held-follow-up counts into the exact owner-scoped drafting query instead of deriving them from the 250-application planning window.
- Removed redundant dashboard hydration of bulk responses, schedules, follow-ups, approved approvals, and approval-linked applications.
- Reduced the dashboard pending-approval page to five records while preserving its exact total and kept the autonomous preview's focused safety evaluation unchanged.

## 2026-08-09 - Exact bounded review queues

- Reduced admin and review-decision dashboard hydration from 100 records to five while preserving database-counted totals.
- Added explicit truncation metadata for the review-decision queue and removed redundant post-query slicing.
- Added covering indexes and scale coverage proving exact totals, bounded pages, and cross-user isolation.

## 2026-08-09 - Exact bounded offer-attribution operating reads

- Replaced the dashboard's first-100 approval dependency with an exact owner-scoped offer-attribution count and a bounded five-item review page.
- Limited employer-response hydration to the visible review page and exposed truncation truthfully through `offerAttributionScope`.
- Added a covering operating index plus regression coverage for reviews beyond the general approval window and cross-user isolation.

## 2026-08-09 - Exact bounded follow-up drafting queue

- Replaced planning-window drafting counts with an exact owner-scoped due-time query and a five-record command-center page.
- Preserved active-draft, employer-reply, interview-scheduling, and missing-outcome holds at the database boundary.
- Added an active-draft lookup index plus scale coverage proving due work beyond the 250-application planning window remains visible.

## 2026-08-09 - Exact bounded follow-up delivery queues

- Replaced operating-window send-handoff and uncertain-delivery counts with exact owner-scoped aggregates.
- Added separate five-record command-center pages and truncation metadata for send-ready and reconciliation work.
- Added a covering approval index plus scale coverage proving delivery work beyond the 250-application planning window remains visible.

## 2026-08-09 - Exact bounded employer-reply queue

- Replaced operating-window reply counts with an exact owner-scoped latest-response query and a five-record command-center page.
- Added a durable indexed employer-response link on follow-up drafts, including migration backfill from existing approval payloads.
- Preserved pending/approved draft suppression while exposing explicit queue truncation metadata and exact totals.

## 2026-08-09 - Exact bounded interview-scheduling queue

- Replaced operating-window scheduling counts with an exact owner-scoped account query preserving new-invite, cancelled-schedule, completed-round, and missing-schedule rules.
- Added a five-record command-center page and explicit truncation metadata while keeping autonomous planning bounded.
- Added MySQL indexes for latest invitation and per-application schedule-state evaluation plus ownership and scale coverage.

## 2026-08-09 - Exact bounded interview-outcome queue

- Replaced operating-window outcome counts with an exact owner-scoped anti-join over completed interviews and recorded outcome evidence.
- Added a five-record command-center page and explicit truncation metadata without widening autonomous planning reads.
- Added scale coverage proving completed interviews for another account cannot enter the queue or its total.

## 2026-08-09 - Exact bounded admin-review queue

- Replaced capped-list length reporting with an exact owner- and status-scoped admin-review count.
- Added a bounded 100-record operating page, a five-record dashboard projection, and explicit truncation metadata.
- Added scale coverage proving foreign-owner and resolved reviews cannot enter active queue totals or records.

## 2026-08-09 - Exact verified interview-notification queue

- Replaced broad unread-notification hydration plus in-memory validation with one owner-scoped joined query over current interview applications and invite evidence.
- Added an exact actionable alert total, a five-record operating page, and explicit truncation metadata.
- Kept stale, closed, foreign-owner, and non-invite records out of command-center counts at the query boundary.

## 2026-08-09 - Exact bounded interview-preparation queue

- Replaced full user preparation-history hydration with an owner-scoped anti-join over upcoming scheduled interviews.
- Added an exact actionable preparation count, a 10-record operating page, and explicit truncation metadata.
- Preserved the existing upcoming-interviews API without adding an unnecessary aggregate query to that bounded list.

## 2026-08-09 - Bounded inbox-response command-center reads

- Replaced full pending mailbox-candidate hydration with an indexed 100-item operating page and exact owner-scoped count.
- Added explicit inbox queue truncation metadata while preserving exact dashboard and next-action totals.
- Wired frontend review counters to exact ledger metrics so bounded queues no longer underreport pending work.

## 2026-08-09 - Aggregate success-fee command-center reads

- Replaced autonomous-ledger success-fee history hydration with exact account aggregates for counts, monthly totals, deadlines, and compliance status.
- Added a priority-ordered, owner-scoped action query capped at 100 fee records, with explicit queue truncation metadata.
- Kept offer-attribution action details scoped to the ledger's bounded approval/application evidence set.

## 2026-08-09 - Exact accepted-offer and memory ownership reads

- Replaced the report-hire dialog's general application-history request with an indexed, 100-item accepted-offer query that also preserves an explicitly linked accepted application.
- Removed three memory-runtime full-history ownership scans from interview and follow-up workflows in favor of exact ID reads capped at the ledger's 500-application operating set.
- Aligned the shared exact-ID helper with the combined active-window/current-job contract so valid rows are not silently omitted between memory and database runtimes.

## 2026-08-09 - Bounded success-fee operating window

- Replaced account-wide success-fee reads on Billing with stable cursor pagination while retaining exact aggregate totals, compliance counts, deadlines, and the next actionable verification record.
- Scoped Applications success-fee reads to at most 250 visible or explicitly selected application IDs and kept every query owner-bound.
- Added migration `0048` with cursor, application-scope, and actionable-deadline indexes; verified migration/schema alignment, the full automated suite, the production build, and Billing/Applications browser flows.

## 2026-08-09 - Bounded operational failure monitoring

- Extended fixed redacted failure markers into cardinality-bounded process-local counters without accepting exception objects, provider payloads, credentials, or user identifiers.
- Added an admin-only summary endpoint and a 30-second-refresh operator region that distinguishes transient process signals from durable operating-ledger evidence.
- Verified the authenticated admin page in the in-app browser at desktop and mobile breakpoints with no console errors or measured horizontal overflow.

## 2026-08-09 - Referential-integrity schema gate

- Extended the production-bundled schema audit to verify every runtime primary key and declared foreign key, including ordered columns, referenced targets, and delete/update actions.
- Restored existing production foreign-key declarations to the Drizzle runtime model so migration generation and runtime metadata describe the same relationships.
- Applied all 48 migrations to clean MySQL 8.4 and verified 42 runtime primary keys plus all 19 declared foreign keys without drift.

## 2026-08-09 - Runtime-to-migration schema audit

- Added a production-bundled audit that compares every Drizzle table and column with MySQL `information_schema` without exposing connection credentials.
- Verified all 42 runtime tables against a clean MySQL 8.4 database after the complete 48-migration history: no missing tables, missing columns, or unexpected columns.
- Extended the same gate to every named runtime index, including ordered columns and uniqueness; the clean database has no missing or structurally mismatched indexes.
- Added SQL-type and nullability comparison, which exposed and repaired the migrated employer-response enum rejecting runtime classification `no_response`; migration `0047` aligns it.
- Added an exact-schema CI gate immediately after image-owned migration so runtime/migration drift fails before health acceptance.

## 2026-08-09 - Provider-event ingestion idempotency

- Added migration `0046` for the `employer_responses.interview_id` column already required by the runtime schema; a real MySQL workflow drill exposed the missing column.
- Serialized employer-response evidence ingestion on the owning account row before checking the unique provider source reference.
- Prevented parallel inbox retries from racing through the absence check and surfacing a duplicate-key failure after partial transactional work.
- Converted standalone interview-notification creation to an atomic insert-or-return-existing operation tied to deterministic employer evidence.

## 2026-08-09 - Public social-profile integrity invariant

- Added one database-owned Facebook, X/Twitter, or legacy LinkedIn reference per candidate and platform.
- Consolidated legacy duplicates onto the oldest stable ID while applying the most recently updated active/cleared state.
- Replaced update/read/insert/read persistence with an atomic insert-or-update and one exact-ID read.

## 2026-08-09 - Interview preparation concurrency invariant

- Added a database uniqueness contract for each candidate/job preparation pair.
- Consolidated legacy duplicate preparations into the oldest stable record while retaining the newest available questions, coaching tips, and company insights.
- Replaced the lookup-then-insert write with one atomic insert-or-update statement that returns the stable preparation ID under concurrent autonomous runs.

## 2026-08-09 - Candidate profile ownership invariant

- Added a data-preserving migration that consolidates duplicate `user_profiles` rows field by field onto the oldest stable profile ID.
- Replaced the non-unique owner index with a unique owner constraint after consolidation.
- Converted runtime profile writes from read-then-insert behavior to one atomic MySQL upsert, eliminating concurrent profile-creation races.

## 2026-08-09 - AI preference workflow localization

- Localized AI preference controls, activity framing, policy/evidence headings, metrics, scheduler states and numeric outcomes, and quick actions in English and Dutch.
- Made scheduler timestamps follow the persisted locale and retained backend-generated warning, evidence, and failure details verbatim to avoid changing operational meaning.
- Added typed interpolation coverage and source-wiring regressions for the workflow.

## 2026-08-09 - Authenticated preference loading gates

- Stopped public Job Search from issuing protected profile and autonomy-plan requests for signed-out visitors.
- Prevented Settings, AI Preferences, and Job Search from saving default policy values before authoritative account preferences load.
- Changed AI Preferences to the conservative review-first default when no stored profile preference exists.

## 2026-08-09 - Concurrent preference persistence

- Added a strict `profile.updatePreferences` contract for autonomy, sourcing, and scheduler controls.
- Serialized preference patches on the account owner row and merged them against current server state in one transaction.
- Migrated Settings, AI Preferences, and Job Search away from stale client-side whole-blob replacement and added router plus wiring regressions.

## 2026-08-09 - Settings and privacy localization

- Replaced the Settings route's duplicated English-only account header with the shared localized header.
- Localized preference controls, privacy export, deletion-review status and confirmations, loading and feedback states in English and Dutch.
- Added accessible labels to the accelerated-preparation, preparation-limit, and scan-frequency controls without changing review-gated deletion behavior.

## 2026-08-09 - Team and shared-header localization

- Removed the English-only account header left visible on localized routes and wired its menu, accessibility names, fallback identity, and logout feedback to the persisted locale.
- Localized the complete Team governance workflow without changing tenant boundaries or permission behavior.
- Kept candidate-domain isolation under its existing regression test while proving the privacy explanation in both English and Dutch.
- Removed Team's nested `main` landmark after rendered browser QA exposed it inside the dashboard's existing primary landmark.

## 2026-08-09 - Workflow localization foundation

- Extended the shared typed translator with bounded dynamic-value interpolation instead of introducing page-local language state.
- Localized the complete saved-jobs, job-alerts, and not-found routes, including errors, confirmations, empty states, relative dates, form labels, placeholders, status controls, and screen-reader labels.
- Replaced an encoding-damaged visual bullet sequence in job-alert tips with semantic list markup.

## 2026-08-09 - Bounded Arbeitnow remote discovery

- Added a one-page adapter for Arbeitnow's documented no-key API after checking the live response shape.
- Rejects every record not explicitly marked remote, applies local keyword/location filters, and preserves the provider backlink required by the API terms.
- Reuses the atomic hourly source claim so concurrent workers, scheduler cycles, crashes, and restarts cannot over-poll the provider.

## 2026-08-09 - Verified Jobicy discovery

- Added a dedicated adapter for Jobicy's documented public remote-jobs API and verified the current live response shape once.
- Added safe normalization for remote geography, employment type, publication dates, links, industries, and annual salary fields.
- Enforced Jobicy's hourly polling limit across scheduler cycles and process restarts without misreporting cooldown skips as source failures.

## 2026-08-09 - Workspace governance

- Added durable workspaces, role-scoped memberships, hashed expiring invitations, ownership transfer, safe archival, bounded queries, and audited mutations.
- Added the authenticated Team screen and kept candidate-domain data outside workspace authority.
- Extended privacy policy `2026-08-09.v2` and account-erasure handling to workspace relationships.

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

## 2026-08-09 - Bounded HAI status aggregation

- Replaced HAI's full application, approval, connector, and success-fee history loads with database-side aggregate counts, keeping response cost bounded as account history grows.
- Added aggregate process runtime-health totals and latest occurrence time to HAI status while retaining individual failure labels behind the administrator-only diagnostics endpoint.
- Versioned the expanded read-only HAI Agent Card as 1.1.0 and added resource/privacy contract coverage.
- Passed focused HAI/privacy tests, TypeScript, the complete regression suite, and the production bundle check.

## 2026-08-09 - Batched inbox response deduplication

- Replaced the Gmail/Outlook response scanner's per-candidate existence queries with one deduplicated lookup over the existing user/source/reference unique index.
- Replaced full application/job hydration with an ownership-scoped four-field matching projection; resume, cover-letter, notes, salary, location, URL, platform, and timestamp data no longer enters inbox scanning memory.
- Preserved exact source-reference behavior and added direct coverage for tenant isolation, duplicate inputs, mixed recorded/new messages, and empty scans.
- Added a data-minimization contract and passed focused worker/database tests, TypeScript, the complete regression suite, and the production bundle check.

## 2026-08-09 - Exact connector account access

- Added an owner/provider lookup over the existing unique connector-account index and wired it into inbox access, follow-up delivery, cloud documents, GitHub, LinkedIn, and OAuth callbacks.
- Reused the exact lookup for OAuth initiation and inbox-candidate confirmation while retaining full account inventories for cross-provider readiness views.
- Kept list reads for cross-provider readiness and inventory workflows, where the complete account set is required.
- Added ownership, missing-provider, and wiring contracts; focused provider suites continue to pass with the exact dependency shape.
- Passed TypeScript, the complete regression suite, and the production bundle check.

## 2026-08-09 - Bounded match-ledger writes

- Replaced profile refresh's per-job match upserts with atomic ten-row batches over the existing user/job unique key.
- Retained individual retry after a batch failure, preserving per-job partial-success counts and the non-blocking profile-update contract.
- Added a 25-job `10 + 10 + 5` workload and static batch/fallback contract coverage.
- Passed TypeScript, the complete regression suite, and the production bundle check.

## 2026-08-09 - Scoped Job Search decisions

- Replaced Job Search's unbounded decision-history request with an owner-scoped lookup for its current, at-most-250 job result set.
- Kept full decision history in privacy export only and added requested/unrequested/cross-user behavior coverage plus a frontend/backend wiring contract.
- Verified the live Job Search route at desktop and mobile breakpoints: seeded jobs rendered, search narrowed the result set correctly, fail-closed evidence gates remained visible, and no browser warnings or errors were reported.

## 2026-08-09 - Scoped Applications approvals

- Replaced the Applications page's complete approval-history request with an owner-scoped query for its current, at-most-250 application window and a hard 2,000-row response ceiling.
- Preserved every approval state needed by pipeline, submission, follow-up, and legacy application controls while excluding unrequested and cross-user records.
- Added database/API behavior coverage and a frontend/backend wiring contract. Desktop/mobile browser QA, all 940 active tests, TypeScript, and the production bundle pass.

## 2026-08-09 - Bounded autonomous preview planning

- Replaced the preview route's complete application, decision, and approval history reads with the same bounded operating primitives used by autonomous scheduling.
- Preserved exact current-job history, user-decision locks, database-counted daily limits, profile evidence, connector gates, and follow-up readiness while exposing truncation through `operatingScope`.
- Added a 251-application scale regression, cross-user decision isolation, and a route/service wiring contract.
- Verified the live planner and preference refresh at desktop/mobile breakpoints with no overflow or browser errors; all 943 active tests, TypeScript, and the production bundle pass.

## 2026-08-14 - Shared dashboard localization pass

- Replaced the dashboard's duplicated account header with the shared localized header while preserving billing access and administrator-only navigation.
- Localized dashboard loading, onboarding, welcome context, and preparation state; shared salary, activity-target, and application-performance presenters now honor English/Dutch account locale.
- Fixed locale switching so its confirmation uses the newly selected language instead of the stale render language.
- Verified the Dutch settings and dashboard flows in the in-app browser, including mobile layout, with localized employer relationships and performance evidence, no horizontal overflow, and no console warnings or errors.
- Passed TypeScript, the production build and bundle budget, dependency audit, development doctor, and the full regression suite: 235 files / 1,181 tests passed with one database-dependent privacy integration skipped.

## 2026-08-14 - Core workflow locale presentation pass

- Wired the persisted account locale through Job Search, Applications, and Review Queue date/time presentation, including audit timestamps and timezone-stable verification deadlines.
- Reused locale-aware salary presentation for listing cards, filters, job details, and application details; localized compact listing-source and application-status labels.
- Removed the false Dashboard-current state from the Applications account header.
- Verified Dutch listing dates/salaries, application states/date ordering, review audit timestamps, and the Applications mobile width in the in-app browser with no warnings, errors, or horizontal overflow.
- Passed TypeScript, production build and bundle budget, dependency audit, development doctor, and the full regression suite with one database-dependent privacy integration skipped.

## 2026-08-14 - Profile evidence localization pass

- Localized Profile readiness evidence, consent-gated import controls, connector actions, resume upload and selection, and inbox response candidate controls in English and Dutch.
- Made work-history start and end dates honor the persisted account locale, with localized present and missing-date fallbacks, while preserving provider-supplied and backend evidence text verbatim.
- Verified the Dutch Profile flow in the in-app browser at desktop and mobile widths with no console warnings, errors, or horizontal overflow.
- Passed 235 test files / 1,183 tests with one database-dependent privacy integration skipped, plus TypeScript, production build and bundle budget, dependency audit, development doctor, and patch-integrity checks.

## 2026-08-14 - Candidate evidence editor localization pass

- Localized Profile work-experience, education, skill, and project ledgers in English and Dutch, including section summaries, empty states, add/edit dialogs, validation, confirmations, mutation feedback, and display fallbacks.
- Added accessible localized names to candidate-evidence edit/delete controls and moved the shared dialog close control from a hardcoded English label to the account locale for every dialog in the application.
- Verified the Dutch Profile evidence workflow, empty-form validation, and shared Sluiten control in the in-app browser at desktop and mobile widths with no warnings, errors, or horizontal overflow.
- Passed TypeScript, the production build and bundle budget, dependency audit, development doctor, patch-integrity checks, and the complete regression suite with one database-dependent privacy integration skipped.

## 2026-08-14 - Complete Profile setup localization pass

- Localized the remaining user-authored Profile setup across social and portfolio links, autonomous search targets, connector request/status actions, GitHub and LinkedIn review candidates, inbox response classifications, resume-version controls, file/salary validation, and mutation feedback.
- Preserved provider names, candidate evidence, connector revocation details, and backend-generated readiness explanations verbatim so localization does not rewrite audit evidence or provider-supplied content.
- Verified the Dutch social/search-target workflow, localized invalid-salary feedback, connector statuses, and responsive layout in the in-app browser at desktop and mobile widths with no warnings, errors, or horizontal overflow.
- Passed 235 test files / 1,183 tests with one database-dependent privacy integration skipped, plus TypeScript, production build and bundle budget, dependency audit, development doctor, and patch-integrity checks.

## 2026-08-14 - Billing and success-fee localization pass

- Localized the complete Billing workflow in English and Dutch: summaries, compliance actions, offer-attribution reviews, fee records, payment history, verification uploads, Stripe handoff feedback, and employment-end review controls.
- Preserved employer-provided response evidence and provider error details verbatim, while replacing the corrupted offer-letter separator and keeping Stripe cancellation fail-closed before any local closure mutation.
- Verified the Dutch Billing page, verification dialog, and employment-end evidence panel in the in-app browser with localized dates, no horizontal overflow, and no console warnings or errors.
- Passed 235 test files / 1,183 tests with one database-dependent privacy integration skipped, plus TypeScript, production build and bundle budget, dependency audit, development doctor, and patch-integrity checks.

## 2026-08-14 - Job Search interaction and resource pass

- Replaced React deferral with a cancellation-safe 250 ms server-query debounce so rapid search and filter changes no longer create avoidable catalog reads while immediate client-side filtering keeps the interface responsive.
- Replaced the render-local `JobCard` component type with a stable render path so parent state changes do not remount every visible listing, and corrected legitimate zero-percent match display.
- Separated keyboard-accessible job-detail and save actions, kept the save action visible on touch layouts, added localized accessible names, and made the detail footer responsive.
- Verified Job Search cards and the job-detail dialog in the in-app browser with no nested interactive controls, horizontal overflow, console warnings, or errors.

## 2026-08-14 - Complete Job Search localization pass

- Localized Job Search in English and Dutch across catalog filters, autonomous-plan metrics, sourcing/discovery status, match and risk summaries, operating-ledger decisions, detail evidence labels, empty states, and mutation feedback.
- Preserved employer descriptions, provider warnings, and recorded evidence text verbatim so presentation never mutates the underlying audit evidence.
- Added localization wiring regressions and updated the catalog pagination contract to assert the translated load-more control instead of literal English copy.
- Passed TypeScript, 235 test files / 1,183 tests with one database-dependent privacy integration skipped, the production build and bundle budget, dependency audit, development doctor, and patch-integrity checks.

## 2026-08-14 - Applications evidence and handoff localization pass

- Localized the Applications dialogs that record employer responses, interview outcomes and schedules, deterministic submission proof, follow-up drafts and delivery, and explicit offer acceptance or decline decisions.
- Kept user-authored summaries, employer messages, provider references, and audit-ledger evidence verbatim while localizing the surrounding instructions, classifications, validation guidance, and commands.
- Added localization wiring regressions for the evidence-critical dialogs and verified a seeded Dutch offer-decline workflow in the in-app browser with accessible names and no horizontal overflow.
- Passed TypeScript, 235 test files / 1,183 tests with one database-dependent privacy integration skipped, the production build and bundle budget, dependency audit, development doctor, and patch-integrity checks.

## 2026-08-14 - Applications pipeline localization and render pass

- Localized the Applications heading, refresh action, pipeline state/action summary, metrics, statistics, filter tabs, card fallbacks, and category empty states in English and Dutch.
- Replaced the render-local application card component type with a direct stable render path, preventing all visible cards from remounting when parent state changes.
- Added localization and stable-render regressions and verified the seeded Dutch pipeline at desktop and compact widths with no horizontal overflow.
- Passed TypeScript, 235 test files / 1,183 tests with one database-dependent privacy integration skipped, the production build and bundle budget, dependency audit, development doctor, and patch-integrity checks.

## 2026-08-14 - Applications operating-detail localization pass

- Localized ledger state, next-best-action routing, interview scheduling, and offer/success-fee controls from stable workflow identifiers without changing autonomous decision logic.
- Localized detail metrics, risk and approval boundaries, commands, interview timing labels, and success-fee currency display while retaining employer responses, audit reasons, and provider evidence verbatim.
- Updated wiring regressions to require translation-key usage and verified the seeded Dutch offer workflow in the in-app browser; the browser-enforced compact width was 780 pixels and showed no horizontal overflow.
- Passed TypeScript, 235 test files / 1,183 tests with one database-dependent privacy integration skipped, the production build and bundle budget, dependency audit, development doctor, and patch-integrity checks.

## 2026-08-14 - Applications ledger and history localization pass

- Localized the Applications ledger/history shell, bounded artifact counts, material-evidence labels, response classifications and state transitions, audit framing, follow-up states and commands, footer controls, and follow-up mutation feedback.
- Preserved cover-letter text, employer summaries, interview-preparation content, delivery confirmations and failures, provider references, and audit actor/action records verbatim as user/provider evidence.
- Updated ledger and follow-up pagination wiring contracts to require translation keys and verified the seeded Dutch offer history in the in-app browser; its enforced compact width was 780 pixels with no horizontal overflow.
- Passed TypeScript, 235 test files / 1,183 tests with one database-dependent privacy integration skipped, the production build and bundle budget, dependency audit, development doctor, and patch-integrity checks.

## 2026-08-14 - Structured material evidence and currency pass

- Refactored the client material-evidence helper to return locale-neutral resume state, cover-letter state, supported skills, raw salary bounds, and recorded salary currency instead of English presentation strings.
- Fixed salary evidence that previously rendered every profile expectation as USD with an English number format; Applications now uses the account locale and snapshot currency with legacy USD fallback only when old evidence lacks currency.
- Localized resume and cover-letter evidence, supported-skill prefixes, default honesty guidance, and known custom-answer classifications while preserving recorded claims, blockers, source names, and user/provider evidence verbatim.
- Verified the seeded Dutch prepared-application evidence panel and compact layout in the in-app browser, and passed TypeScript, 235 test files / 1,183 tests with one database-dependent privacy integration skipped, production build/budget, dependency audit, doctor, and patch-integrity checks.

## 2026-08-14 - Review Queue handoff localization pass

- Localized the Review Queue shell, count summary, approval controls and feedback, uncertain-delivery reconciliation, approved send handoffs, and manual-delivery confirmation dialog in English and Dutch.
- Preserved approval descriptions, employer messages, delivery failures, provider references, and audit events verbatim; helper-generated operating summaries remain English until their presentation strings are replaced with structured identifiers.
- Added localization wiring regressions and verified the seeded Dutch queue and delivery dialog in the in-app browser. Its enforced compact width was 780 pixels and showed no horizontal overflow.

## 2026-08-14 - Structured Review Queue control pass

- Replaced queue-level English label, headline, guidance, and command output with a stable exhaustive control identifier while preserving priority, routing, risk, approval, and external-action behavior.
- Added a typed English/Dutch presentation map in the Review Queue, so new control states cannot compile without an explicit localized presentation contract; persisted audit-note generation remains separate and unchanged.
- Added structured-output and localization wiring regressions and verified the seeded Dutch approval control at desktop and the browser-enforced 780-pixel compact width with no horizontal overflow.

## 2026-08-14 - Structured Review Queue card-action pass

- Replaced card-action labels, guidance, and commands with exhaustive structured variants covering approval, delivery, evidence, connectors, job decisions, interviews, inbox responses, employer replies, follow-ups, success fees, profile gaps, and administrative review.
- Shared the typed action-copy contract between Review Queue and Dashboard, localized known approval and decision classifications, and preserved recorded evidence and connector details as verbatim overrides.
- Added structured-output, shared-copy, evidence-preservation, and localization wiring regressions; verified seeded Dutch action cards at desktop and the browser-enforced 780-pixel compact width with no horizontal overflow.

## 2026-08-14 - Review Queue section-control localization pass

- Localized every fixed Review Queue section heading, empty state, fallback, badge, instruction, classification choice, and command across evidence, connectors, job decisions, interviews, inbox responses, employer replies, follow-ups, success fees, profile readiness, admin review, and audit history.
- Reused canonical locale keys where available, localized interview-scheduling controls from stable requirements, and retained provider messages, employer content, saved reasons, profile recommendations, and audit records verbatim.
- Added wiring and Dutch-copy regressions and verified all 16 populated Dutch sections in the in-app browser without console errors or horizontal document overflow.
- Passed TypeScript, 236 test files / 1,185 tests with one database-dependent privacy integration skipped, the production build and bundle budget, dependency audit, development doctor, and patch-integrity checks. The doctor still reports eight absent production variables, the intentionally disabled scheduler, and the disabled HAI connector as deployment configuration state.

## 2026-08-14 - Public landing localization and locale-control pass

- Localized the complete public landing workflow in English and Dutch: navigation, hero, operating model, accountability principles, workflow, FAQ, conversion actions, mission, copyright, and terms link.
- Added accessible EN/NL controls for unauthenticated and authenticated visitors in desktop and mobile navigation; the shared locale provider updates the document language and retains the browser preference.
- Kept the landing catalog in the lazy public route instead of the global application locale bundle, restoring the shared minified chunk from 587.35 kB to 577.36 kB so authenticated routes do not download landing-only prose.
- Kept review-first, no-silent-submission, provider-consent, and prototype-readiness claims under regression coverage after moving them into the locale catalog. Terms content itself remains unchanged pending approved localized legal text.
- Verified Dutch rendering and live switching to English in the in-app browser with no console errors or horizontal document overflow. The browser viewport override did not expose the requested compact width, so no new mobile-render claim is recorded for this pass.
- Passed TypeScript, 236 test files / 1,186 tests with one database-dependent privacy integration skipped, the production build and bundle budget, dependency audit, development doctor, and patch-integrity checks. The doctor still reports eight absent production variables, the intentionally disabled scheduler, and the disabled HAI connector as deployment configuration state.

## 2026-08-14 - Structured admin operating queue localization pass

- Replaced English labels and instructions in the admin operating summary and primary control helpers with stable presentation identifiers and counts while preserving priority, routing, risk, and approval-gate behavior.
- Added an admin-route-local exhaustive English/Dutch catalog for the operating queue, action states, approval boundary, eight operating metrics, ten overview cards, header controls, and access guard.
- Replaced US-English string interpolation for operating and overview revenue with locale-aware USD formatting and made metric test identifiers language independent.
- Verified the seeded Dutch administrator operating queue in the in-app browser with populated review state, document language `nl`, Dutch number formatting, and no horizontal document overflow. Remaining admin tabs and dialogs stay explicitly outside this pass.
- Passed TypeScript, 237 test files / 1,188 tests with one database-dependent privacy integration skipped, the production build and bundle budget, dependency audit, development doctor, and patch-integrity checks. The shared application chunk remained 577.36 kB because the new catalog stays in the lazy admin route; the doctor still reports eight absent production variables, the intentionally disabled scheduler, and the disabled HAI connector as deployment configuration state.

## 2026-08-14 - Structured admin discovery localization and outcome pass

- Localized the admin runtime-failure strip, primary tab navigation, complete discovery scheduler, 18 metrics, warnings, controls, schedule summary, source-health table, timestamps, and source status presentation in English and Dutch.
- Removed English labels from source-health decisions and scraper adapter metadata so the backend returns stable outcomes and adapter kinds while the lazy admin route owns presentation; source names, categories, initialization failures, and recorded run errors remain verbatim evidence.
- Replaced backend success-message rendering with structured scheduler outcomes and fixed manual runs so `failed` displays an error, `skipped` displays an informational active-run notice, and joined/completed runs display accurate success feedback.
- Added language-independent discovery metric identifiers and locale-aware date/time formatting, preserving the bounded 30-second status polling and existing concurrency/timeout controls.
- Verified the seeded Dutch discovery workflow in the in-app browser with 18 rendered metrics, Dutch adapter descriptions and controls, no English adapter prose, document language `nl`, and no horizontal document overflow.
- Passed TypeScript, 238 test files / 1,190 tests with one database-dependent privacy integration skipped, the production build and bundle budget, dependency audit, development doctor, and patch-integrity checks. The shared application chunk remained 577.36 kB and the lazy admin chunk is 96.14 kB; the doctor still reports eight absent production variables, the intentionally disabled scheduler, and the disabled HAI connector as deployment configuration state.

## 2026-08-14 - Admin financial operations localization pass

- Localized the populated success-fee, overdue-verification, pending-verification, and payment-history operator tables plus fixed review-queue controls and metadata in English and Dutch while retaining user, employer, evidence, and audit content verbatim.
- Added account-locale currency/date formatting and local presentation for stable fee, payment, priority, and verification statuses without changing the tRPC or database contracts.
- Localized fee-status, legal-escalation, admin-note, and review-resolution dialogs plus mutation feedback, rejection evidence, and auditable suspension notes.
- Verified the seeded Dutch fee row, status dialog, and payment empty state in the in-app browser with Dutch account persistence, document language `nl`, no residual fixed English financial headings, and no horizontal document overflow. The deep evidence/privacy-erasure dialog remains a separate localization boundary.
- Passed TypeScript, 239 test files / 1,192 tests with one database-dependent privacy integration skipped, the production build and bundle budget, dependency audit, development doctor, and patch-integrity checks. The shared application chunk remained 577.36 kB and the lazy admin chunk is 104.54 kB; the doctor still reports eight absent production variables, the intentionally disabled scheduler, and the disabled HAI connector as deployment configuration state.

## 2026-08-14 - Admin evidence and privacy-erasure localization pass

- Added locale-aware English/Dutch policy summaries for every admin review category while preserving recorded review descriptions, employer content, decision reasons, prepared claims, approval text, provider evidence, and audit events verbatim.
- Localized the complete linked-evidence dialog chrome, stable metadata, empty states, evidence counts, privacy inventory, retention actions, execution-plan states, cleanup confirmations, destructive finalization warnings, and mutation feedback.
- Verified the populated linked-application evidence dialog and a newly requested privacy-erasure preview in Dutch through the in-app browser with stable metadata translated, recorded evidence retained verbatim, document language `nl`, no fixed English evidence chrome, and no horizontal document overflow.
- Created only the non-destructive erasure plan during browser verification; no provider cleanup, object deletion, database erasure, or finalization action was executed. The resolved review leaves the open queue, so post-plan controls remain covered by source and privacy integration tests rather than a rendered-state claim.
- Passed TypeScript, 239 test files / 1,193 tests with one database-dependent privacy integration skipped, the production build and bundle budget, dependency audit, development doctor, and patch-integrity checks. The shared application chunk remained 577.36 kB and the lazy admin chunk is 118.69 kB; the doctor still reports eight absent production variables, the intentionally disabled scheduler, and the disabled HAI connector as deployment configuration state.

## 2026-08-14 - Production HTTP resource and cache policy pass

- Replaced the global 50 MiB JSON and form parser allowance with a 16 MiB JSON envelope matched to the bounded 10 MiB binary document contract after base64 expansion and a separate 1 MiB URL-encoded form limit.
- Added portable Node HTTP limits for header receipt, request receipt, keep-alive idling, header count, and requests per socket so slow or indefinitely reused connections cannot consume unbounded runtime resources across Windows, container, and ngrok deployment modes.
- Added one-year immutable caching for Vite fingerprinted assets while requiring app-shell and SPA-fallback revalidation, reducing repeat transfer without leaving clients on stale deployment entrypoints.
- Added real loopback HTTP regressions proving oversized requests stop before route execution and production assets emit the intended cache headers, plus typed policy tests for every configured server limit.
- Passed 245 test files / 1,210 tests with one database-dependent privacy integration skipped, TypeScript, the no-known-vulnerability dependency audit, and the production build with 85 JavaScript chunks under the 350 KiB limit and 576,147 aggregate startup JavaScript bytes under the 600 KiB limit. Exact pushed-commit CI evidence follows at publication.

## 2026-08-14 - Ngrok trusted-proxy and session-cookie pass

- Replaced direct trust of any request-supplied `X-Forwarded-Proto` header with Express's explicit loopback-only trusted-proxy policy, matching the Windows launcher model where ngrok terminates TLS in a local process.
- Prevented direct LAN/public peers from promoting arbitrary forwarded metadata into trusted HTTPS state while retaining secure-cookie behavior through a local ngrok tunnel.
- Changed HTTPS session cookies from `SameSite=None` to `SameSite=Lax`; the top-level OAuth callback remains compatible while cross-site credential exposure and CSRF surface are reduced.
- Added real HTTP and compiled trust-function regressions for loopback HTTPS forwarding and rejection of private/public network peers, plus cookie and logout coverage for secure/Lax behavior and untrusted header spoofing.
- Passed 246 test files / 1,213 tests with one database-dependent privacy integration skipped, TypeScript, the no-known-vulnerability dependency audit, and the production build with all existing browser-bundle budgets intact. Exact Windows, container, and pushed-commit CI evidence follows at publication.

## 2026-08-14 - Cookie-authenticated write-origin pass

- Added server-side same-origin enforcement for every unsafe request carrying the Hire.AI session cookie instead of relying only on browser SameSite behavior.
- Reject missing, opaque, malformed, and cross-site origins with `403` before the general parser or tRPC route executes; unauthenticated service requests remain outside the browser-session rule.
- Kept Stripe's raw-body signature route and the bounded bearer-authenticated HAI route ahead of the origin middleware so each external boundary retains its correct authentication contract.
- Compared against the effective direct/trusted-proxy protocol and request host, preserving standalone Windows and local-ngrok operation without accepting unrelated origins.
- Added real loopback HTTP regressions for unauthenticated, same-origin, missing-origin, cross-site, opaque-origin, and public HTTPS ngrok-style requests plus a route-order contract. Passed 248 test files / 1,220 tests with one database-dependent privacy integration skipped, TypeScript, the no-known-vulnerability dependency audit, and the production build with all existing browser-bundle budgets intact. Exact pushed-commit evidence follows at publication.

## 2026-08-14 - Bounded inbound API rate pass

- Added a fixed-window budget of 600 requests per trusted client per minute across non-Stripe `/api` routes, returning deterministic `RateLimit-*`, `Retry-After`, and `429` responses.
- Kept signed Stripe webhook delivery ahead of the limiter and health checks outside `/api`, preserving provider retry and deployment-probe behavior while bounding tRPC, OAuth, connector, and HAI traffic.
- Implemented a timer-free, database-free state store capped at 10,000 clients with periodic expired-window pruning and constant-time oldest-entry eviction at capacity.
- Reused Express's loopback-scoped trusted client identity so separate ngrok callers receive separate budgets without accepting spoofed forwarded addresses from direct network peers.
- Added real HTTP coverage for limit exhaustion, reset, standard response guidance, proxy identity separation, health exemption, invalid startup policy, and memory-cap eviction plus route-order protection. Passed 249 test files / 1,225 tests with one database-dependent privacy integration skipped, TypeScript, the no-known-vulnerability dependency audit, and the production build with all existing browser-bundle budgets intact. Exact pushed-commit evidence follows at publication.

## 2026-08-15 - Session authentication write-elimination pass

- Removed the unconditional user upsert from successful session authentication, eliminating one database write from every authenticated tRPC/API request and browser refresh.
- Preserved the ownership/account lookup on every request so role, suspension, locale, terms acceptance, and user deletion remain immediately visible rather than introducing stale authorization caches.
- Kept `lastSignedIn` updates at the semantically correct boundaries: successful OAuth callback and first-user synchronization from the configured identity provider.
- Added a real signed-session regression that authenticates the same persisted user twice and proves the historical sign-in timestamp is unchanged, plus a wiring contract for both legitimate sign-in update paths.
- Red/green verification proved the activity regression fails against the previous per-request upsert and passes after removal. The full gate passed 1,227 tests with one intentional skip, reported no known dependency vulnerabilities, passed TypeScript and the production bundle budget, and produced no patch-integrity errors.
- In-app browser verification used the local development sign-in route, reached the authenticated dashboard with the seeded operating ledger, and found no browser warnings or errors. Exact pushed-commit CI evidence follows at publication.

## 2026-08-15 - Authentication dependency failure classification

- Replaced the tRPC context's blanket authentication catch with an explicit expected-authentication boundary: only deliberate 4xx `HttpError` results become anonymous contexts.
- Split first-user identity lookup from local persistence. Provider `401/403` remains an invalid-session result, provider/network failure becomes a fixed `503`, and database exceptions propagate to the operational error path.
- Added red/green behavioral coverage through both a direct context dependency failure and a real signed session with a simulated provider outage.
- Red/green verification reproduced both broad exception swallowing and provider-outage misclassification. The full gate passed 1,230 tests with one intentional skip, reported no known dependency vulnerabilities, passed TypeScript and production bundle budgets, and produced no patch-integrity errors.
- In-app browser verification used the local development sign-in route, reached the authenticated dashboard and operating data, and found no browser warnings or errors. Windows/HAI, container, and exact pushed-commit CI evidence follow at publication.

## 2026-08-15 - Session application-binding pass

- Confirmed that session signatures and payload shape were verified while the signed `appId` claim was not compared with the configured Hire.AI application.
- Added an exact application-binding check before user lookup, local development restoration, or provider synchronization; foreign-application cookies now follow the non-disclosing invalid-session path.
- Added red/green coverage proving the previous cross-application acceptance and preserving valid same-application sessions.
- Red/green verification proved that the old verifier accepted a correctly signed foreign-application token and that the bound verifier rejects it while retaining valid Hire.AI sessions. The full gate passed 1,232 tests with one intentional skip, reported no known dependency vulnerabilities, passed TypeScript and production bundle budgets, and produced no patch-integrity errors.
- In-app browser verification used the application-bound local development session, reached the authenticated dashboard and operating data, and found no browser warnings or errors. Windows/HAI, container, and exact pushed-commit CI evidence follow at publication.

## 2026-08-15 - Durable session-revocation pass

- Reproduced that logout cleared only the browser cookie and left a copied signed token usable for the remainder of its lifetime.
- Added a persisted per-user session generation, embedded it in signed cookies, and required an exact current-generation match during every authenticated request.
- Made logout atomically advance the generation before returning success while still clearing the local cookie if persistence fails. This invalidates every pre-logout copy without adding writes to normal authenticated traffic.
- Added red/green behavioral coverage proving copied-token rejection and successful replacement-session issuance. The full local gate passed 254 test files and 1,233 tests with one intentional database-dependent skip, reported no known dependency vulnerabilities, passed TypeScript and production bundle budgets, and produced no patch-integrity errors.
- In-app browser verification completed local sign-in, reached the authenticated command center and operating ledger, and found no browser warnings or errors. Container migration/schema and exact pushed-commit CI evidence follow at publication.

## 2026-08-15 - Bounded session-lifetime pass

- Reproduced that production OAuth cookies and the SDK default remained valid for one year and were not controlled by a validated deployment policy.
- Added one `SESSION_TTL_MS` absolute lifetime for OAuth JWT and cookie expiry, defaulting to seven days and constrained to 15 minutes through 30 days; explicit six-hour local QA sessions remain unchanged.
- Added fail-closed production startup and doctor validation for malformed, fractional, and out-of-range overrides.
- Added red/green behavioral coverage for OAuth JWT/cookie alignment, SDK default expiry, strict parsing, and standalone production diagnostics. The full local gate passed 256 test files and 1,242 tests with one intentional database-dependent skip, reported no known dependency vulnerabilities, passed TypeScript, the application doctor, production bundle budgets, and patch-integrity checks.
- In-app browser verification completed the explicit six-hour local QA sign-in, reached the authenticated command center and operating ledger, and found no browser warnings or errors. Windows/container and exact pushed-commit CI evidence follow at publication.

## 2026-08-15 - Active-account authorization pass

- Reproduced that shared protected/admin middleware checked identity and role but ignored the database-backed account state, leaving suspended users authorized outside selected job-search mutations.
- Added one fail-closed active-account invariant before every protected and admin route, while retaining public account-state and logout access for restriction handling.
- Added a localized EN/NL routed-shell gate that prevents operational pages and queries from mounting for suspended, pending, or unknown authenticated states, plus a self-suspension guard that prevents an administrator from locking out their own session.
- Browser logout exposed and closed an Express deprecation warning caused by passing `maxAge` to `clearCookie`; logout now retains only the matching cookie path/security attributes.
- Added red/green authorization, real auth-route, UI-state, and admin self-lockout regressions. The full local gate passed 258 test files and 1,252 tests with one intentional database-dependent skip, reported no known dependency vulnerabilities, passed TypeScript and production bundle budgets, and produced no patch-integrity errors.
- In-app browser verification used the development-only suspended-account fixture, rendered only the restriction status and logout control, returned to the public landing page after logout without the prior Express warning, then signed in an active account and reached the command center with no browser warnings or errors. Windows/container and exact pushed-commit CI evidence follow at publication.

## 2026-08-15 - Session signing-secret policy pass

- Reproduced that production startup and diagnostics accepted any non-empty `JWT_SECRET`, including short values and the checked-in example placeholder.
- Added one shared runtime policy requiring 32-4096 characters while rejecting surrounding whitespace, control characters, and known placeholders; local development retains its explicit fallback.
- Wired the same fail-closed contract into the production doctor without printing the configured secret, updated CI credentials, and documented generation, rotation, and forced reauthentication behavior.
- Added red/green helper and standalone-doctor coverage. The focused gate passed 5 test files and 37 tests; the full local gate passed 259 test files and 1,266 tests with one intentional database-dependent skip, TypeScript, the no-known-vulnerability dependency audit, the production doctor, production bundle budgets, and patch-integrity checks.
- In-app browser verification completed local sign-in, reached the authenticated command center and operating ledger, and found no browser warnings or errors. Windows/container and exact pushed-commit CI evidence follow at publication.

## 2026-08-15 - Primary OAuth initiation integrity pass

- Reproduced that hosted sign-in used browser-generated base64 callback data as OAuth `state`, accepted it without initiating-browser proof, and returned a dead `#` link when the production image was built without `VITE_OAUTH_PORTAL_URL`.
- Replaced direct browser-to-provider construction with same-origin `/api/oauth/login`, runtime `OAUTH_PORTAL_URL`, an HTTPS/loopback callback policy, and HMAC-signed ten-minute state bound to an HttpOnly browser nonce.
- The callback clears the state nonce and rejects unsigned, tampered, cross-browser, expired, future, malformed, and unsafe-callback state before token exchange. The legacy `VITE_OAUTH_PORTAL_URL` server alias remains for migration, but production JavaScript no longer depends on a baked portal value.
- Added red/green state, route, frontend production-bundle, session-lifetime, and production-doctor coverage. The full local gate passed 262 test files and 1,283 tests with one intentional database-dependent skip, TypeScript, the no-known-vulnerability dependency audit, the production doctor, production bundle budgets, and patch-integrity checks.
- Live HTTP verification returned a `302` with a 600-second HttpOnly SameSite=Lax callback nonce and opaque signed state, then rejected an unsigned callback with `400` before provider exchange. In-app browser verification entered through unified `/api/oauth/login`, completed the non-production server fallback, and reached the authenticated command center and operating ledger with no browser warnings or errors. Windows/container and exact pushed-commit CI evidence follow at publication.

## 2026-08-15 - Connector OAuth deployment-policy pass

- Reproduced that connector setup accepted weak state secrets, permissive base64 token keys, callback URLs with unsafe components or the wrong path, and partial provider credential pairs without a deployment error.
- Added one fail-closed policy for Gmail, Google Drive, Dropbox, Outlook, LinkedIn, and GitHub. A completely absent configuration is intentionally disabled; any configured value requires all shared controls and at least one complete provider credential pair.
- Reused strict callback, credential, state-signing, and encryption-key validation in runtime availability, state verification, token encryption, production startup, and secret-safe operator diagnostics.
- Added red/green policy, runtime, standalone production-doctor, and full-runtime environment coverage. The first exact CI run exposed and reproduced an unrelated-field activation bug at container startup; the narrowed policy now inspects only connector fields. The final full local gate passed 264 test files and 1,299 tests with one intentional database-dependent skip, TypeScript, the no-known-vulnerability dependency audit, the application doctor, production bundle budgets, and patch-integrity checks.
- Live provider authorization remains an operator acceptance gate because no provider credentials or authorized sandbox accounts are configured in this checkout. Windows/container and exact pushed-commit CI evidence follow at publication.

## 2026-08-15 - Employer handoff classification integrity pass

- Reproduced three divergent ATS classifiers and false recognition from arbitrary path/query substrings, malformed text, JavaScript URLs, and lookalike hostnames.
- Replaced them with one credential-free HTTP(S), hostname-bound classifier shared by the public support API, autonomous planner, disabled browser handoff, and legacy compatibility boundary.
- Aligned Greenhouse, Lever, Workday, Taleo, iCIMS, SmartRecruiters, BambooHR, and Jobvite reporting while retaining the strict manual/review-only submission boundary.
- Red/green cross-module and adversarial coverage now proves every caller returns the same classification. The full local gate passed 265 test files and 1,313 tests with one intentional database-dependent skip, TypeScript, the no-known-vulnerability dependency audit, the application doctor, production bundle budgets, and patch-integrity checks.

## 2026-08-15 - HAI deployment-identity policy pass

- Reproduced production acceptance of the documented placeholder bearer token, whitespace-bearing tokens that could never authenticate, `parseInt` acceptance of suffixed user IDs, and advertised endpoint paths that the fixed HAI route does not serve.
- Added bounded non-placeholder token validation, canonical positive safe-integer user IDs, and exact local/private `/api/hai/a2a` endpoint enforcement without trimming unsafe input into validity.
- Wired the same effective policy into fail-closed production startup and secret-safe `pnpm doctor` diagnostics; corrected token-generation guidance and the application parser budget documentation.
- Red/green runtime, HTTP-route, aggregate-resource, and standalone production-doctor coverage passes. The full local gate passed 266 test files and 1,319 tests with one intentional database-dependent skip, TypeScript, the no-known-vulnerability dependency audit, the application doctor, production bundle budgets, and patch-integrity checks.

## 2026-08-15 - Ngrok runtime-identity binding pass

- Reproduced that the tunnel launcher accepted any public `/readyz` response containing `ready: true`, without proving the reserved hostname reached the local Hire.AI process it had just checked.
- Added a 192-bit opaque per-process readiness identity and required an exact local/public match before the Windows ngrok launcher reports success. Invalid local identity and public mismatch fail closed with distinct guidance.
- Red/green identity and PowerShell wiring tests pass, both launchers parse natively, and a live development runtime returned a correctly shaped instance ID from `/readyz` on port 3045.
- The full local gate passed 267 test files and 1,320 tests with one intentional database-dependent skip, TypeScript, the no-known-vulnerability dependency audit, the application doctor, production bundle budgets, and patch-integrity checks.

## 2026-08-15 - Readiness probe ownership pass

- Reproduced that each readiness timeout cleared the coalescing guard even while its database call remained unresolved; five post-cache polls produced five additional concurrent probes.
- Separated the bounded caller result from ownership of the underlying operation. Readiness still responds within its deadline, but no new database probe starts until the active one settles, and a late success restores the cache immediately.
- Red/green fake-time coverage proves repeated timeout polling retains exactly one database operation while preserving normal success caching, concurrent coalescing, failure retry, and bounded latency.
- The full local gate passed 267 test files and 1,321 tests with one intentional database-dependent skip, TypeScript, the no-known-vulnerability dependency audit, the application doctor, production bundle budgets, and patch-integrity checks.
