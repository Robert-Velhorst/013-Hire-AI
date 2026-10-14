# 013 - Hire.AI

Hire.AI is an early-stage, self-hostable preview application for finding and comparing fully remote jobs and managing the candidate's application journey. It brings candidate profiles and resumes, cross-post comparisons, match review, application preparation, response tracking, and interview preparation into one auditable workflow.

The product is intended for people looking for any kind of work that can be performed fully remotely, across professions and experience levels. The aim is to reduce repetitive effort and focus on a small number of well-matched applications. The candidate conducts the interview; Hire.AI's intended assistance ends at interview preparation and the interview itself. Negotiations, offers, employment contracts, and decisions after the interview remain with the candidate.

> **Project status: preview, not a public production service.** The first pre-release and GHCR container image are published, but that does not mean a hosted service is available. Production identity, live provider accounts, public HTTPS deployment, legal/privacy acceptance, and end-to-end employer-portal submission are not complete. The application workflow now supports sending an application to a verified employer-published email address only after recorded approval, a fresh consent confirmation, and a final review of the exact recipient and message. This limited path is not evidence of live provider acceptance or production readiness.

**Quick links:** [first preview release](https://github.com/Robert-Velhorst/013-Hire-AI/releases/tag/v0.1.0-alpha.1) · [container package](https://github.com/users/Robert-Velhorst/packages/container/package/013-hire-ai) · [security reporting](https://github.com/Robert-Velhorst/013-Hire-AI/security/advisories/new) · [production acceptance checklist](docs/PRODUCTION_ACCEPTANCE.md)

## At A Glance

- **For job seekers:** one place for a profile, resume versions, remote job listings, match explanations, saved jobs, application records, employer responses, and interview preparation.
- **For developers:** a TypeScript monorepo with a React web client, Express/tRPC API, Drizzle/MySQL data layer, scraper adapters, Docker packaging, and Windows launch tooling.
- **For operators:** migration, health, backup/restore, schema-audit, privacy, and deployment documentation, plus CI for Linux, Windows, MySQL, and container paths.
- **Current authority boundary:** review-first. Hire.AI can send an approved application by email only after the candidate reviews and explicitly confirms the exact destination and message. Employer and applicant-tracking-system forms remain a user handoff; browser automation is disabled.
- **Source coverage:** a catalog of 90 job sources and nine policy-enabled API/RSS discovery sources. These counts do not mean every source is live, legally approved, or globally comprehensive. “All remote jobs worldwide” is the long-term ambition, not current coverage.
- **Hosting direction:** online, multi-user deployment at Hetzner. A GitHub release or container image does not mean the hosted service is live or production-ready.

## Product Direction And Current Boundaries

The approved direction is recorded in [docs/PRODUCT_DIRECTION.md](docs/PRODUCT_DIRECTION.md). It is a product specification, not proof that every requirement is implemented.

### Available foundations in this repository

- User accounts, signed sessions, terms acceptance, account status, and session revocation.
- Candidate profiles with experience, education, skills, projects, preferences, social references, and versioned resumes.
- Job catalog, filters, saved jobs, source records, freshness indicators, match explanations, and duplicate relationships.
- Application ledger, decisions, prepared materials, review/handoff records, employer-response records, interview scheduling/preparation, and follow-up tracking.
- Opt-in, review-first automation with source limits, evidence gates, audit records, and operational health tracking.
- English and Dutch localization across major user workflows.
- Admin tools for reviews, operating queues, source health, account controls, and privacy operations.
- Privacy export and deletion-review/erasure foundations, plus workspace membership governance that does not expose candidate records to other members.
- Optional integrations and deployment adapters whose actual availability depends on credentials, consent, provider approval, and live acceptance.

### Not currently delivered as an end-to-end service

- Automatic submission into employer or applicant-tracking-system forms. Browser automation scaffolding is disabled; those applications still require a user handoff. The separate email-delivery path is gated by an approved application, current listing and candidate evidence, a verified employer-published address, and explicit final confirmation.
- Complete coverage of all job boards or permission to scrape every public website. Catalog entries may be manual, unavailable, account-mediated, or awaiting provider approval.
- Live or accepted production use of all OAuth, email, document-storage, payment, malware-scanning, or AI providers.
- A guarantee of a job, interview, uninterrupted employment, or fully correct classification of every listing.
- A legally approved or active fee/credit product. The repository includes legacy billing code that must not be mistaken for the approved commercial direction.

The intended autonomous journey may discover, qualify, prepare and, after explicit provider-specific authorization and acceptance, submit applications; communicate and follow up; arrange and prepare interviews; and stop at the interview boundary. Any external action must be consent-bounded, traceable, reversible where possible, and truthful about uncertain outcomes. A provider timeout or ambiguous send must never be reported as success or blindly retried. The interview itself is conducted by the candidate; Hire.AI's authority ends there.

## Job Sources And Deduplication

The current code policy enables unattended discovery from these nine API/RSS sources:

| Source           | Collection method / important limit                                         |
| ---------------- | --------------------------------------------------------------------------- |
| RemoteOK         | Public job API; preserves source attribution and listing details.           |
| Remotive         | Public remote-job API.                                                      |
| Jobicy           | Public documented API with bounded polling.                                 |
| Arbeitnow        | Public API; accepts records explicitly marked remote.                       |
| Arbeitnow UK     | Bounded UK API page; requires explicit remote status and provider backlink. |
| Himalayas        | Public cursor API with page, record, and cycle limits.                      |
| We Work Remotely | Public RSS category feeds.                                                  |
| NoDesk           | Public RSS feed.                                                            |
| ProBlogger       | Public RSS feed.                                                            |

The source catalog currently represents 90 platforms for provenance and possible expansion. It includes regional/local sources and platforms such as LinkedIn Jobs, Wellfound, Glassdoor, and freelance marketplaces, but inclusion is not permission to scrape or evidence of a working adapter. Working Nomads is specifically excluded from automatic ingestion pending written authorization. The scheduler is disabled by default. Operators must review provider terms, rate limits, attribution, robots/API guidance, and regional privacy obligations before enabling a source.

Listings are normalized into a shared schema. Source identifiers refresh known records; title/company/location and other available evidence can link likely cross-posts. Duplicates remain traceable to their source records rather than being treated as perfectly identical. Missing and conflicting salary, location, contract, or other material fields must remain distinguishable. Reposting does not itself authorize a second application. See [docs/SOURCE_INTELLIGENCE.md](docs/SOURCE_INTELLIGENCE.md) and `server/scrapers/platformCatalog.ts` for source policy and limits.

The `/sources` area provides directory and recorded-collection views, filters for source metadata, and comparisons of linked records. Without a connected database, any sample values are identified as examples. A successful unit test or enabled source policy does not prove that a live provider scan has succeeded.

The job-search model supports filters for keywords, company, location, job type, platform, salary bounds and currency, remote-only eligibility, experience level, application method, visa support, open-hiring support, diversity-friendly signals, disclosed salary, listing age, and safety status. The exact available options depend on source data; missing or contradictory listing fields are not proof that a job meets a preference.

## User Journey

1. **Create a profile.** Add work history, education, skills, preferences, and a resume. Optional imports require configured integrations and user authorization.
2. **Discover and compare jobs.** Search configured sources, apply available filters, inspect source/freshness information, and see match evidence and linked duplicates.
3. **Review a possible application.** Hire.AI checks profile readiness, job freshness, duplicate history, and safety conditions. Missing decisive vacancy information should be resolved before an application proceeds.
4. **Prepare materials.** The application can maintain drafts and review records. Today the candidate completes the employer-side form and records reliable submission evidence.
5. **Track responses and prepare for interviews.** Connected inbox capabilities may surface response candidates when configured. Interview invitations must be backed by recorded evidence. The candidate attends the interview and decides everything afterwards.
6. **Pause or restart.** Automation is intended to stop when employment is reported. Restart requires a reason and updated criteria; misuse controls and human review are part of the product direction.

Exact behavior and operating limits are documented in the product-direction and user-guide documents. External integrations may be unavailable in a local development environment.

## Commercial Direction (Not An Active Offer)

Robert's current target is a success-based contribution, potentially 1% of gross monthly salary received from an attributable placement from both the employer and the worker while that employment lasts. A separate prepaid option is intended to use attributable computing costs multiplied by 2.5, with credits that do not expire. The intended operating ceiling is EUR 100 per month, without automatic purchases or debt. An internal assistance fund is proposed for users who cannot afford prepaid credits.

These are proposals requiring jurisdiction-specific legal, tax, consumer-protection, privacy, and contract review. They are not an advertised price, a universally available payment model, or an active entitlement. The code currently contains legacy 5% assumptions and Stripe subscription/fee flows. Do not enable charging or treat those flows as implementing the approved direction without a separate migration, review, and acceptance.

## Architecture

```text
React + Vite browser client
        | tRPC / HTTP
Express + Node.js 22 API
        |-- authentication, account and authorization gates
        |-- job search, matching, application and interview workflows
        |-- source adapters, scheduler, deduplication and health records
        |-- consent-scoped OAuth connector routes and token policy
        |-- audit, admin, billing and privacy workflows
        |-- optional read-only HAI status and remote-job discovery endpoint
        | Drizzle ORM
MySQL / TiDB
        | private document object storage (deployment integration)
```

| Area        | Technology                                                                                    |
| ----------- | --------------------------------------------------------------------------------------------- |
| Web client  | React 19, Vite, TypeScript, Tailwind CSS, Radix/shadcn UI, TanStack Query, Wouter             |
| API         | Node.js 22, Express 4, tRPC 11, TypeScript ESM                                                |
| Persistence | MySQL/TiDB, Drizzle ORM, ordered SQL migrations                                               |
| Identity    | Hosted Manus-compatible OAuth-style identity with signed, HttpOnly sessions                   |
| Documents   | Private S3-compatible storage integration, PDF/DOCX parsing and upload validation             |
| Payments    | Stripe integration code and webhook ledger; not enabled as the approved live commercial model |
| Tests       | Vitest, TypeScript checks, isolated MySQL acceptance, Windows and container CI                |
| Delivery    | GitHub Actions, Docker image, Hetzner deployment templates, Windows PowerShell scripts        |

### Integration support

| Service               | Codebase capability                               | What is still needed for live use                                                          |
| --------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Gmail                 | OAuth policy and bounded inbox-response discovery | Google app, approved scopes/callback, consent, real-account acceptance.                    |
| Google Drive          | Consent-scoped resume candidate discovery         | Google app/scopes, private-storage decision, real-account acceptance.                      |
| Dropbox               | Consent-scoped document candidate discovery       | Dropbox app/scopes and real-account acceptance.                                            |
| Outlook / Microsoft   | OAuth policy and cleanup guidance                 | Microsoft app/scopes plus tested read, revoke, and cleanup flows.                          |
| LinkedIn              | Profile reference/OAuth policy                    | Approved integration; no unattended LinkedIn job scraping is claimed.                      |
| GitHub                | Profile evidence connector policy                 | OAuth app, scopes, and account acceptance.                                                 |
| Stripe                | Legacy checkout/webhook code and payment ledger   | Separate legal/commercial approval and live test; not the approved pricing implementation. |
| S3-compatible storage | Private document storage integration              | Bucket, access policy, retention plan, recovery test, and malware scanner.                 |
| AI provider           | Server-side adapter boundary                      | Provider credentials, data-processing review, budget limits, and live acceptance.          |

No integration is live merely because its code or environment-variable names exist. Credentials should only be supplied through a managed secret store and after user consent and provider approval.

## Repository Map

```text
client/                 React pages, shared UI, client workflow helpers
server/                 Express/tRPC API, auth, domain workflows and tests
server/scrapers/        source catalog, policy, adapters and scheduler
shared/                 client/server contracts and shared policies
drizzle/                schema, relations, ordered database migrations
scripts/                doctor, build checks, migrations, audits, backups, Windows tools
deploy/hetzner/         private deployment templates and operator instructions
docs/                   product, API, security, operations and acceptance documents
.github/workflows/      CI and release image workflows
Dockerfile              multi-stage production container build
```

## Local Development

### Requirements

- Node.js 22 or newer.
- pnpm 11.16.0 (the version declared by this repository).
- MySQL 8.4 or compatible TiDB for persistent features. Some limited development paths can start without a database; configured database failures must not silently switch to sample data.
- Optional provider accounts and credentials only for the integration being developed. Never put secrets in source control or chat.

### Install and start

```powershell
git clone https://github.com/Robert-Velhorst/013-Hire-AI.git
cd 013-Hire-AI
corepack enable
corepack prepare pnpm@11.16.0 --activate
pnpm install --frozen-lockfile
Copy-Item .env.example .env
```

Set at least the local database connection in `.env` when using persistent workflows, then apply committed migrations and start the development server:

```powershell
$env:DATABASE_URL = "mysql://user:password@localhost:3306/hire_ai"
pnpm db:migrate
pnpm dev
```

The development server defaults to `http://localhost:3000`. Local seeded QA sign-in is disabled by default; set `DEV_QA_AUTH_ENABLED=true` only for isolated local testing on a loopback-only bind. Its session routes accept same-origin `POST` requests from direct loopback peers and are not available through forwarded/tunnel traffic or production mode. Configuration requirements vary by feature. `pnpm run doctor` reports configuration issues; production mode deliberately rejects placeholders, unsafe partial OAuth settings, invalid schemas, and missing required security integrations. Review `.env.example` and `docs/OPERATOR_RUNBOOK.md`; do not copy real credentials into examples or logs.

### Production build

```powershell
pnpm check
pnpm test
pnpm run doctor
pnpm security:audit
pnpm build
pnpm start
```

`pnpm build` builds the web client, enforces the startup bundle budget, and bundles the server and database audit tools. A successful local build is not deployment acceptance.

## Configuration Reference

The complete current example is `.env.example`; validate names and constraints in the runtime config before deployment. Common variables include:

| Variable group                                                                          | Purpose                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`, `DATABASE_POOL_*`                                                       | MySQL/TiDB connection and bounded pool settings.                                                                                                                                        |
| `PUBLIC_APP_ORIGIN`                                                                     | Canonical public HTTPS origin used for OAuth callbacks; required in production.                                                                                                         |
| `JWT_SECRET`, `SESSION_TTL_MS`, `VITE_APP_ID`                                           | Signed session configuration and application binding.                                                                                                                                   |
| `OAUTH_SERVER_URL`, `OAUTH_SERVER_ALLOWED_ORIGINS`, `OAUTH_PORTAL_URL`, `OWNER_OPEN_ID` | Hosted identity and administrator bootstrap. Production requires the OAuth API's exact HTTPS origin in the comma-separated origin-only allowlist; redirects are disabled for OAuth API calls. |
| `ERASURE_IDENTITY_HMAC_KEYS`                                                            | Stable ordered keys for irreversible identity tombstones; append during rotation and retain prior keys.                                                                                 |
| `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY`                                      | Optional server-side AI/provider integration.                                                                                                                                           |
| `CONNECTOR_OAUTH_*`, `GOOGLE_*`, `DROPBOX_*`, `MICROSOFT_*`, `LINKEDIN_*`, `GITHUB_*`   | Consent-scoped external account connections. Empty means disabled; partial/unsafe configuration fails closed.                                                                           |
| `STRIPE_*`                                                                              | Legacy checkout and webhook integration; not authorization to charge users.                                                                                                             |
| `AUTONOMOUS_SCHEDULER_ENABLED`                                                          | Review-first candidate workflow automation.                                                                                                                                             |
| `JOB_SCRAPING_SCHEDULER_ENABLED`, `JOB_SCRAPING_*`                                      | Source scheduler, interval, concurrency, timeouts, cycle budget, optional allow-list. Scheduler defaults off.                                                                           |
| `FILE_MALWARE_SCAN_*` and storage variables                                             | Private resume storage and production upload scanning. Configured scanner origins must be explicitly allowlisted; production requires HTTPS except for an allowlisted loopback scanner. |

See [`.env.example`](.env.example), [security policy](SECURITY.md), [detailed security controls](docs/SECURITY.md), and [private Hetzner runbook](deploy/hetzner/README.md). Deployment secrets are not required for ordinary documentation or unit-test work.

## Useful Commands

| Command                                                      | Purpose                                                                          |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `pnpm dev`                                                   | Start Vite/Express development mode.                                             |
| `pnpm check`                                                 | TypeScript check.                                                                |
| `pnpm test`                                                  | Regular Vitest suite; opt-in MySQL suites are separate.                          |
| `pnpm test:database`                                         | Approved isolated-MySQL acceptance suite (requires explicit test configuration). |
| `pnpm test:e2e`                                              | Authenticated Chromium journey on a loopback MySQL database named `hire_ai_e2e`; refuses other database hosts or schemas. |
| `pnpm run doctor`                                            | Validate runtime and security configuration.                                     |
| `pnpm security:audit`                                        | Audit dependencies at moderate-or-higher severity.                               |
| `pnpm build` / `pnpm start`                                  | Build and start the production application.                                      |
| `pnpm db:generate` / `pnpm db:migrate`                       | Generate or apply committed schema migrations.                                   |
| `pnpm db:backup`, `pnpm db:backup:verify`, `pnpm db:restore` | Create, verify, and explicitly restore database backup bundles.                  |
| `pnpm db:audit-schema`, `pnpm db:audit-query-plans`          | Run production-schema and query-plan audits after build.                         |
| `pnpm start:windows`, `pnpm start:ngrok`                     | Audited Windows startup or optional ngrok tunnel readiness.                      |

Use only disposable, isolated databases for acceptance tests and restore drills. Never point test or restore tooling at a live database without following the operator runbook and an explicit recovery plan.

## API Overview

The primary API is tRPC at `/api/trpc`; router definitions are in `server/routers.ts`. Major groups cover authentication, profile, jobs, applications, automation, alerts, connectors, interview preparation, workspaces, privacy, success fees, admin, audit, and system status.

Additional HTTP routes include hosted OAuth login/callback, connector OAuth callback, signed Stripe webhook, readiness/health routes, and an optional disabled-by-default HAI bridge. The bridge provides bearer-protected aggregate status through `/api/hai/a2a` and bounded, read-only remote-job search through `/api/hai/jobs/search`; both endpoints reject mutation authority. These routes have different authentication and configuration requirements. See [docs/API_REFERENCE.md](docs/API_REFERENCE.md) and [docs/WINDOWS_NGROK_HAI.md](docs/WINDOWS_NGROK_HAI.md) for details.

## Security And Privacy

Hire.AI handles resumes, employment history, salary expectations, provider grants, and other sensitive data. Security controls include signed HttpOnly sessions, active-account and role checks, owner-scoped mutations, encrypted connector grants, fail-closed OAuth setup, upload bounds and malware-scanner requirements, global and sensitive-route request budgets, provider-input limits, audit and idempotency controls, constrained security headers, and a read-only/disabled-by-default HAI bridge. HAI job search is limited to current canonical public listings that pass server-enforced remote-only and safety filters; it does not provide application submission or user-profile access. Public HAI origins require HTTPS and exact allowlisting. HAI and search request budgets are process-local; a multi-replica deployment needs shared atomic limits. These are code-level controls, not a substitute for independent testing or operational configuration.

GitHub's live repository settings and alert inventory were checked on 2026-10-14 UTC. Dependabot alerts and security updates, provider-pattern secret scanning, push protection, private vulnerability reporting, and CodeQL default setup are enabled. CodeQL scans GitHub Actions, JavaScript/TypeScript, and Python; 33 code-scanning alerts were open on `main` (5 critical, 24 high, 4 medium) at the time of the check. These findings remain to be triaged and resolved or explicitly dispositioned; enabling CodeQL does not mean the code is secure. No open Dependabot or secret-scanning alerts were returned by GitHub on 2026-10-14 UTC. Generic non-provider secret scanning remains disabled because GitHub currently limits it to organization-owned repositories on GitHub Team with GitHub Secret Protection. Secret validity checks remain disabled because they send detected credentials to the issuing provider. Neither feature is represented as enabled. See the [Security tab](https://github.com/Robert-Velhorst/013-Hire-AI/security) and GitHub guidance on [secret scanning](https://docs.github.com/en/code-security/concepts/secret-security/supported-secret-scanning-patterns), [generic patterns](https://docs.github.com/en/code-security/how-tos/secure-your-secrets/detect-secret-leaks/enabling-secret-scanning-for-generic-patterns), and [validity checks](https://docs.github.com/en/code-security/concepts/secret-security/validity-checks).

At the 2026-10-14 UTC check, those 33 open CodeQL alerts on `main` had not been represented as fixed. `main` requires pull requests, all five CI checks, resolved review conversations, and an up-to-date base. Administrators are included; force pushes and branch deletion are disabled. No approving-review count is required for this single-maintainer repository. GitHub Actions is restricted to the eight workflow actions, tokens default to read-only, workflows cannot create or approve pull requests, and all workflow actions are pinned to full commit SHAs with repository SHA-pinning enforcement enabled. Settings and alert totals can change; use GitHub as the live source of truth.

Report vulnerabilities through GitHub's private vulnerability reporting for this repository; do not disclose exploitable details in public issues. See the root [SECURITY.md](SECURITY.md) for reporting instructions and [docs/SECURITY.md](docs/SECURITY.md) for controls and outstanding production reviews.

Before real users, deployment owners must complete threat modeling, dependency/license review, privacy/retention approval, backup and restore drills, external penetration/accessibility checks, secure identity and storage setup, malware-scanner acceptance, and live-provider tests. Production acceptance is currently **not complete**. The authoritative checklist is [docs/PRODUCTION_ACCEPTANCE.md](docs/PRODUCTION_ACCEPTANCE.md).

## CI, Releases, And Container Package

Pull requests and pushes to `main` run five CI jobs: Hetzner bootstrap validation, build/type-check/tests, Windows runtime, isolated database acceptance, and container runtime. GitHub Actions is the source of truth for a particular commit's results.

Published GitHub Releases trigger a workflow that builds and publishes the application container to GitHub Container Registry (`ghcr.io/robert-velhorst/013-hire-ai`) using the repository's Dockerfile. The first preview release, [`v0.1.0-alpha.1`](https://github.com/Robert-Velhorst/013-Hire-AI/releases/tag/v0.1.0-alpha.1), was published on 2026-10-13, and its image-publishing workflow succeeded. The public OCI manifest was verified for Linux AMD64; the [container package](https://github.com/users/Robert-Velhorst/packages/container/package/013-hire-ai) is available. This is a self-hostable **preview artifact**, not a managed Hire.AI service. Treat database migrations, secrets, data backups, TLS, OAuth callbacks, storage, scanning, monitoring, and legal approval as operator responsibilities. Pin a release tag or image digest rather than relying on a mutable tag.

```powershell
docker pull ghcr.io/robert-velhorst/013-hire-ai:v0.1.0-alpha.1
```

The command above pulls the first published alpha image. Before using a later release, verify that its publishing workflow succeeded and the package is public. See [deploy/hetzner/README.md](deploy/hetzner/README.md) for the private deployment approach. A GitHub Release is not a production launch.

## Business And Technical Documentation

| Document                                                         | Audience / purpose                                                         |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [docs/PRODUCT_DIRECTION.md](docs/PRODUCT_DIRECTION.md)           | Approved product and commercial direction, with implementation boundaries. |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md)                         | Candidate workflow guide.                                                  |
| [docs/API_REFERENCE.md](docs/API_REFERENCE.md)                   | API and integration overview.                                              |
| [docs/SOURCE_INTELLIGENCE.md](docs/SOURCE_INTELLIGENCE.md)       | Source inventory, policy and discovery limitations.                        |
| [docs/SECURITY.md](docs/SECURITY.md)                             | Detailed application security controls and remaining work.                 |
| [docs/PRODUCTION_ACCEPTANCE.md](docs/PRODUCTION_ACCEPTANCE.md)   | Current production readiness evidence and release blockers.                |
| [docs/GOAL_COMPLETION_MATRIX.md](docs/GOAL_COMPLETION_MATRIX.md) | Requirements mapped to implementation evidence and gaps.                   |
| [docs/OPERATOR_RUNBOOK.md](docs/OPERATOR_RUNBOOK.md)             | Operations, backup/restore, and deployment controls.                       |
| [deploy/hetzner/README.md](deploy/hetzner/README.md)             | Private Hetzner deployment instructions.                                   |
| [CURRENT_STATUS.md](CURRENT_STATUS.md)                           | Engineering status notes; dated evidence is historical unless refreshed.   |

## Contributing

1. Create a focused branch and keep secrets, private documents, generated browser exports, local databases, logs, and build output out of commits.
2. Add or update tests for behavior changes and preserve consent, ownership, provider-policy, and audit boundaries.
3. Run relevant checks locally. CI must pass on the exact pull-request commit.
4. Do not convert a local test, configured integration, source catalog entry, or container build into a claim of live provider or production acceptance.
5. Do not merge schema changes without reviewing migration ordering, deployment impact, rollback/recovery, and the isolated database checks.

## License

The `package.json` metadata declares `MIT`, but this repository currently has no root `LICENSE` file. Confirm the intended licensing and add the complete license text before encouraging third-party redistribution; this preview release does not resolve that documentation gap.

