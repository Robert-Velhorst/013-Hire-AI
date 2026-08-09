# Codex Worklog

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
