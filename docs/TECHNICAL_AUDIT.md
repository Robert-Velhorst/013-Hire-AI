# Technical Audit

Audit date: 2026-08-08

## Runtime and boundaries

- Frontend: React, Vite, Tailwind, shadcn components.
- API: Express and tRPC. Protected procedures require a session; admin procedures require the `admin` role.
- Persistence: Drizzle/MySQL with an intentionally explicit in-memory development fallback.
- Jobs: policy-driven public discovery sources only. Account-gated and unsupported sources remain unavailable until an approved adapter exists.
- External effects: Hire.AI prepares, reviews, and records employer handoffs. It does not claim an employer submission, email delivery, provider connection, or interview without recorded evidence.

## Audit findings closed in this change

| Finding | Resolution |
| --- | --- |
| Settings exported only browser-loaded profile and application data while claiming all data. | `privacy.exportData` now builds an authenticated server-side export and records an audit event. Private document bytes, storage keys, OAuth grants, and credentials are excluded. |
| No operational HTTP probes. | `/healthz` and `/readyz` now return bounded JSON status; readiness identifies development-memory persistence rather than presenting it as a database. |
| No baseline HTTP response hardening. | The server disables `X-Powered-By` and applies anti-framing, MIME, referrer, permissions, cross-origin, production CSP, and HSTS headers. |
| No local self-diagnostic command. | `pnpm doctor` checks runtime files, migration inventory, production-required configuration, and the malware-scanner gate without printing values. |
| No container build definition. | `Dockerfile` and `.dockerignore` provide a production Node 22 build path. |
| Production HTML embedded the Manus development runtime and a second React runtime. | Manus and JSX-location plugins now run only for the Vite development server. The production shell fell from 367,750 bytes to 487 bytes, and the build fails if development markers return or the shell exceeds 25 KiB. |
| Dashboard opened seven overlapping API queries and its ledger GET wrote campaign state. | Dashboard data now comes from one bounded operating snapshot, recent applications are projected and capped at 10, non-admin requests skip the global admin-review read, and the protected GET does not persist campaign state. |
| The embedded Vite server lost its root/plugins after production config became command-aware. | CLI and embedded startup now share `createViteConfig`; tests cover build/serve plugin boundaries and a live check verified `/src/main.tsx` is served as JavaScript. |
| Hot operating queries lacked matching compound indexes, several single-record workflows scanned full tables, and offer reviews queried responses once per approval. | Migration `0036` adds 17 query-aligned indexes. Privacy deletion, admin evidence, and duplicate-source aggregation now use bounded indexed lookups; offer-attribution evidence is loaded in one ownership-scoped batch. A regression test keeps migration and schema declarations aligned. |
| Operating-ledger queues independently reloaded responses, interview schedules, and follow-ups for each application. | The ledger now performs three ownership-scoped batch reads and groups their results once. Scheduling, outcomes, notifications, reply actions, and follow-up suppression share the same evidence snapshot. |
| Upcoming interview preparation checked for existing material once per interview. | Upcoming interviews and user preparations are loaded once in parallel, then matched by job ID in memory. |
| Offer-attribution projection reloaded applications, approvals, and responses already present in the operating snapshot. | The projection accepts preloaded data, re-filters it by authenticated user, and reuses the ledger's evidence snapshot. Campaign and post-evidence reads also run in parallel. |
| Admin operating snapshots loaded the global review table and filtered it locally. | The snapshot now requests at most 100 open/in-progress items for the affected user through the indexed `(user_id, status)` path. The separate global admin queue remains available for administrative operations. |
| Employment-verification resolution loaded the global review table to locate one entity's active reviews. | Resolution now requests only open/in-progress review items matching the affected user, verification entity type, and verification ID. The administrative global queue remains unchanged. |
| Standalone application lifecycle and admin evidence paths loaded every approval owned by a user before filtering one application. | A shared ownership-scoped lookup now loads only approvals linked by application ID or the legacy application-entity relationship. Submission confirmation, response cleanup, withdrawal, offer acceptance, follow-up completion, and evidence rendering use it. |
| Admin evidence loaded every application and decision for the affected user to identify one reviewed record. | Reusable owned application-ID and user/job decision lookups now use primary/unique keys. Evidence loads the application with approvals in parallel, then its artifacts with the exact decision in parallel. |
| Standalone lifecycle and approval mutations repeatedly loaded complete user application or approval collections to authorize one record. | Submission confirmation, response recording, interview and follow-up ownership, withdrawal, offer acceptance, approval resolution, and offer decline now use exact `(user, id)` lookups. Collection reads remain only where the workflow actually processes a set. |
| Application create, decision, and portal-preparation routes loaded all user applications to find one existing pending job record. | Each route canonicalizes the job and queries the existing unique `(user_id, job_id)` record with pending status directly, preserving duplicate-source idempotency without a history scan. |
| Save/ignore decisions reloaded all applications and all pending approvals to close one prepared review item. | The close branch now reuses the exact pending user/job lookup and loads approvals only for that owned application before cancelling its submission gate. |
| Employer reply preparation loaded every response for an application to select one target. | Reply preparation now retrieves either the explicit owned response or the newest owned replyable response with one bounded query; cross-user targets are rejected. |
| Interview preparation verified ownership and then loaded every schedule to select one future interview. | The successful path now joins the owned application to future scheduled/rescheduled interviews, orders by start time, and returns one row. Error semantics remain explicit. |
| Autonomous follow-up safety loaded responses, schedules, and follow-up history separately for every candidate. | One run now batch-loads each ownership-scoped evidence type once, groups rows by application, and reuses them across safety and cooldown decisions. |

## Material unresolved risks

1. Production needs MySQL/TiDB, OAuth, Stripe, Forge, S3, malware scanning, and any enabled connector credentials.
2. A real browser or official API provider adapter needs separate policy, account, quota, and acceptance-test approval before activation.
3. Employment/payment retention and success-fee terms need legal and privacy review before real-user launch.
4. Docker has not been built in this workspace because Docker Desktop availability is external to the repository.
