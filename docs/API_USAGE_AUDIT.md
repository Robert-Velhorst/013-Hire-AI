# API Usage Audit

All application API calls use `/api/trpc`. Public procedures are limited to unauthenticated status and discovery surfaces; user-owned records use `protectedProcedure`; operator operations use `adminProcedure`.

## HTTP operational endpoints

- `GET /healthz`: liveness only; returns no credentials or provider internals.
- `GET /readyz`: bounded configuration and database readiness status plus an opaque per-process instance ID used to bind local and public ngrok verification. Development explicitly reports `development_memory` when no database is configured. A configured but unavailable database and incomplete production configuration return `503`; errors expose no connection details.
- `/api/oauth/callback` and `/api/connectors/oauth/callback`: provider callback boundaries.
- `/api/stripe/webhook`: registered before JSON parsing to preserve signed raw request bodies.
- `/.well-known/agent-card.json`, `/api/hai/status`, and `/api/hai/a2a`: disabled-by-default HAI bridge. Status and JSON-RPC require a separate bearer token; the route uses its own 16 KiB parser before the general 16 MiB application parser.

## High-risk action controls

- Application preparation requires a current job, a versioned active resume, profile readiness, and review artifacts.
- Submission, follow-up delivery, and employer response records use deterministic evidence and audit events.
- Connector account states are separate from encrypted authorization storage; user-facing APIs never return grants.
- Privacy exports are owned by the current session and exclude OAuth grants, private object keys, signed download URLs, and document bytes.
- Privacy deletion requests are session-owned and expose only bounded status fields. Operator descriptions, assignments, and resolution text do not cross the user API or exported audit-event boundary.
- Privacy erasure previews are admin-only, require a privacy review, classify every known user-owned table, expose counts rather than record contents, and remain non-executable until legal retention and provider/object deletion controls are approved.
- HAI receives only bounded aggregate status for one configured user. Unsupported fields, files, URLs, metadata, oversized input, invalid versions, disabled state, and bad tokens are rejected before any application state read.
