# Hire.AI

Hire.AI is an AI-assisted, review-first job-search operating platform. It helps a job seeker discover remote roles, organize evidence, prepare application materials, track follow-ups, monitor employer responses, and manage success-fee billing after a hire. It is designed to reduce repetitive job-search work without pretending that unsafe or unapproved external automation has happened.

The current repository is a hardened prototype / MVP foundation. It contains real application code, database schema, tests, operational scripts, source-ingestion adapters, and safety gates. It is not yet a production-ready fully autonomous job-application service because live provider credentials, legal/privacy approval, production infrastructure acceptance, and provider-specific submission agreements are still required.

## Plain-English Summary

For job seekers, Hire.AI is intended to become the control center for a remote job search:

- it keeps a profile, skills, resume versions, social/profile links, applications, interviews, follow-ups, and offer evidence in one place;
- it discovers jobs from configured remote-job sources and deduplicates cross-posted jobs where possible;
- it scores and explains matches against the candidate profile;
- it prepares reviewable application material, including cover-letter and answer drafts;
- it tracks whether an application was actually submitted only after the user records deterministic confirmation evidence;
- it monitors connected inbox sources for employer responses when OAuth is configured;
- it notifies users only from recorded interview-invite evidence;
- it supports a success-fee business model where payment starts only after the user reports a hire.

For developers and operators, this repo is a TypeScript full-stack web application with React, Express, tRPC, Drizzle ORM, MySQL/TiDB, Stripe, S3-compatible private document storage, OAuth connector policy, source-scraper orchestration, privacy-erasure workflows, CI, Docker packaging, Windows/ngrok launch scripts, and extensive Vitest coverage.

## Current Truth

Hire.AI is intentionally review-first.

It does not currently open employer portals, fill third-party forms, upload resumes to employers, or submit applications externally without the user. The active automation flow prepares application material and records a pending review/handoff. The user remains responsible for completing the employer-side handoff unless a future official provider integration is approved, tested, and evidence-backed.

It also does not claim that every job platform on the internet is live. The codebase has a 62-platform catalog for provenance, source policy, and future expansion. Of those, 7 sources are approved for unattended automated discovery in the current policy: RemoteOK, Remotive, Jobicy, Arbeitnow, We Work Remotely, NoDesk, and ProBlogger. Other cataloged platforms are manual, unavailable, account-mediated, generic-parser candidates, or future integrations until their provider terms, adapters, tests, and acceptance evidence exist.

## Product Scope

### Implemented Product Areas

- Candidate account, authentication, terms acceptance, account status, and session revocation.
- Candidate profile, skills, work experience, education, projects, salary expectations, social links, and profile readiness.
- Versioned resume upload, parsing, active-resume selection, private download routing, and upload validation.
- Job catalog, search, filtering, source health, listing freshness, salary/location/job-type normalization, match scoring, and saved jobs.
- Cross-source job deduplication using source identities and fuzzy duplicate matching.
- Application decisions, prepared materials, submission evidence, employer responses, interviews, outcomes, follow-ups, withdrawals, and offer decisions.
- Autonomous run orchestration for opted-in users, with evidence gates and review queues instead of unattended external submissions.
- Inbox-response discovery and interview-notification records for connected mail providers.
- Job alerts and application command-center summaries.
- Success-fee reporting, offer evidence, Stripe checkout/session support, recurring-fee records, quarterly verification, employment-ended review, and admin compliance queues.
- Admin operating views for fees, verification, failed payments, reviews, discovery health, runtime failures, privacy erasure, and account controls.
- Privacy export, deletion-review requests, retention policy classification, provider/object cleanup tasks, and audited erasure finalization.
- Workspace governance with owners, administrators, members, invitations, role changes, ownership transfer, and archival. Workspace membership intentionally does not share candidate-domain records.
- English/Dutch locale persistence across major user and admin workflows, while preserving employer/provider/audit evidence verbatim.
- Windows-native startup, optional ngrok tunnel launcher, and a restricted read-only HAI A2A status endpoint.

### Explicit Non-Goals In This Version

- No unattended employer-portal submission.
- No claim that all cataloged providers are legally or technically live.
- No scraping of account-mediated or marketplace platforms without approved contracts or official provider flows.
- No hidden connector access; OAuth connectors require explicit user authorization and deployment credentials.
- No broad workspace sharing of candidate profiles, resumes, applications, or provider credentials.
- No real production payment, storage, OAuth, malware-scanner, or provider-live acceptance without configured secrets and operator approval.

## Business Model

The intended business model is success-based:

| Event                                              | User cost                                    |
| -------------------------------------------------- | -------------------------------------------- |
| Searching, preparing, and tracking through Hire.AI | Free                                         |
| Landing a job through Hire.AI                      | 5% of monthly salary, ongoing while employed |

The implemented flow supports:

1. The user reports a hire from an accepted offer flow.
2. The user uploads offer or employment evidence.
3. Hire.AI records the stated salary and computes the monthly fee.
4. Stripe checkout/subscription records are created when Stripe is configured.
5. Quarterly employment verification can be requested and reviewed.
6. Employment-ended reports can stop the obligation after review.

This model requires legal, privacy, tax, billing, and consumer-protection review before production use.

## Architecture

```text
Browser
  React 19 + Vite + Tailwind CSS + shadcn/Radix UI
        |
        | tRPC over HTTP at /api/trpc
        v
Express 4 server on Node.js 22 ESM
        |
        |-- Auth/session context and account-status gates
        |-- tRPC routers for jobs, profile, applications, automation, alerts,
        |   workspaces, privacy, success fees, admin, and system status
        |-- Job scraper manager and source adapters
        |-- Autonomous orchestration and review queues
        |-- Connector OAuth routes and token encryption policy
        |-- Stripe webhook route
        |-- HAI A2A read-only status route
        |
        |-- Drizzle ORM -> MySQL/TiDB
        |-- Private document storage -> S3-compatible storage
        |-- Optional LLM/provider APIs -> server-side only
```

## Technology Stack

| Layer      | Technology                                                                    |
| ---------- | ----------------------------------------------------------------------------- |
| Frontend   | React 19, Vite 7, Tailwind CSS 4, shadcn/ui, Radix UI, Wouter, TanStack Query |
| Backend    | Node.js 22, Express 4, tRPC 11, TypeScript ESM                                |
| Database   | MySQL/TiDB via Drizzle ORM                                                    |
| Auth       | Manus OAuth-style session flow with signed HttpOnly cookies                   |
| Payments   | Stripe SDK and webhook ledger                                                 |
| Storage    | AWS S3-compatible private object storage                                      |
| Documents  | PDF and DOCX parsing through `pdf-parse` and `mammoth`                        |
| Validation | Zod                                                                           |
| Testing    | Vitest                                                                        |
| Build      | Vite for frontend, esbuild for server bundles                                 |
| Packaging  | Dockerfile plus Windows PowerShell launch scripts                             |

## Main Workflows

### 1. Candidate Onboarding

- User signs in.
- User accepts Terms of Service.
- User chooses language.
- User completes profile fields, preferences, salary expectations, skills, work history, education, and projects.
- User uploads or selects an active versioned resume.
- Optional profile evidence can be imported from configured connectors or public profile links.

### 2. Job Discovery And Deduplication

- Operators seed the platform catalog.
- Approved automated sources can be scanned.
- Jobs are normalized into one shared schema.
- Source identities refresh existing records.
- Similar cross-posted roles are linked as duplicates.
- Current canonical jobs remain discoverable when a linked source is re-observed.
- Source attempts, errors, freshness, and policy status are recorded.

### 3. Job Search And Matching

- Users filter by text, company, location, job type, platform, salary range, currency, remote-only status, experience level, application process, visa support, open-hiring support, diversity-friendly signal, disclosed salary, listing age, and safety status.
- Match ledgers explain how the job compares with the candidate profile.
- Users save jobs or decide to apply, ignore, review, or defer.

### 4. Application Preparation

- Hire.AI checks profile readiness, resume evidence, active job freshness, duplicate decisions, and safety gates.
- It prepares application material in the internal ledger.
- It creates pending approval/review records.
- It records that no external submission was performed.
- The user completes the employer handoff and records confirmation evidence.

### 5. Follow-Ups And Employer Responses

- Follow-up drafts can be created and tracked.
- Mail delivery confirmation is separated from draft creation.
- Connected inbox providers can produce response candidates when OAuth is configured.
- Interview notifications require recorded interview-invite evidence.
- Responses, interviews, outcomes, and offers remain linked to the application ledger.

### 6. Success Fees And Compliance

- Accepted offers can become reported hires.
- Offer evidence and salary are recorded.
- Stripe checkout/subscription records can be created.
- Quarterly verification and failed-payment workflows feed admin review.
- Employment-ended reports require controlled review.

### 7. Privacy And Deletion

- Users can export metadata.
- Users can request account deletion review.
- Admins can preview policy-classified erasure impact before execution.
- Provider cleanup, private-object cleanup, database scrubbing, and retained regulated ledgers are explicit, audited steps.

## Source Coverage

### Automated Discovery Sources

These sources are allowed by current code policy for unattended discovery:

| Source           | Mode      | Notes                                                                         |
| ---------------- | --------- | ----------------------------------------------------------------------------- |
| RemoteOK         | Automated | Public job API adapter                                                        |
| Remotive         | Automated | Public job API adapter                                                        |
| Jobicy           | Automated | Documented public remote-jobs API; hourly minimum polling                     |
| Arbeitnow        | Automated | No-key API; only explicit remote records are accepted; hourly minimum polling |
| We Work Remotely | Automated | Public RSS category feeds                                                     |
| NoDesk           | Automated | Public RSS feed                                                               |
| ProBlogger       | Automated | Public RSS feed                                                               |

### Cataloged Or Future Sources

The platform catalog currently tracks 62 sources for provenance and expansion. Many are manual or account-mediated by design, including LinkedIn Jobs, Wellfound, Glassdoor, marketplace/freelance platforms, and discontinued or unsupported sources. Catalog inclusion means Hire.AI can represent the source and policy; it does not mean the source may be scraped or submitted to in production.

See `server/scrapers/platformCatalog.ts` for policy decisions and `server/scrapers/index.ts` for registered parser adapters.

## Safety And Security Model

Hire.AI handles sensitive employment, salary, resume, and provider-authorization data. The repository therefore uses fail-closed controls:

- Sessions are signed, HttpOnly, SameSite=Lax, revocable, application-bound, and production-bounded by configured lifetime.
- Unsafe browser-session requests require exact same-origin proof.
- Protected and admin procedures require an active authenticated account before route logic.
- Admin routes require admin role checks.
- OAuth connector configuration is disabled when empty and rejected when partially or unsafely configured.
- Connector tokens are encrypted at rest and never exposed through public profile APIs.
- Disconnect disables local access before cleanup and uses provider revocation where supported.
- Resume/document uploads are size, MIME, and signature checked; production requires malware scanning.
- Provider-controlled job fields are normalized and bounded before persistence.
- Outbound public audio URLs require credential-free HTTPS, public DNS answers, and address pinning.
- HAI A2A status is disabled by default, bearer-authenticated, read-only, body-bounded, and scoped to one canonical endpoint/user.
- Runtime errors and diagnostics are redacted before user or peer exposure.
- Dependency audits run at moderate-or-higher severity in CI.

See `docs/SECURITY.md` for the detailed security boundary.

## Data Model Overview

The Drizzle schema in `drizzle/schema.ts` is the source of truth. Major record groups include:

- `users`, sessions, locale, account status, and terms acceptance.
- `user_profiles`, profile evidence, social links, skills, work experience, education, projects, and resume versions.
- `job_platforms`, `job_platform_scrape_outcomes`, `jobs`, job matches, duplicates, saved jobs, and job alerts.
- `applications`, decisions, materials, attempts, submission evidence, approvals, responses, follow-ups, interviews, outcomes, and offer attribution.
- `success_fees`, fee payments, employment verifications, checkout sessions, and employment-ended reviews.
- `connector_authorizations` and user connector accounts.
- `audit_events`, admin review items, operational failure signals, privacy erasure runs, and retention-policy records.
- `workspaces`, workspace members, and invitations.

## Project Layout

```text
.
|-- client/
|   |-- index.html
|   `-- src/
|       |-- components/          Shared UI and layout components
|       |-- components/ui/       shadcn/Radix UI primitives
|       |-- contexts/            Theme and locale context
|       |-- hooks/               React hooks
|       |-- lib/                 Client-side workflow logic and tests
|       `-- pages/               Dashboard, Job Search, Applications, Profile,
|                                Billing, Review Queue, Admin, Team, Settings
|
|-- server/
|   |-- _core/                   HTTP, auth, OAuth, cookies, runtime, diagnostics
|   |-- routers/                 Admin, success fees, workspaces
|   |-- scrapers/                Source adapters, catalog, scheduler, manager
|   |-- *.ts                     Application, automation, matching, privacy,
|                                connectors, billing, storage, response workflows
|   `-- *.test.ts                Server and integration tests
|
|-- drizzle/
|   |-- schema.ts                Runtime schema
|   |-- relations.ts             ORM relations
|   `-- *.sql                    Ordered migrations
|
|-- shared/                      Cross-client/server constants and policies
|-- scripts/                     Build, doctor, migrations, backup/restore,
|                                Windows/ngrok, database audits
|-- docs/                        Runbooks, audits, status, acceptance evidence
|-- Dockerfile
|-- package.json
|-- pnpm-lock.yaml
`-- README.md
```

## Getting Started

### Prerequisites

- Node.js 22 or newer.
- pnpm 11.16.0, matching `packageManager`.
- MySQL or TiDB for persistent storage.
- Optional production services: Stripe, S3-compatible storage, Manus/OAuth provider, connector OAuth applications, malware scanner, ngrok reserved domain, and HAI peer configuration.

### Install

```bash
git clone https://github.com/Noodzakelijk-Online/013-Hire-AI.git
cd 013-Hire-AI
pnpm install
```

### Configure

Development can run with local fallbacks for some auth settings, but persistent features need a database:

```bash
set DATABASE_URL=mysql://user:password@localhost:3306/hire_ai
```

On PowerShell:

```powershell
$env:DATABASE_URL = "mysql://user:password@localhost:3306/hire_ai"
```

Then apply migrations:

```bash
pnpm db:migrate
```

### Run Locally

```bash
pnpm dev
```

The development server listens on port `3000` by default.

### Build And Start

```bash
pnpm build
pnpm start
```

### Windows Native Startup

```powershell
pnpm start:windows
```

### ngrok Tunnel Startup

```powershell
pnpm start:ngrok
```

The ngrok launcher verifies that the public tunnel reaches the exact local runtime identity before reporting readiness.

## Environment Variables

Secrets must be injected through the deployment environment. Do not commit `.env` files.

### Core Runtime

| Variable                        | Purpose                                                               |
| ------------------------------- | --------------------------------------------------------------------- |
| `DATABASE_URL`                  | MySQL/TiDB connection string                                          |
| `DATABASE_POOL_LIMIT`           | Optional pool size, 1-50                                              |
| `DATABASE_POOL_QUEUE_LIMIT`     | Optional queued DB requests, 1-1000                                   |
| `DATABASE_POOL_IDLE_TIMEOUT_MS` | Optional idle timeout                                                 |
| `JWT_SECRET`                    | Production session secret; 32-4096 non-control chars; no placeholders |
| `SESSION_TTL_MS`                | Absolute session lifetime; 15 minutes to 30 days                      |
| `VITE_APP_ID`                   | Application ID bound into sessions                                    |
| `OAUTH_SERVER_URL`              | OAuth backend base URL                                                |
| `OAUTH_PORTAL_URL`              | Runtime login portal URL; trusted HTTPS outside loopback              |
| `OWNER_OPEN_ID`                 | Owner/admin bootstrap identity                                        |
| `BUILT_IN_FORGE_API_URL`        | Optional provider/LLM API base URL                                    |
| `BUILT_IN_FORGE_API_KEY`        | Server-side provider/LLM key                                          |

### Stripe

| Variable                      | Purpose                       |
| ----------------------------- | ----------------------------- |
| `STRIPE_SECRET_KEY`           | Stripe server key             |
| `STRIPE_WEBHOOK_SECRET`       | Stripe webhook signing secret |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Browser publishable key       |

### Connector OAuth

| Variable                                                      | Purpose                                                   |
| ------------------------------------------------------------- | --------------------------------------------------------- |
| `CONNECTOR_OAUTH_REDIRECT_URI`                                | Exact callback ending in `/api/connectors/oauth/callback` |
| `CONNECTOR_TOKEN_ENCRYPTION_KEY`                              | Base64 32-byte key for encrypted connector grants         |
| `CONNECTOR_OAUTH_STATE_SECRET`                                | Dedicated state-signing secret                            |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`       | Gmail and Google Drive                                    |
| `DROPBOX_OAUTH_CLIENT_ID` / `DROPBOX_OAUTH_CLIENT_SECRET`     | Dropbox                                                   |
| `MICROSOFT_OAUTH_CLIENT_ID` / `MICROSOFT_OAUTH_CLIENT_SECRET` | Outlook                                                   |
| `LINKEDIN_OAUTH_CLIENT_ID` / `LINKEDIN_OAUTH_CLIENT_SECRET`   | LinkedIn                                                  |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET`       | GitHub                                                    |

If all connector variables are empty, connectors are intentionally disabled. If any connector value is configured, startup and `pnpm doctor` fail closed unless shared OAuth controls and at least one complete provider credential pair are valid.

### Discovery And Automation

| Variable                              | Purpose                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `AUTONOMOUS_SCHEDULER_ENABLED`        | Enables review-first autonomous cycles for opted-in users; defaults true |
| `JOB_SCRAPING_SCHEDULER_ENABLED`      | Enables scheduled job-source scanning; defaults false                    |
| `JOB_SCRAPING_INTERVAL_MINUTES`       | Scheduler interval, 5-1440 minutes                                       |
| `JOB_SCRAPING_MAX_JOBS_PER_RUN`       | Cycle-wide discovery budget, 10-1000                                     |
| `JOB_SCRAPING_SOURCE_TIMEOUT_MS`      | Per-source timeout, 5s-300s                                              |
| `JOB_SCRAPING_MAX_CONCURRENT_SOURCES` | Concurrent source scans, 1-10                                            |
| `JOB_SCRAPING_ENABLED_PLATFORMS`      | Optional comma-separated allow-list                                      |

## Scripts

| Command                                                 | Description                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm dev`                                              | Start development server with `tsx watch`                                |
| `pnpm build`                                            | Build frontend, enforce bundle budgets, bundle server and DB audit tools |
| `pnpm start`                                            | Start production server from `dist/index.js`                             |
| `pnpm start:windows`                                    | Windows-native audited startup                                           |
| `pnpm start:ngrok`                                      | Windows/ngrok tunnel startup and readiness check                         |
| `pnpm check`                                            | TypeScript check                                                         |
| `pnpm test`                                             | Run Vitest suite                                                         |
| `pnpm doctor`                                           | Validate runtime configuration and fail-closed policies                  |
| `pnpm security:audit`                                   | Run moderate-or-higher dependency audit                                  |
| `pnpm db:generate`                                      | Generate Drizzle migration after schema changes                          |
| `pnpm db:migrate`                                       | Apply committed migrations                                               |
| `pnpm db:push`                                          | Backward-compatible alias for migration application                      |
| `pnpm db:backup`                                        | Create atomic checksummed MySQL backup bundle                            |
| `pnpm db:backup:verify -- <dir>`                        | Verify a backup bundle                                                   |
| `pnpm db:restore -- <dir> --confirm RESTORE:<database>` | Restore a verified backup into an explicitly confirmed target            |
| `pnpm db:audit-schema`                                  | Compare production DB schema with runtime schema after build             |
| `pnpm db:audit-query-plans`                             | Verify expected query plans after build                                  |
| `pnpm format`                                           | Format code with Prettier                                                |

## API Surface

The main API is tRPC at `/api/trpc`; `server/routers.ts` is the source of truth.

Major router groups:

| Router          | Purpose                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------- |
| `auth`          | Current user, logout, ToS acceptance, locale update                                          |
| `privacy`       | Metadata export and deletion-review requests                                                 |
| `workspaces`    | Workspace governance, invitations, roles, ownership, archive                                 |
| `audit`         | User and entity audit reads                                                                  |
| `connectors`    | Connector status, OAuth start, manual connection requests, disconnect                        |
| `jobs`          | Job lists, search, matching, source status, saved jobs                                       |
| `profile`       | Candidate profile, evidence, preferences, resume and social data                             |
| `applications`  | Application ledger, notes, decisions, submissions, responses, interviews, follow-ups, offers |
| `automation`    | ATS detection, application preparation, autonomous plan/run/status                           |
| `alerts`        | Job alert create/list/update/toggle/delete                                                   |
| `interviewPrep` | Interview questions, mock interview, video tips                                              |
| `successFees`   | Report hire, billing session, verification, employment-ended, payment history                |
| `admin`         | Admin review, fees, discovery, privacy erasure, account controls, operational failures       |
| `system`        | Owner/system notification utilities                                                          |

Non-tRPC routes include:

- `/api/oauth/login` and `/api/oauth/callback` for hosted sign-in.
- `/api/connectors/oauth/callback` for provider connector authorization.
- `/api/stripe/webhook` for signed Stripe events.
- `/api/hai/a2a` for optional bearer-authenticated read-only HAI status.
- health/readiness routes registered by the server runtime.

## Testing And Verification

Use these checks before publishing a change:

```bash
pnpm check
pnpm test
pnpm doctor
pnpm security:audit
pnpm build
```

The repository also contains tests for:

- auth/session security and account-state access;
- source scraping, source policy, lazy parsing, discovery budgets, and deduplication;
- job filters, matching, saved jobs, job alerts, and listing freshness;
- application decisions, materials, approvals, submission evidence, responses, follow-ups, interviews, and offers;
- autonomous orchestration, scheduler state, evidence gates, and leases;
- connector OAuth policy, token storage, disconnect/revocation, and cloud document discovery;
- privacy export, retention classification, erasure planning/execution/finalization;
- success-fee state machines, Stripe webhook idempotency, payment windows, and admin queues;
- localization, UI workflow copy, accessibility names, and frontend state helpers;
- database migrations, schema audits, query-plan audits, backups, restores, container packaging, Windows runtime, and CI workflow expectations.

See `docs/FINAL_VERIFICATION_REPORT.md`, `docs/GOAL_COMPLETION_MATRIX.md`, and `docs/CODEX_WORKLOG.md` for historical verification evidence. Rerun the commands above in the target environment before claiming a release.

## Deployment Notes

Production deployment requires:

1. Complete migration history applied to the target database.
2. Managed secret storage for all required secrets.
3. Production-valid OAuth portal settings.
4. Unique JWT and connector state secrets.
5. Stripe keys and webhook endpoint.
6. Private object storage and malware scanning.
7. Provider OAuth applications and approved scopes for any live connectors.
8. Provider-specific permission and terms acceptance for source ingestion.
9. Backup/restore acceptance against the provisioned deployment.
10. Upstream distributed rate limiting if running multiple server instances.
11. Legal/privacy/retention approval before accepting real users.

The Dockerfile builds a Node.js-only runtime. Windows scripts support local/native operation and optional ngrok exposure, but live hosted acceptance still requires a reserved hostname, valid callbacks, credentials, and operator evidence.

## Documentation Map

| File                             | Purpose                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `CURRENT_STATUS.md`              | Plain-English implementation status and known limits               |
| `docs/GOAL_COMPLETION_MATRIX.md` | Requirement-by-requirement completion evidence                     |
| `docs/CRITICAL_PATH.md`          | Critical product and deployment path                               |
| `docs/SECURITY.md`               | Security model and remaining production security work              |
| `docs/OPERATOR_RUNBOOK.md`       | Operational procedures, backup/restore, deployment controls        |
| `docs/API_REFERENCE.md`          | High-level API guide                                               |
| `docs/USER_GUIDE.md`             | User-facing workflow guide                                         |
| `docs/TECHNICAL_AUDIT.md`        | Technical audit notes                                              |
| `docs/TECHNICAL_DEBT.md`         | Remaining blockers and owner/unblocker notes                       |
| `docs/TROUBLESHOOTING.md`        | Debugging and operational troubleshooting                          |
| `docs/WINDOWS_NGROK_HAI.md`      | Windows, ngrok, and HAI operation                                  |
| `docs/CODEX_WORKLOG.md`          | Implementation worklog                                             |
| `PLATFORMS.md`                   | Historical platform list; use source code policy for current truth |

## Contributing

1. Create a branch for the change.
2. Keep changes scoped to the feature or fix.
3. Add or update tests for behavioral changes.
4. Run `pnpm check`, `pnpm test`, `pnpm doctor`, `pnpm security:audit`, and `pnpm build` where relevant.
5. Keep provider-live, payment-live, and external-submission claims separate from local/CI verification.
6. Do not commit secrets, private documents, generated local output, or provider tokens.

## License

`package.json` currently declares this project as MIT licensed.
