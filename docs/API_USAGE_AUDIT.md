# API Usage Audit

All application API calls use `/api/trpc`. Public procedures are limited to unauthenticated status and discovery surfaces; user-owned records use `protectedProcedure`; operator operations use `adminProcedure`.

## HTTP operational endpoints

- `GET /healthz`: liveness only; returns no credentials or provider internals.
- `GET /readyz`: configuration/readiness status. Development explicitly reports `development_memory` when no database is configured. Production returns `503` when required runtime readiness is false.
- `/api/oauth/callback` and `/api/connectors/oauth/callback`: provider callback boundaries.
- `/api/stripe/webhook`: registered before JSON parsing to preserve signed raw request bodies.

## High-risk action controls

- Application preparation requires a current job, a versioned active resume, profile readiness, and review artifacts.
- Submission, follow-up delivery, and employer response records use deterministic evidence and audit events.
- Connector account states are separate from encrypted authorization storage; user-facing APIs never return grants.
- Privacy exports are owned by the current session and exclude OAuth grants, private object keys, signed download URLs, and document bytes.
- Privacy deletion requests are session-owned and expose only bounded status fields. Operator descriptions, assignments, and resolution text do not cross the user API or exported audit-event boundary.
