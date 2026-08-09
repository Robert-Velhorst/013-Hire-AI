# Hire.AI — Automated Remote Job Aggregation Platform

> **Job hunting done right.** Hire.AI is an AI-assisted job-search operating platform. It discovers listings from configured supported sources, prepares reviewable application materials, and keeps decisions, evidence, follow-ups, and responses in one ledger. External applications and follow-ups remain explicitly approved and confirmed by the user.

---

## Table of Contents

- [Overview](#overview)
- [Business Model](#business-model)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Key Features](#key-features)
- [Database Schema](#database-schema)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Scripts](#scripts)
- [API Reference](#api-reference)
- [Testing](#testing)
- [Deployment](#deployment)

## Operational Evidence

The current audited status is maintained in [CURRENT_STATUS.md](./CURRENT_STATUS.md). The production-readiness evidence set is in [`docs/`](./docs), including the [critical path](./docs/CRITICAL_PATH.md), [security boundary](./docs/SECURITY.md), [operator runbook](./docs/OPERATOR_RUNBOOK.md), and [completion matrix](./docs/GOAL_COMPLETION_MATRIX.md). These documents describe the review-first product as it exists; they do not imply that unconfigured providers are live.

Native Windows 11 startup, verified ngrok tunnelling, and the restricted HAI A2A connector are documented in [Windows, ngrok, and HAI operation](./docs/WINDOWS_NGROK_HAI.md).

Checksummed MySQL backup and target-confirmed restore commands are documented in the [operator runbook](./docs/OPERATOR_RUNBOOK.md). The tooling has passed a local two-container isolated restore drill; repeat it against the actual deployment and off-host retention system before production launch.

---

## Overview

Hire.AI is a review-first job-search operating ledger. Users create a profile, upload a versioned resume, discover normalized roles from configured sources, and prepare tailored materials without fabricating qualifications or performing unattended employer-portal submissions.

The platform tracks every application in a unified dashboard with evidence, approvals, follow-ups, responses, interviews, and compliance work connected to the originating role. Notifications are limited to recorded interview-invite evidence.

---

## Business Model

Hire.AI operates on a **success-based fee model** — there are no upfront costs, subscriptions, or credit packs.

| Event | Fee |
|---|---|
| Using the platform | **Free** |
| Landing a job via Hire.AI | **5% of monthly salary, ongoing** |

### How it works

1. Hire.AI prepares job decisions and materials; the user reviews and confirms any consequential external handoff.
2. When they receive and accept an offer, they report the hire via the **"Report Hire"** flow.
3. They upload their offer letter as proof of employment and stated salary.
4. A Stripe recurring subscription is created for 5% of the monthly salary.
5. Every 90 days, the user must submit a **quarterly verification** (recent paystub or employment letter) to confirm continued employment.
6. If employment ends, the user reports it and the subscription is cancelled.

### Enforcement

- Minimum salary threshold: **$300/month** (minimum fee: $15/month).
- Quarterly verification is mandatory; failure to verify results in account suspension.
- Non-payment or misreporting is a breach of the Terms of Service and subject to legal action.
- All users must accept the Terms of Service on first login before accessing the platform.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, Tailwind CSS 4, shadcn/ui, Radix UI |
| **Backend** | Node.js 22, Express 4, tRPC 11 |
| **Database** | MySQL / TiDB (via Drizzle ORM) |
| **Auth** | Manus OAuth 2.0 (JWT session cookies) |
| **Payments** | Stripe (recurring subscriptions, webhooks) |
| **File Storage** | AWS S3 (resumes, offer letters, verification docs) |
| **AI / LLM** | Manus built-in LLM API (GPT-class, server-side) |
| **Resume Parsing** | pdf-parse (PDF), mammoth (DOCX), LLM structured extraction |
| **Type Safety** | TypeScript end-to-end (tRPC + Superjson) |
| **Testing** | Vitest (unit and integration coverage across the operating ledger) |
| **Build** | Vite (frontend), esbuild (server) |

---

## Architecture

```
Browser (React 19 + Vite)
        │
        │  tRPC over HTTP (/api/trpc)
        ▼
Express 4 Server (Node.js 22 ESM)
        │
        ├── tRPC Router (server/routers.ts)
        │     ├── auth.*          — OAuth, session, ToS acceptance
        │     ├── jobs.*          — Job scanning, matching, saved jobs
        │     ├── applications.*  — Application tracking, status updates
        │     ├── profile.*       — User profile, resume upload/parse
        │     ├── successFees.*   — Report hire, quarterly verification
        │     ├── admin.*         — Admin panel, legal escalation
        │     └── system.*        — Owner notifications
        │
        ├── Stripe Webhook (/api/stripe/webhook)
        │     — Handles payment success/failure, subscription events
        │
        ├── Drizzle ORM → MySQL / TiDB
        └── AWS S3 → File storage (resumes, offer letters, docs)
```

---

## Key Features

### For Job Seekers

- **Controlled Job Discovery** — Normalizes and deduplicates listings from configured, ready remote-job sources while exposing freshness and source coverage.
- **AI Job Matching** — Scores listings against the candidate profile and saved policy, with review reasons and evidence gates.
- **Review-Gated Application Preparation** — Creates tailored materials and internal approval work; Hire.AI never claims an employer submission without deterministic evidence or explicit manual confirmation.
- **Resume Parsing** — Upload PDF or DOCX; AI extracts and populates the profile automatically
- **Cloud Resume Discovery** — After explicit Google Drive or Dropbox authorization, lists only supported resume candidates and imports a user-selected file through the same validated, versioned resume ledger.
- **Unified Operating Ledger** — Connects source platform, decisions, materials, submission evidence, responses, follow-ups, interviews, offer attribution, and compliance work.
- **Saved Jobs** — Bookmark interesting listings for manual review
- **AI Preferences** — Configure controlled preparation, daily review limits, discovery policy, and job preferences
- **Job Alerts** — Configure matching preferences for new high-match listings; candidates review matches in the command center, while user notifications are reserved for verified interview invites
- **Career Intelligence** — Salary benchmarking, skill gap analysis, and market insights

### For Platform Operators (Admin)

- **Admin Panel** (`/admin`) — Full visibility into all active success fees, overdue verifications, non-compliant accounts, and revenue metrics
- **Legal Escalation Queue** — Flag accounts for legal action with notes
- **Account Suspension Controls** — Suspend/reinstate user accounts
- **Revenue Dashboard** — Total monthly recurring fees, outstanding amounts, total collected

---

## Database Schema

| Table | Purpose |
|---|---|
| `users` | User accounts, OAuth identity, role (admin/user), ToS acceptance, Stripe customer ID, account status |
| `jobs` | Scraped job listings with metadata (title, company, salary, platform, match score) |
| `applications` | Application records linked to job, platform, status, and provenance |
| `application_decisions` | Persisted apply/save/ignore/review decisions with match and risk rationale |
| `application_materials` | Resume version, cover letter, custom answers, claims, and profile snapshot used for preparation |
| `application_attempts` / `submission_evidence` | Internal attempts and deterministic proof required before a submission is recorded |
| `application_approvals` / `audit_events` | Approval gates and traceable consequential-action history |
| `saved_jobs` | User-bookmarked job listings |
| `user_profiles` | Extended profile (skills, experience, education, resume URL, preferences) |
| `success_fees` | Active success fee agreements (salary, fee amount, Stripe subscription ID, next verification due) |
| `employment_verifications` | Quarterly verification documents (offer letters, paystubs, employment letters) |
| `fee_payments` | Stripe payment records for success fees |

---

## Project Structure

```
hire_ai_v2/
├── client/
│   ├── public/                  # Static assets
│   └── src/
│       ├── components/          # Reusable UI components
│       │   ├── AIChatBox.tsx    # Full-featured AI chat interface
│       │   ├── DashboardLayout.tsx
│       │   ├── ReportHireDialog.tsx   # Hire reporting + offer letter upload
│       │   └── TosAcceptanceDialog.tsx  # First-login ToS gate
│       ├── pages/
│       │   ├── LandingPage.tsx  # Public marketing page
│       │   ├── Dashboard.tsx    # Main user dashboard (metrics + applications)
│       │   ├── Profile.tsx      # User profile management
│       │   ├── Billing.tsx      # Success fee management + payment history
│       │   ├── AdminPanel.tsx   # Admin-only management panel
│       │   ├── TermsOfService.tsx
│       │   ├── Settings.tsx
│       │   └── SavedJobs.tsx
│       ├── contexts/            # React contexts (auth, theme)
│       ├── hooks/               # Custom hooks
│       ├── lib/trpc.ts          # tRPC client binding
│       ├── App.tsx              # Routes & layout
│       └── index.css            # Global styles + Tailwind theme
│
├── server/
│   ├── _core/                   # Framework plumbing (OAuth, context, LLM, maps)
│   ├── routers/
│   │   ├── admin.ts             # Admin procedures (protected, admin-only)
│   │   └── successFees.ts       # Success fee procedures
│   ├── routers.ts               # Main tRPC router (all procedures)
│   ├── db.ts                    # Drizzle query helpers
│   ├── aiMatching.ts            # AI job matching engine
│   ├── applicationAutomation.ts # Autonomous application submission
│   ├── browserAutomation.ts     # Approval-gated manual employer-portal handoff
│   ├── careerIntelligence.ts    # Salary benchmarking, skill gap analysis
│   ├── jobNormalization.ts      # Normalise job data across platforms
│   ├── realTimeDiscovery.ts     # Live job board scanning
│   ├── resumeParser.ts          # PDF/DOCX resume parsing with LLM
│   ├── resumeStorage.ts         # S3 resume upload helpers
│   ├── stripeWebhook.ts         # Stripe webhook handler
│   ├── successFees.ts           # Success fee business logic
│   └── storage.ts               # S3 file storage helpers
│
├── drizzle/
│   ├── schema.ts                # Database schema (source of truth)
│   ├── relations.ts             # Drizzle relations
│   └── migrations/              # Auto-generated SQL migrations
│
├── shared/                      # Shared types and constants
├── todo.md                      # Feature tracking
└── package.json
```

---

## Getting Started

### Prerequisites

- Node.js 22+
- pnpm 9+
- MySQL or TiDB database
- Stripe account (for success fee billing)
- AWS S3 bucket (for file storage)
- Manus OAuth credentials (for authentication)

### Installation

```bash
# Clone the repository
git clone https://github.com/Noodzakelijk-Online/013-Hire-AI.git
cd 013-Hire-AI

# Install dependencies
pnpm install

# Apply committed database migrations
pnpm db:migrate

# Generate a new migration after an intentional schema change
pnpm db:generate

# Start the development server
pnpm dev
```

The app will be available at `http://localhost:3000`.

---

## Environment Variables

All secrets are injected at runtime via the platform. Do **not** commit `.env` files.

| Variable | Description |
|---|---|
| `DATABASE_URL` | MySQL/TiDB connection string |
| `JWT_SECRET` | Session cookie signing secret |
| `VITE_APP_ID` | Manus OAuth application ID |
| `OAUTH_SERVER_URL` | Manus OAuth backend base URL |
| `VITE_OAUTH_PORTAL_URL` | Manus login portal URL (frontend) |
| `OWNER_OPEN_ID` | Platform owner's Manus Open ID |
| `OWNER_NAME` | Platform owner's display name |
| `BUILT_IN_FORGE_API_URL` | Manus built-in API base URL (LLM, storage, notifications) |
| `BUILT_IN_FORGE_API_KEY` | Bearer token for server-side Manus API calls |
| `VITE_FRONTEND_FORGE_API_KEY` | Bearer token for frontend Manus API calls |
| `VITE_FRONTEND_FORGE_API_URL` | Manus API URL for frontend |
| `STRIPE_SECRET_KEY` | Stripe secret key (server-side) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (frontend) |
| `CONNECTOR_OAUTH_REDIRECT_URI` | Exact HTTPS callback URL for `/api/connectors/oauth/callback` (localhost is allowed for development) |
| `CONNECTOR_TOKEN_ENCRYPTION_KEY` | Base64-encoded 32-byte key used only to encrypt external OAuth tokens at rest |
| `CONNECTOR_OAUTH_STATE_SECRET` | Optional dedicated state-signing secret; defaults to the session secret only outside production |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Gmail and Google Drive OAuth credentials |
| `DROPBOX_OAUTH_CLIENT_ID` / `DROPBOX_OAUTH_CLIENT_SECRET` | Dropbox OAuth credentials |
| `MICROSOFT_OAUTH_CLIENT_ID` / `MICROSOFT_OAUTH_CLIENT_SECRET` | Outlook OAuth credentials |
| `LINKEDIN_OAUTH_CLIENT_ID` / `LINKEDIN_OAUTH_CLIENT_SECRET` | LinkedIn OAuth credentials |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth credentials |

External connectors remain unavailable until their provider credentials, shared callback URL, state secret, and token-encryption key are configured. Authorization grants are encrypted before persistence, never exposed through tRPC, and deleted when the user disconnects the provider.

---

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start development server (port 3000) |
| `pnpm build` | Build for production |
| `pnpm start` | Start production server |
| `pnpm test` | Run all Vitest tests |
| `pnpm db:generate` | Generate a migration after an intentional schema change |
| `pnpm db:migrate` | Apply committed database migrations |
| `pnpm db:backup` | Create an atomic checksummed MySQL backup bundle |
| `pnpm db:backup:verify -- <directory>` | Verify backup size and SHA-256 manifest evidence |
| `pnpm db:restore -- <directory> --confirm RESTORE:<database>` | Restore a verified bundle into an explicitly matched target |
| `pnpm db:push` | Backward-compatible alias for applying committed migrations |
| `pnpm check` | TypeScript type checking |
| `pnpm format` | Format code with Prettier |

---

## API Reference

All API calls go through tRPC at `/api/trpc`. The full type-safe contract is defined in `server/routers.ts`. Key procedure groups:

| Namespace | Procedures |
|---|---|
| `auth` | `me`, `logout`, `acceptTos` |
| `jobs` | `list`, `getMatches`, `getSources`, `getDiscoveryStatus`, `saveJob`, `unsaveJob`, `getSaved` |
| `applications` | `list`, `getOperatingLedger`, `decide`, `prepare`, `confirmSubmission`, `recordResponse`, `createFollowUpDraft`, `scheduleInterview` |
| `profile` | `get`, `getReadiness`, `update`, `uploadResume`, `parseResume` |
| `successFees` | `reportHire`, `getActive`, `submitVerification`, `reportEnded`, `getPaymentHistory`, `createStripeSession` |
| `admin` | `getActiveFees`, `getOverdueVerifications`, `getFailedPayments`, `suspendAccount`, `reinstateAccount`, `flagForLegalAction`, `getRevenueMetrics` |
| `system` | `notifyOwner` |

---

## Testing

The project uses [Vitest](https://vitest.dev/) for unit and integration testing.

```bash
pnpm test
```

Run the suite before deployment so the current repository test count and results remain authoritative:

| Test File | Coverage |
|---|---|
| `server/auth.logout.test.ts` | Auth flow, session management |
| `server/platforms.test.ts` | Job platform scrapers |
| `server/careerIntelligence.test.ts` | AI matching, career analysis |
| `server/comprehensive.test.ts` | End-to-end feature flows |
| `server/successFees.test.ts` | Success fee business logic and compliance controls |
| `server/tos.admin.test.ts` | ToS acceptance, admin access control |

---

## Deployment

The application is deployed on [Manus](https://manus.im) with built-in hosting.

**Live URL:** [hireai-job-efj8ydck.manus.space](https://hireai-job-efj8ydck.manus.space)

The production runtime is a Node.js-only Cloud Run container (no Python, no native binaries beyond npm packages). Key constraints:

- **Runtime:** Node.js 22 ESM
- **Memory:** 512 MiB
- **CPU:** 1 vCPU
- **Request timeout:** 180 seconds
- **Cold starts:** Enabled (min-instances=0)

> **Note for contributors:** All CJS npm packages must be loaded via `createRequire(import.meta.url)` rather than ESM `import ... from` syntax to avoid `ERR_MODULE_NOT_FOUND` in the production ESM build. See `server/resumeParser.ts` for the established pattern.

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes and add tests
4. Ensure all tests pass (`pnpm test`) and TypeScript compiles (`pnpm check`)
5. Submit a pull request

---

## License

Proprietary — All rights reserved. © 2026 Noodzakelijk Online.
