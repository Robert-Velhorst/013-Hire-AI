# Hire.AI Current Status

Last updated: 2026-08-09

## Plain-English status

Hire.AI is currently a strong prototype / MVP foundation, not a production-ready autonomous hiring platform.

The repository contains useful foundations for:

- user authentication and profiles;
- job records and matching logic;
- saved jobs and application tracking;
- resume upload and parsing flows;
- success-fee reporting and billing flows;
- admin review and compliance workflows;
- controlled job discovery, approval, and manual-handoff flows.

The current baseline also includes a versioned privacy metadata export, a user-owned account-deletion review and cancellation workflow, operator retention decisions, an exhaustive retention-policy registry, an admin-only record-count preview, a production-readiness endpoint, response security headers, an environment doctor command, and a container build definition. Review resolution and previewing do not execute erasure, and these improvements do not remove the external authorization, legal, data-retention, or provider-integration gates described below.

Windows-native startup now performs a production audit and health check, server binding defaults to loopback, a reserved ngrok tunnel can be health-verified, and an optional local/private HAI A2A connector exposes aggregate read-only status. These controls are implemented contracts, not evidence that a specific Windows host, ngrok domain, or HAI deployment has passed live acceptance.

English and Dutch account-language selection now persists in MySQL and localizes shared navigation and account headers, settings and privacy controls, saved jobs, job alerts, team governance, and not-found handling. Remaining workflow-page copy still requires translation plus native-speaker and accessibility review.

Account-backed workspaces now provide owner, administrator, and member roles; email-bound expiring invitations; single-owner transfer; bounded membership; audited role changes; and safe archival. Workspace membership intentionally does not share candidate profiles, documents, applications, or other candidate-domain records. That boundary requires a separate product and privacy design before collaboration can extend beyond governance.

However, several public-facing claims and status documents previously described features as complete even when the implementation was still partial, simulated, untested, or framework-level only.

## Important limitations

### Automated application submission

The active `server/applicationAutomation.ts` implementation returns a controlled review-only preparation result. It records no employer-portal submission and requires the user to complete the employer handoff and record deterministic confirmation evidence. Separate browser-automation scaffolding remains disabled because it is not a safe, tested production submission pipeline.

Until this is fixed and tested, the product should be described as an **AI-assisted job search and application preparation platform**, not as a fully autonomous auto-apply platform.

### Job-board coverage

The project includes a registry for many job platforms, but many use generic parsing logic. Generic parsing does not equal verified production coverage. Each platform needs acceptance tests and scraper-health monitoring before being claimed as reliable.

### Marketing claims

Hardcoded impact numbers, fake live activity, and unverified testimonials should not be presented as real user results. Any public claim should have an evidence source or be clearly labelled as demo/example content.

### Payments and legal compliance

The success-fee model handles sensitive salary, employment, and payment information. It now records duplicate-resistant webhook events and uses an explicit transition policy, but it still needs legal review, a privacy policy, and operational data-retention approval before launch.

## Hardening completed in this branch

- Added database-side ownership scoping for profile subrecords such as work experience, education, skills, and projects.
- Implemented real job-search filtering instead of ignoring search filters.
- Fixed job-match retrieval to respect `minScore` and sort strongest matches first.
- Changed quarterly verification submission so the next due date is only moved after admin approval, not merely after upload.
- Added production environment validation helpers.
- Added `.env.example`.
- Added GitHub Actions CI for install, type-check, tests, and build.
- Restricted every scraper control and status endpoint to administrators and added regular-user denial coverage.
- Added application ownership regressions for cross-user status mutation and preserved user scoping for notes, interviews, and follow-ups.
- Replaced public landing-page claims with review-first, evidence-backed product language.
- Added migrations for ownership constraints, payment uniqueness, the Stripe webhook ledger, bounded operating workloads, and account locale persistence.
- Added duplicate-resistant Stripe webhook claims, retry handling, payment audit events, and a success-fee state machine.
- Enforced sensitive-upload size, MIME, and signature validation; production uploads now require a configured malware scanner and retain only private storage references.
- Added an audited, user-scoped English/Dutch language preference and localized shared navigation/account controls.
- Added durable workspace governance with hashed one-time invitations, least-privilege role controls, ownership transfer, audit evidence, retention-policy coverage, and a Team screen.
- Added a verified Jobicy public-API adapter with fixture contracts, live schema evidence, remote location and keyword handling, annual-salary safeguards, and restart-safe hourly polling enforcement.
- Added a bounded Arbeitnow API adapter that ingests only explicit remote records, preserves the required provider backlink, and shares the atomic hourly polling controls; deployment still requires operator/legal acceptance of the current provider terms.
- Extended the persisted English/Dutch preference through saved jobs, job alerts, and not-found handling, including locale-aware dates, dynamic messages, and accessible alert controls.
- Localized the reusable account header and Team governance workflow, including role labels, invitations, membership changes, ownership transfer, archive confirmations, dates, and icon-only accessibility names.
- Localized the complete Settings workflow, including preference controls, privacy export, retention-safe deletion review status and confirmations, feedback messages, and accessible control names; the page now reuses the shared account header.

## Still required before production

1. Apply the complete migration history in each environment and verify existing records satisfy the constraints.
2. Configure a malware-scanner endpoint before accepting production document uploads.
3. Add real scraper tests and verified platform coverage.
4. Keep human review before any application submission or external handoff.
5. Obtain legal and privacy review before accepting real users.
6. Translate remaining product workflows and complete native-speaker/accessibility acceptance.

See [`docs/GOAL_COMPLETION_MATRIX.md`](./docs/GOAL_COMPLETION_MATRIX.md) for requirement-by-requirement evidence and [`docs/OPERATOR_RUNBOOK.md`](./docs/OPERATOR_RUNBOOK.md) for deployment controls.
