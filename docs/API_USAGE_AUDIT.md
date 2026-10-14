# API Usage Audit

All application API calls use `/api/trpc`. Public procedures are limited to unauthenticated status and discovery surfaces; user-owned records use `protectedProcedure`; operator operations use `adminProcedure`.

## HTTP operational endpoints

- `GET /healthz`: liveness only; returns no credentials or provider internals.
- `GET /readyz`: bounded configuration and database readiness status plus an opaque per-process instance ID used to bind local and public ngrok verification. Database checks are coalesced and cached; a caller timeout does not permit another probe until the underlying database operation settles, preventing polling from accumulating pool work. Development explicitly reports `development_memory` when no database is configured. A configured but unavailable database and incomplete production configuration return `503`; errors expose no connection details.
- `/api/oauth/callback` and `/api/connectors/oauth/callback`: provider callback boundaries.
- `/api/stripe/webhook`: registered before JSON parsing to preserve signed raw request bodies.
- `/.well-known/agent-card.json`, `/api/hai/status`, `/api/hai/a2a`, and `/api/hai/jobs/search`: disabled-by-default HAI bridge. Protected routes require a separate bearer token; JSON requests use a 16 KiB parser before the general 16 MiB application parser. Job search is read-only, limited to 25 canonical, current, safety-cleared remote listings, and exposes only bounded public listing fields.

## High-risk action controls

- Application preparation requires a current job, a versioned active resume, profile readiness, and review artifacts.
- Submission, follow-up delivery, and employer response records use deterministic evidence and audit events.
- Connector account states are separate from encrypted authorization storage; user-facing APIs never return grants.
- Privacy exports are owned by the current session and exclude OAuth grants, private object keys, signed download URLs, and document bytes.
- Privacy deletion requests are session-owned and expose only bounded status fields. Operator descriptions, assignments, and resolution text do not cross the user API or exported audit-event boundary.
- Privacy erasure previews are admin-only, require a privacy review, classify every known user-owned table, expose counts rather than record contents, and remain non-executable until legal retention and provider/object deletion controls are approved.
- HAI status returns bounded aggregate data for one configured user. The separate job-search route returns only current canonical public job listings that pass remote-only and safety filters; it has no user-profile or application access. Unsupported fields, files, URLs, metadata, oversized input, invalid versions, disabled state, and bad tokens are rejected before application state reads.
