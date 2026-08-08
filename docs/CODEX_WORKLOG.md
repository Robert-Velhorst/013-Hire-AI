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
