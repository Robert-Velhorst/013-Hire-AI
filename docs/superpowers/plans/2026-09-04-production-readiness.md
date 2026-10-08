# Hire.AI Production Readiness Implementation Plan

**Goal:** Deliver a verified production service that handles the candidate journey through interview scheduling and preparation; the candidate conducts the interview.

**Architecture:** Preserve React/Vite, Express/tRPC, MySQL/Drizzle, existing provider adapters, ownership boundaries, and audited automation. Distinguish technical startup, local acceptance, live provider acceptance, and full product completion. Do not equate a healthy process with a working autonomous application service.

**Context:** Existing source-intelligence changes are local and must be preserved. Robert confirmed online multi-user hosting and selected Hetzner. On 2026-09-05 he authorized buying the discussed CPX12 plan. Authenticated Console purchase and server start were verified: Falkenstein, Ubuntu 24.04, IPv4/IPv6, EUR 14.51/month including 21% VAT. At his request the resource was renamed from `tools-01` to `013-hire-ai`; the OS hostname still awaits login. An admin-source-only SSH firewall is applied and bounded port checks passed. See the hosting guide for evidence. Robert declined paid backups and deferred backup work: do not let this delay installation preparation or purchase another backup service. Domain, secure OS administration and application/provider acceptance remain open, and recovery acceptance is unverified. Do not infer credentials or assume the smallest package supports the complete workload.

## Host Preparation Update (2026-09-05)

After Robert reset the password, browser-console and SSH root login succeeded. The OS hostname is now verified as `013-hire-ai`. Docker Engine 29.8.0 and Compose 5.5.1 were installed, the Docker smoke test passed, and 46 Ubuntu packages were upgraded. The `linux-image-virtual` update is held back and kernel/reboot acceptance remains open. The firewall remains admin-only and paid backups remain disabled. These observations supersede the earlier context's pending OS login; they do not close the remaining application, identity, database, domain or recovery gates.

## Current Execution

The local image export remained stalled, so the current build sources were transferred with checksum verification and built successfully on Hetzner. The private MySQL database, all 75 migrations and the schema audit passed. Kernel `6.8.0-139-generic` is now running after a reboot; Docker and database health returned automatically, and the post-reboot schema audit passed. The production doctor/default entry command correctly reject missing provider and scanner settings. See [Hetzner Hosting](../../HETZNER_HOSTING.md#verified-private-installation) for artifact identity and remaining gates. This supersedes the earlier host preparation snapshot; no public application or real provider acceptance is complete.

- [x] Transfer the build sources, verify their checksum and build the image on the authorized host.
- [x] Configure a private persistent database, generated local secrets, explicit migrations and schema validation.
- [x] Verify idempotent secret initialization, network isolation and application startup rejection for incomplete configuration.
- [x] Complete the kernel update and verify database/schema health after a real host reboot.

- [x] Inspect current code, configuration, deployment, dependency audit, and operator gates.
- [x] Remediate six dependency advisories using compatible patched versions; clean audit and frozen install confirmed.
- [x] Reuse the runtime schema audit inside production startup, before catalog writes/listener/workers. Add failing-first tests and bounded cleanup.
- [x] Exercise migrations, schema agreement, source persistence and duplicate comparisons on isolated MySQL. Add repeatable database acceptance to CI. Schema rejection is covered by focused tests; the additional host production-start command was blocked by execution policy and remains unverified end to end.
- [x] Re-run types, tests, production build, image checks and document actual results: 1,357 regular tests and five separately enabled database tests passed, as did type checking and local/container builds. Production process startup remains unverified as noted above.

## Remaining Product And Deployment Acceptance

- [ ] Provision the selected host, domain/TLS, monitoring, secret injection, database and tested off-host backup/restore. No production credentials are configured here.
- [ ] Verify actual sign-in through the configured identity service, encrypted private document storage and scanner, account authorization, retention/deletion, and recovery using approved test accounts.
- [ ] Configure and validate Gmail/Google Drive, Microsoft, Dropbox and other authorized providers with real callbacks, revocation and failure recovery. Never invent credentials or provider acceptance.
- [ ] Implement and validate authorized employer submission, durable retry/idempotency, follow-up, inbox evidence, scheduling and preparation end to end. Existing employer submission is explicitly disabled; this remains a product blocker, not a completed control.
- [ ] Expand source access and durable ingestion coverage; 90 registered platforms / 9 policy-enabled adapters is not worldwide completeness.
- [ ] Complete representative multi-user/load, privacy/security and operator acceptance before deployment or production-ready claims.

## Verification Contracts

- Preserve existing uncommitted source work and generated local artifacts.
- Tests and drills use a new dedicated local MySQL container/database, never other projects' databases.
- A missing or incompatible schema must prevent production initialization, including direct `node dist/index.js` startup.
- No credentials or provider response bodies in diagnostic output; no synthetic submission evidence in production.
- No automatic database repair or destructive migrations on startup. Operators run reviewed migrations explicitly.
- Deployment and credential-dependent requirements stay open until real evidence exists.
