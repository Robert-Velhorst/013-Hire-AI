# Hire.AI

Hire.AI is being built as a platform-independent remote-job assistant: it should find suitable roles across global and local job boards and employer websites, remove duplicates, prepare and submit applications, follow up, and arrange and prepare interviews. **The candidate conducts the interview and handles everything afterwards.** The goal is minimal user effort and carefully targeted applications, not maximum application volume.

The confirmed direction serves all professions and experience levels, exclusively for fully remote roles that fit the candidate's geographic, time-zone and other hard requirements. Hybrid roles are outside that direction. **The implementation is currently review-first; the destination is consent-bounded autonomy.** These are different stages, not interchangeable claims. [Confirmed Product Direction](docs/PRODUCT_DIRECTION.md) is the authoritative record of the user-approved decisions from 2026-09-06.

The current repository is a hardened prototype / MVP foundation. It contains real application code, database schema, tests, operational scripts, source-ingestion adapters, and safety gates. It is not yet a production-ready fully autonomous job-application service because live provider credentials, legal/privacy approval, production infrastructure acceptance, and provider-specific submission agreements are still required.

The selected deployment target is **online, multi-user operation at Hetzner**. Historical hosting evidence records a CPX12 application image build, private MySQL, 75 applied migrations and schema audits around a reboot. That is not verification of today's server or a public release. The last documented deployment remained blocked by domain/TLS, identity/provider and scanner configuration. [Hetzner Hosting](docs/HETZNER_HOSTING.md), [private deployment instructions](deploy/hetzner/README.md) and [Production Acceptance](docs/PRODUCTION_ACCEPTANCE.md) describe evidence and remaining gates. Production startup rejects incompatible database schemas; configured database failures cannot silently switch users to sample data. Employer submission remains an implementation gap, not only a credential requirement.

## Table Of Contents

- [Plain-English Summary](#plain-english-summary)
- [Current Truth](#current-truth)
- [Who This Repository Is For](#who-this-repository-is-for)
- [Product Scope](#product-scope)
- [Confirmed Operating Rules](#confirmed-operating-rules)
- [Business Model](#business-model)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Main Workflows](#main-workflows)
- [Source Coverage](#source-coverage)
- [Autonomy Model](#autonomy-model)
- [Connector And Provider Status](#connector-and-provider-status)
- [Safety And Security Model](#safety-and-security-model)
- [Data Model Overview](#data-model-overview)
- [Project Layout](#project-layout)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Scripts](#scripts)
- [API Surface](#api-surface)
- [Testing And Verification](#testing-and-verification)
- [Operational Evidence](#operational-evidence)
- [Deployment Notes](#deployment-notes)
- [Documentation Map](#documentation-map)
- [Contributing](#contributing)
- [License](#license)

## Plain-English Summary

For job seekers, Hire.AI is intended to become the control center for a remote job search:

- it keeps a profile, skills, resume versions, social/profile links, applications, interviews, follow-ups, and offer evidence in one place;
- it discovers jobs from configured remote-job sources and deduplicates cross-posted jobs where possible;
- it scores and explains matches against the candidate profile;
- it prepares reviewable application material, including cover-letter and answer drafts;
- it tracks whether an application was actually submitted only after the user records deterministic confirmation evidence;
- it monitors connected inbox sources for employer responses when OAuth is configured;
- interview notifications require recorded invitation evidence; the target also allows necessary decision, safety and service-impact notifications;
- it contains billing workflows, but these must be reconciled with the newly approved commercial direction before use.

For developers and operators, this repo is a TypeScript full-stack web application with React, Express, tRPC, Drizzle ORM, MySQL/TiDB, Stripe, S3-compatible private document storage, OAuth connector policy, source-scraper orchestration, privacy-erasure workflows, CI, Docker packaging, Windows/ngrok launch scripts, and extensive Vitest coverage.

## Current Truth

Hire.AI currently operates review-first. This is the present implementation boundary, not the final product ambition.

It does not currently open employer portals, fill third-party forms, upload resumes to employers, or submit applications externally without the user. The active automation flow prepares application material and records a pending review/handoff. The user remains responsible for completing the employer-side handoff unless a future official provider integration is approved, tested, and evidence-backed.

It also does not claim that every job platform on the internet is live. The codebase has a 90-platform catalog for provenance, source policy, and future expansion. Of those, 9 sources are enabled for unattended automated discovery in the current code policy: RemoteOK, Remotive, Jobicy, Arbeitnow, Arbeitnow UK, Himalayas, We Work Remotely, NoDesk, and ProBlogger. Other cataloged platforms are manual, unavailable, account-mediated, generic-parser candidates, or future integrations until their provider terms, adapters, tests, and acceptance evidence exist. Policy enablement is not proof of a successful production scan.

The product destination is to handle discovery, applications, follow-up, interview scheduling, and preparation. **Authority ends at the interview:** the user handles negotiations, offers, acceptance, signatures and resignation. Minimal outcome/employment/pay reporting remains necessary for search status and any permitted billing. Existing offer-recording features do not authorize autonomous post-interview action. Employer submission remains a controlled handoff today.

## Who This Repository Is For

This README is written for several audiences:

| Reader                      | What to look at first                                                 |
| --------------------------- | --------------------------------------------------------------------- |
| Job seekers                 | Plain-English Summary, Main Workflows, Current Truth                  |
| Founders/operators          | Business Model, Deployment Notes, Operational Evidence                |
| Software developers         | Architecture, Technology Stack, Project Layout, API Surface           |
| Security/privacy reviewers  | Safety And Security Model, Data Model Overview, Documentation Map     |
| Provider-integration owners | Source Coverage, Connector And Provider Status, Environment Variables |

The short version: this is a real TypeScript application with many wired workflows, but production use still depends on external approvals, credentials, infrastructure, and legal/privacy decisions.

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

## Confirmed Operating Rules

These are approved requirements, **not a checklist of already implemented guarantees**. See [Product Direction](docs/PRODUCT_DIRECTION.md) for the full specification.

| Area | Target behavior |
| --- | --- |
| Onboarding | Consent-scoped documents and account access, followed by one compact confirmation of facts and hard preferences; reading and sending have separate permissions. |
| Daily discovery | Check new/changed jobs daily, share source discovery across users, skip unchanged processing and reassess relevant job/profile changes. Never confuse failed scans with no new jobs. |
| Deduplication | Track source provenance and conflicts; reposting alone does not permit reapplication. Resolve decisive inconsistencies before applying. |
| Missing conditions | Ask the vacancy holder first; park that application if unresolved and let the user approve a specific exception. Other suitable searches continue. |
| Personal requirements | Never invent experience or impersonate personal assessment completion. Request an alternative, otherwise let the candidate complete it or skip. |
| Follow-up | At most two follow-ups per unanswered sequence; respect response dates, rejection, objections and closure. Reconcile uncertain sends before retrying. |
| Interviews | Book within approved availability and limits. Other suitable applications continue until employment or pause is reported. |
| Transparency | Trace sources, reasoning, documents, sends, replies and costs. Allow future-action pause, employer exclusions and consent revocation. |
| Incidents | Pause affected operations, notify when necessary and do not bill our errors or recovery. A sent message cannot be represented as undone. |
| Restart and abuse | Stop applying on employment. Restart requires a reason and current criteria. Dismissal alone is not exclusion; permanent exclusion requires deliberate system abuse, human review by Robert and an opportunity to respond. |
| Retention | Proposed deletion of personal content within 30 days of account termination, with narrowly separated necessary exceptions and legal review before release. |

The proposed 20-person/country-limited introduction was rejected; no replacement launch format has been approved. Before real autonomous submissions, prove consent, correct facts/files, duplicate prevention, traceability, pause behavior and uncertain-send handling. Review actual trial outcomes after four weeks using user effort, suitable applications, interviews, incidents and costs; Robert decides expansion. No job or uninterrupted-employment guarantee is made.

## Business Model

### Approved Commercial Direction

**These are proposed commercial rules subject to implementation and market-specific legal review, not an active price offer.**

| Model | Approved target |
| --- | --- |
| Success-based | Employer and employee each contribute 1% of gross monthly salary actually received from an attributable Hire.AI placement, for the duration of that job. Continuous same-employer renewals count; unrelated independently found jobs do not automatically count. |
| Employer agreement | Payment requires proven agreement with Hire.AI. An employment contract alone is not that agreement. Non-paying employer placements remain possible. |
| Prepaid alternative | Non-expiring credits cover attributable resource costs multiplied by 2.5, with transparent shared-cost allocation, bounded reservations and release of unused reservations. No automatic purchases or debt. |
| Returning users | Success-model users can return for an eligible search without advance payment. Credit-model users use remaining/new credits unless sponsored. |
| Assistance fund | Proposed eligible balance transfers on termination support users unable to pay, with small grants and transparent queues rather than expected-salary ranking. Inactivity and temporary blocks preserve balances; disputed funds remain reserved. Transfer legality and refund rights remain unresolved. |

The overall operating ceiling is **EUR 100 per month**, including hosting, AI, storage and external services. No automatic increase is authorized. New costly work should pause at the ceiling while existing data remains accessible. Cross-provider enforcement is still a requirement to implement and verify, not a proven control.

Neither employee fees nor a credit-based alternative are presumed lawful merely because of their name or a foreign company location. The prepaid model is not universally free without sponsorship. Profitability and funding have not been demonstrated.

### Existing Billing Implementation

The repository still contains **legacy 5% assumptions**, success-fee calculations and Stripe subscription infrastructure. They are not the newly approved 1%/1% model. This README change does not migrate billing, change existing obligations or enable charging. The prepaid ledger, assistance fund and revised fee lifecycle must be implemented and verified before being advertised as available.

The existing flow supports:

1. The user reports a hire from an accepted offer flow.
2. The user uploads offer or employment evidence.
3. Hire.AI records the stated salary and computes the monthly fee.
4. Stripe checkout/subscription records are created when Stripe is configured.
5. Quarterly employment verification can be requested and reviewed.
6. Employment-ended reports can stop the obligation after review.

Both the existing flow and its replacement require legal, privacy, tax, billing and consumer-protection review before production use.

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
- A Gmail acceptance without a deterministic message identifier is recorded as an unknown delivery outcome, blocking blind retries until reconciliation.
- Connected inbox providers can produce response candidates when OAuth is configured.
- Interview notifications require recorded interview-invite evidence.
- Responses, interviews, outcomes, and offers remain linked to the application ledger.

### 6. Success Fees And Compliance

This describes legacy implementation, not activation of the commercial targets above. Offer and hire records are user/admin reporting, not authority to negotiate or accept a job for the candidate.

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
| Arbeitnow UK     | Automated | UK no-key API; one bounded page, explicit remote records only, provider backlinks |
| Himalayas        | Automated | Public cursor API; daily polling; at most 5 pages / 100 records per call, subject to the cycle budget; attribution retained |
| We Work Remotely | Automated | Public RSS category feeds                                                     |
| NoDesk           | Automated | Public RSS feed                                                               |
| ProBlogger       | Automated | Public RSS feed                                                               |

### Cataloged Or Future Sources

The platform catalog currently tracks 90 sources for provenance and expansion, including local and regional entries across Europe, Africa, Asia, the Middle East, North America, Latin America, and Oceania. Many are manual or account-mediated by design, including LinkedIn Jobs, Wellfound, Glassdoor, marketplace/freelance platforms, and discontinued or unsupported sources. Catalog inclusion means Hire.AI can represent the source and policy; it does not mean the source may be scraped or submitted to in production.

### Source Register And Comparisons

The **Sources / Bronnen** page at `/sources` brings the directory, collection policy, recorded scan status, stored listing counts, and linked duplicate counts together. Filter by platform name, region, country, language, collection method, and status; paginate results or export the current filtered page as JSON. Country and language labels describe directory coverage, not candidate eligibility. Unclassified metadata stays explicitly unknown.

The second tab compares existing linked duplicates for title, company, location, contract type, currency, and salary bounds. Missing data is separate from conflicting values; salary amounts are compared only within the same known currency. These are comparisons of the latest stored records, not immutable original snapshots or verified factual inconsistencies. Canonical listings can include updates from linked sources.

Without a connected database, the page explicitly identifies example vacancy counts and comparisons. A directory reference marked checked means the referenced site or documentation was reviewed, not that its scraper passed live acceptance. The directory is deliberately incomplete and does not claim to enumerate every platform worldwide. See [Source Intelligence](docs/SOURCE_INTELLIGENCE.md) for evidence, endpoints, collection limits, and remaining work.

See `server/scrapers/platformCatalog.ts` for policy decisions and `server/scrapers/index.ts` for registered parser adapters.

## Autonomy Model

Hire.AI uses automation to reduce repeated clerical work, not to bypass user consent or provider rules.

### What The Autonomous Logic Can Do

- scan approved job sources within configured rate, timeout, concurrency, and cycle-wide job budgets;
- normalize, bound, and deduplicate job records before persistence;
- evaluate profile readiness and job freshness;
- prepare application materials and internal ledger records;
- queue review items and approval records;
- generate follow-up drafts and next-action summaries;
- monitor connected inbox evidence where the user has authorized a provider;
- update autonomous run state, skipped reasons, and failure counters.

### What The Autonomous Logic Cannot Claim

- it cannot claim a job was submitted unless deterministic submission evidence is recorded;
- it cannot send follow-up mail merely because a draft exists;
- it cannot use disconnected or stale provider grants;
- it cannot apply to stale or inactive job listings;
- it cannot invent resume evidence, qualifications, salary facts, interview invitations, or offer evidence;
- it cannot scan providers marked manual, unavailable, marketplace, account-mediated, or unapproved.

The key engineering rule is that resource and safety limits are enforced at multiple boundaries: source policy, source request, parsing, aggregation, persistence, application preparation, review, and evidence recording.

## Connector And Provider Status

Hire.AI has connector policy and account records for several external systems, but live access is deployment-specific.

| Provider or system    | Current repository support                                                     | Production condition                                               |
| --------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Gmail                 | OAuth policy, encrypted grants, inbox-response discovery, disconnect cleanup   | Google OAuth app, approved redirect URI, scopes, test accounts     |
| Google Drive          | OAuth policy, resume-candidate discovery, encrypted grants, disconnect cleanup | Google OAuth app, Drive scopes, storage/privacy acceptance         |
| Dropbox               | OAuth policy, resume-candidate discovery, encrypted grants, disconnect cleanup | Dropbox OAuth app, approved scopes, provider acceptance            |
| Outlook / Microsoft   | OAuth policy and manual cleanup guidance                                       | Microsoft OAuth app, approved scopes, account-side cleanup process |
| LinkedIn              | OAuth/social-profile policy and manual cleanup guidance                        | Approved LinkedIn integration; no unattended scraping              |
| GitHub                | OAuth/profile-evidence policy and disconnect cleanup                           | GitHub OAuth app and user authorization                            |
| Stripe                | Checkout/session support, webhook ledger, fee/payment records                  | Stripe keys, webhook endpoint, legal/billing review                |
| S3-compatible storage | Private document storage helpers and upload validation                         | Bucket, credentials, malware scanner, retention approval           |
| HAI A2A               | Optional read-only status endpoint                                             | Private endpoint, strong bearer token, peer acceptance             |
| ngrok                 | Windows tunnel launcher and runtime identity readiness check                   | Reserved hostname, callback configuration, operator evidence       |

Every connector is disabled when credentials are absent. Partial or unsafe connector configuration fails closed.

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

If all connector variables are empty, connectors are intentionally disabled. If any connector value is configured, startup and `pnpm run doctor` fail closed unless shared OAuth controls and at least one complete provider credential pair are valid.

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
| `pnpm run doctor`                                           | Validate runtime configuration and fail-closed policies                  |
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
pnpm run doctor
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

The progress-publication check on **2026-10-03** passed TypeScript checking, the production build and 1,573 regular tests across 281 files. Two opt-in MySQL suites / 14 tests were skipped, not accepted in this run. The current dependency audit found **16 advisories (7 high, 8 moderate, 1 low)** and remains a merge blocker. Publication is not deployment or public-release acceptance. [Production Acceptance](docs/PRODUCTION_ACCEPTANCE.md) records these checks and the outstanding gates.

The first post-interview-specification increment was checked locally on 2026-09-06: ten focused follow-up tests and TypeScript checking passed. The tests used mocked storage/provider responses and covered retry blocking after an accepted Gmail response without an identifier. This is not live-mail acceptance, a full-suite rerun or deployment proof.

## Operational Evidence

The repository keeps operational evidence in source control instead of relying on README claims alone.

| Evidence area                              | Where to inspect it                                        |
| ------------------------------------------ | ---------------------------------------------------------- |
| Current implementation status              | `CURRENT_STATUS.md`                                        |
| Requirement completion and remaining gates | `docs/GOAL_COMPLETION_MATRIX.md`                           |
| Security controls and required reviews     | `docs/SECURITY.md`                                         |
| Operator procedures                        | `docs/OPERATOR_RUNBOOK.md`                                 |
| Acceptance tests and QA notes              | `docs/ACCEPTANCE_TESTS.md`, `END_USER_TESTING_FINDINGS.md` |
| API-level documentation                    | `docs/API_REFERENCE.md`                                    |
| Technical audit and debt                   | `docs/TECHNICAL_AUDIT.md`, `docs/TECHNICAL_DEBT.md`        |
| Windows/ngrok/HAI operation                | `docs/WINDOWS_NGROK_HAI.md`                                |
| Work history                               | `docs/CODEX_WORKLOG.md`, `docs/CODEX_CHECKPOINTS.md`       |

GitHub Actions is the source of truth for current CI status. Local verification and older CI run identifiers in the docs are evidence for those exact commits only; rerun verification after changes.

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
| [docs/PRODUCT_DIRECTION.md](docs/PRODUCT_DIRECTION.md) | Confirmed product decisions, commercial targets and unresolved gates |
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
4. Run `pnpm check`, `pnpm test`, `pnpm run doctor`, `pnpm security:audit`, and `pnpm build` where relevant.
5. Keep provider-live, payment-live, and external-submission claims separate from local/CI verification.
6. Do not commit secrets, private documents, generated local output, or provider tokens.

## License

`package.json` currently declares this project as MIT licensed.
