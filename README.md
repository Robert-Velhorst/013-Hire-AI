# 013 - Hire.AI

Hire.AI is an early-stage, self-hostable preview for discovering fully remote jobs, comparing likely cross-posts, and managing a job seeker's application preparation and interview journey. The long-term aim is to reduce repetitive work for people seeking any kind of work that can be performed fully remotely, across professions and experience levels.

> **Status: preview, not a public production service.** The first prerelease and public container package exist, but there is no generally available hosted Hire.AI service. Job discovery is limited to a small set of permitted API and RSS sources. Hire.AI does not currently fill or submit employer-portal applications on a user's behalf. Provider accounts, production identity, public HTTPS deployment, and legal/privacy acceptance are not complete.

**Quick links:** [preview release](https://github.com/Robert-Velhorst/013-Hire-AI/releases/tag/v0.1.0-alpha.1) · [container package](https://github.com/users/Robert-Velhorst/packages/container/package/013-hire-ai) · [security reporting](https://github.com/Robert-Velhorst/013-Hire-AI/security/advisories/new) · [production checklist](docs/PRODUCTION_ACCEPTANCE.md)

## What Hire.AI Is

For a job seeker, Hire.AI brings profile evidence, resumes, remote listings, fit explanations, duplicate comparisons, prepared materials, application records, employer-response tracking, and interview preparation into one auditable workflow. The intended service should minimize user effort while respecting hard requirements and producing a small number of well-matched opportunities rather than maximizing application volume.

The planned service covers discovery through interview scheduling and preparation. The candidate attends the interview. Negotiation, offers, employment-contract decisions, signatures, and everything after the interview remain the candidate's responsibility. These are product goals, not a claim that every step is currently automated.

## Current Capabilities And Boundaries

The repository contains working foundations for:

- Candidate accounts, profiles, experience, education, skills, preferences, and versioned resume workflows.
- Remote job search, source attribution and freshness, available filters, match evidence, saved jobs, and likely cross-post relationships.
- Application preparation, review and handoff records, status tracking, response evidence, interview scheduling/preparation, and follow-up workflows.
- Opt-in background workflows with source policies, evidence gates, audit records, and operational status.
- Optional, consent-scoped account connectors; private document storage and malware-scanning boundaries; privacy export and deletion-review tools.
- English and Dutch interfaces, admin/operator surfaces, a TypeScript API, MySQL persistence, Docker packaging, and Windows launch tooling.

Those foundations do not mean that external providers have been configured or accepted. In particular:

- Employer or ATS forms are not automatically completed or submitted. The current application flow is review-first and hands off external submission to the candidate.
- No guarantee is made that a listing is accurate, that two posts are duplicates, that a candidate will receive an interview, or that anyone will get or keep a job.
- The source catalog is not universal coverage or permission to scrape every website. Some entries are manual-only, unavailable, account-gated, or awaiting authorization.
- Email, identity, AI, payment, cloud-document, storage, and malware-scanner code is not proof of a live, consented, production-tested integration.
- Billing is not an active offer. The proposed success contribution and prepaid-credit models need jurisdiction-specific legal, tax, consumer, and contract review. Legacy billing code must not be used to charge users.

The approved product target and unresolved decisions are maintained in [docs/PRODUCT_DIRECTION.md](docs/PRODUCT_DIRECTION.md). Current implementation evidence and release blockers are in [docs/PRODUCTION_ACCEPTANCE.md](docs/PRODUCTION_ACCEPTANCE.md) and [docs/GOAL_COMPLETION_MATRIX.md](docs/GOAL_COMPLETION_MATRIX.md).

## Job Sources, Search, And Duplicate Analysis

The catalog contains approximately 90 source records for provenance and possible future coverage. Nine sources are currently eligible for automated API/RSS discovery under the checked-in policy: RemoteOK, Remotive, Jobicy, Arbeitnow, Arbeitnow UK, Himalayas, We Work Remotely, NoDesk, and ProBlogger. The job-discovery scheduler is disabled by default. Policy eligibility is not proof that a provider was contacted successfully, that current listings are available, or that every source permits every use.

| Eligible source                                                | Collection path                                                         |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| RemoteOK, Remotive, Jobicy, Arbeitnow, Arbeitnow UK, Himalayas | Source-specific public API adapters with provider and pagination limits |
| We Work Remotely, NoDesk, ProBlogger                           | RSS feed adapters                                                       |

Catalog entries include global and regional job boards, employer/job directories, and freelance marketplaces. Their presence does not establish a working adapter or permission to scrape. Working Nomads remains excluded from automatic collection pending written authorization. Operators must check provider terms, access rules, rate limits, attribution, and applicable privacy requirements before enabling a source. Hire.AI must not bypass logins, CAPTCHAs, or other access controls.

Listings are normalized and recorded with source provenance. Stable source IDs refresh known records; available title, employer, location, contract, currency, and salary evidence can link likely cross-posts. This is evidence-based comparison, not perfect identity resolution: source records remain traceable, missing/conflicting values stay visible, and a repost does not authorize a second application. See [docs/SOURCE_INTELLIGENCE.md](docs/SOURCE_INTELLIGENCE.md) for the comparison rules and coverage gaps.

Search filters include available fields such as keywords, company, location, employment type, source, salary minimum/maximum and currency, remote eligibility, experience level, application method, visa support, open-hiring signals, diversity-friendly signals, disclosed salary, listing age, and safety status. The exact options depend on the records and source data; filters cannot recover information the source did not provide. Unknown or contradictory values do not satisfy a hard preference.

## Candidate Workflow

1. Create a profile and add accurate work history, education, skills, preferences, and resume versions. Imports require the corresponding connection, consent, and deployment configuration.
2. Search configured sources, apply available filters, and inspect source, freshness, fit evidence, and likely duplicate records.
3. Review the job and application readiness. Missing decisive conditions should be clarified before proceeding; if employer information is unavailable, the user decides whether to make an exception.
4. Prepare application materials and review the handoff. The candidate currently completes the employer's form, submits it, and records reliable confirmation evidence.
5. Track employer responses and prepare for an interview. Connected inbox features require real account setup and acceptance; an invitation is not treated as real without evidence.
6. Stop job-search automation when the user reports employment. Restart is intended to require a reason and current criteria. These rules are product requirements; production enforcement and acceptance are not complete.

The user's authority is required for external actions. Ambiguous send or submission outcomes must be reconciled rather than blindly retried or reported as success. The user conducts the interview; Hire.AI's intended authority ends there.

## Integrations

| Service or area       | Repository support                                          | What remains before real use                                                                      |
| --------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Job boards            | Nine policy-enabled API/RSS sources plus a broader catalog  | Source-specific terms, current access, reliability, regional coverage, and operational acceptance |
| Gmail / Google Drive  | Consent-scoped connector and candidate-evidence foundations | Google app, approved scopes, callback, storage decision, consent, and live-account tests          |
| Dropbox               | Connector/document-candidate foundations                    | Approved Dropbox app/scopes, consent, storage controls, and live-account tests                    |
| Outlook / Microsoft   | Connector policy and cleanup guidance                       | Registered application, approved scopes, and tested read/revoke/cleanup paths                     |
| LinkedIn / GitHub     | Profile-reference and connector policy                      | Approved applications/scopes and live acceptance; unattended LinkedIn job scraping is not claimed |
| AI provider           | Server-side adapter boundary                                | Credentials, data-processing review, budget controls, and provider acceptance                     |
| Malware scanning      | Windows Defender and bounded HTTP scanner integration       | A production scanner, network allowlist, failure tests, and operational monitoring                |
| S3-compatible storage | Private document-storage integration                        | Bucket and least-privilege policy, retention, malware scanning, and recovery tests                |
| Stripe                | Legacy checkout/webhook code                                | Legal/commercial decision and a separate implementation review; do not enable charging            |

No integration is live merely because code or environment-variable names exist. Supply credentials only through managed secret storage after consent and provider approval. Review [`.env.example`](.env.example) and the [operator runbook](docs/OPERATOR_RUNBOOK.md) for configuration contracts.

## Architecture

```text
React + Vite browser client
        | tRPC / HTTP
Express + Node.js API
        |-- authentication, authorization, profiles, jobs, applications
        |-- source adapters, scheduling, comparisons, audit and privacy
        |-- consent-scoped connector routes and optional read-only HAI API
        | Drizzle ORM
MySQL / TiDB
        | private object storage (deployment integration)
```

| Layer      | Main technologies                                                             |
| ---------- | ----------------------------------------------------------------------------- |
| Web client | React 19, Vite, TypeScript, Tailwind CSS, Radix UI, TanStack Query, Wouter    |
| API        | Node.js 22, Express 4, tRPC 11, TypeScript ESM                                |
| Data       | MySQL/TiDB, Drizzle ORM, ordered SQL migrations                               |
| Documents  | S3-compatible private storage integration, PDF/DOCX parsing and validation    |
| Testing    | Vitest, type checks, isolated MySQL acceptance, Windows and container CI      |
| Delivery   | GitHub Actions, Docker/OCI container, Hetzner templates, PowerShell launchers |

The optional HAI A2A-shaped endpoint is disabled by default, bearer-authenticated, scoped to one user, read-only, and limited to status and remote-job discovery. It is not an application-submission API. The main API is tRPC under `/api/trpc`; details are in [docs/API_REFERENCE.md](docs/API_REFERENCE.md).

## Repository Layout

```text
client/                 React pages and UI
server/                 Express/tRPC API, domain logic, integrations, tests
server/scrapers/         Source catalog, collection policy, adapters, scheduler
shared/                  Shared types and policy logic
drizzle/                 Database schema and migrations
scripts/                 Runtime checks, migrations, audits, backups, Windows tools
deploy/hetzner/           Private deployment templates and operator instructions
docs/                     Product, source, API, security, operations and acceptance docs
.github/workflows/        CI, CodeQL and container publication workflows
Dockerfile                Multi-stage container build
```

## Run Locally

### Requirements

- Node.js 22 or newer.
- pnpm 11.16.0, as pinned by the repository's package metadata.
- MySQL 8.4 or a compatible TiDB deployment for persistent workflows.
- Optional provider accounts only for the integration being developed.

### Install and start (PowerShell)

```powershell
git clone https://github.com/Robert-Velhorst/013-Hire-AI.git
cd 013-Hire-AI
corepack enable
corepack prepare pnpm@11.16.0 --activate
pnpm install --frozen-lockfile
Copy-Item .env.example .env
```

Set a local development database in `.env`, then migrate and start:

```powershell
$env:DATABASE_URL = "mysql://user:password@localhost:3306/hire_ai"
pnpm db:migrate
pnpm dev
```

The development server defaults to `http://localhost:3000`. The example database URL is illustrative; use a local disposable database and a private secret file. Do not commit `.env`. Some development screens can display explicitly labelled sample data, but configured database failures must not be mistaken for live persisted results. Run `pnpm run doctor` to identify configuration issues.

### Check and build

```powershell
pnpm check
pnpm test
pnpm run doctor
pnpm security:audit
pnpm build
pnpm start
```

`pnpm test` runs the regular Vitest suite. Real-MySQL acceptance is opt-in and must use an isolated disposable database; see [docs/OPERATOR_RUNBOOK.md](docs/OPERATOR_RUNBOOK.md). A successful local check or build is not production or provider acceptance.

## Configuration And Useful Commands

`.env.example` is the complete starting point; validate current names and constraints there and in the runtime configuration before deployment.

| Variable group                                                                        | Purpose                                              |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `DATABASE_URL`, `DATABASE_POOL_*`                                                     | Persistent MySQL/TiDB connection and bounded pool    |
| `PUBLIC_APP_ORIGIN`, `JWT_SECRET`, `SESSION_TTL_MS`                                   | Public origin and signed-session policy              |
| `OAUTH_SERVER_*`, `OAUTH_PORTAL_URL`, `OWNER_OPEN_ID`                                 | Hosted identity service and owner bootstrap          |
| `CONNECTOR_OAUTH_*`, `GOOGLE_*`, `DROPBOX_*`, `MICROSOFT_*`, `LINKEDIN_*`, `GITHUB_*` | Optional consent-scoped connector setup              |
| `FILE_MALWARE_SCAN_*`, `AWS_*`                                                        | Malware scanning and private object storage          |
| `JOB_SCRAPING_*`, `AUTONOMOUS_SCHEDULER_ENABLED`                                      | Disabled-by-default source/workflow scheduling       |
| `HAI_CONNECTOR_*`                                                                     | Optional local/private read-only HAI API             |
| `BUILT_IN_FORGE_API_*`                                                                | Optional server-side AI adapter                      |
| `STRIPE_*`                                                                            | Legacy payment paths; not an authorization to charge |

| Command                                                      | Purpose                                                     |
| ------------------------------------------------------------ | ----------------------------------------------------------- |
| `pnpm dev`                                                   | Start development mode                                      |
| `pnpm check`                                                 | TypeScript check                                            |
| `pnpm test`                                                  | Regular Vitest suite                                        |
| `pnpm test:database`                                         | Opt-in isolated-MySQL acceptance tests                      |
| `pnpm run doctor`                                            | Validate runtime/security configuration                     |
| `pnpm security:audit`                                        | Audit installed dependencies at moderate severity and above |
| `pnpm build` / `pnpm start`                                  | Build and start production-mode application                 |
| `pnpm db:generate` / `pnpm db:migrate`                       | Generate or apply ordered schema migrations                 |
| `pnpm db:backup`, `pnpm db:backup:verify`, `pnpm db:restore` | Create, validate, and explicitly restore database backups   |
| `pnpm db:audit-schema`, `pnpm db:audit-query-plans`          | Audit the built database schema and query plans             |
| `pnpm start:windows`, `pnpm start:ngrok`                     | Use the Windows launcher or optional ngrok workflow         |

Never run acceptance or restore commands against a live database without a reviewed, explicit recovery plan.

## Security And Privacy

Hire.AI processes sensitive profile, resume, employment, salary, and provider-authorization data. Application controls include signed HttpOnly sessions, account/role checks, owner-scoped mutations, encrypted connector grants, fail-closed OAuth configuration, bounded uploads and scanner requirements, request budgets, audit/idempotency records, privacy export/deletion-review workflows, and constrained browser security headers. These are implementation controls, not independent security certification. Rate limits are process-local; multi-replica hosting requires a shared atomic limiter.

GitHub's repository-security settings and current alert counts are recorded in [docs/SECURITY.md](docs/SECURITY.md). The [live Security tab](https://github.com/Robert-Velhorst/013-Hire-AI/security) is authoritative because settings and alerts change. A completed CodeQL run means analysis completed; it does not mean every alert was fixed. Report vulnerabilities through [private vulnerability reporting](https://github.com/Robert-Velhorst/013-Hire-AI/security/advisories/new), not a public issue.

Before production, complete the remaining work in [docs/PRODUCTION_ACCEPTANCE.md](docs/PRODUCTION_ACCEPTANCE.md): real identity and provider acceptance, private storage and malware scanning, legal/privacy and license review, backup/restore drills, monitoring, deployment/TLS testing, accessibility and independent security review. **Production acceptance is not complete.**

## Release And Container Package

The first preview release is [`v0.1.0-alpha.1`](https://github.com/Robert-Velhorst/013-Hire-AI/releases/tag/v0.1.0-alpha.1). Publishing a GitHub release triggers the container workflow, which publishes the Dockerfile build to [GitHub Container Registry](https://github.com/users/Robert-Velhorst/packages/container/package/013-hire-ai). The public package contains the `v0.1.0-alpha.1` tag; its public OCI manifest was verified for Linux AMD64 only. It is an evaluation/self-hosting artifact, not a hosted service or production approval.

```powershell
docker pull ghcr.io/robert-velhorst/013-hire-ai:v0.1.0-alpha.1
```

Pin a release tag or immutable image digest; do not rely on mutable tags. Before deploying, review migrations, secret injection, TLS/proxy trust, database exposure, storage/scanning, OAuth callbacks, backups, monitoring, and provider terms. See [deploy/hetzner/README.md](deploy/hetzner/README.md). Confirm CI and the image-publishing workflow for the exact release commit.

## GitHub CI And Security Checks

Pull requests and pushes to `main` run five named checks: Hetzner bootstrap validation, build/type-check/tests, Windows runtime, isolated database acceptance, and container runtime. The repository also runs CodeQL and Dependabot. GitHub Actions uses read-only default token permissions, an allow-list of workflow actions, and full-SHA action references. Current branch and security settings are summarized in [docs/SECURITY.md](docs/SECURITY.md); GitHub is the source of truth for a particular commit or run.

## Documentation

| Document                                                         | Purpose                                                                |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md)                         | Candidate-facing workflow guide                                        |
| [docs/PRODUCT_DIRECTION.md](docs/PRODUCT_DIRECTION.md)           | Approved product and commercial direction; not implementation evidence |
| [docs/SOURCE_INTELLIGENCE.md](docs/SOURCE_INTELLIGENCE.md)       | Catalog policy, source evidence, duplicate analysis, and coverage gaps |
| [docs/API_REFERENCE.md](docs/API_REFERENCE.md)                   | API and integration contracts                                          |
| [docs/SECURITY.md](docs/SECURITY.md)                             | Application controls and live GitHub security snapshot                 |
| [docs/PRODUCTION_ACCEPTANCE.md](docs/PRODUCTION_ACCEPTANCE.md)   | Evidence, release blockers, and acceptance checklist                   |
| [docs/GOAL_COMPLETION_MATRIX.md](docs/GOAL_COMPLETION_MATRIX.md) | Product requirements mapped to evidence and gaps                       |
| [docs/OPERATOR_RUNBOOK.md](docs/OPERATOR_RUNBOOK.md)             | Operations, migrations, backup/restore, and runtime controls           |
| [deploy/hetzner/README.md](deploy/hetzner/README.md)             | Private Hetzner deployment procedure                                   |
| [SECURITY.md](SECURITY.md)                                       | Vulnerability reporting policy                                         |

## Contributing

Use focused branches and pull requests. Keep secrets, private documents, local databases, generated browser exports, logs, and build output out of commits. Add regression tests for behavior changes; preserve consent, ownership, source-policy, audit, and privacy boundaries. CI must pass on the exact pull-request revision. Review migration ordering and recovery implications before proposing schema changes. Do not describe a catalog entry, mocked test, successful build, or configured integration as live-provider acceptance.

## License

`package.json` declares `MIT`, but the repository currently has no root `LICENSE` file. The license metadata alone is not a complete license grant. Confirm the intended licensing and add the full license text before inviting third-party redistribution.
