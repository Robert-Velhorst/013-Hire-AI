# Security

## Enforced controls

- Session cookies are `httpOnly`; secure requests use `SameSite=None; Secure` and local requests use `SameSite=Lax`.
- Protected and admin tRPC middleware enforce authentication and role authorization.
- User-owned mutations pass the current user ID into storage operations; cross-user access tests cover critical records.
- File uploads validate size, MIME type, and signature. Production uploads require a malware-scanner endpoint.
- Connector tokens are encrypted and kept outside public profile tables; social links are references, not credentials.
- Connector disconnect disables access before cleanup, uses scoped provider revocation where supported, deletes local grants after successful or manual-only cleanup, and retains failed-revocation grants only for an auditable retry. Microsoft and LinkedIn never trigger broader account-session revocation.
- Application, payment, and provider records use audit events, ownership checks, and idempotency controls.
- Account deletion requests are session-owned, idempotent while open, auditable, and routed to high-priority operator review. Admin review records `dataDeleted: false`; no review action silently erases regulated evidence.
- Privacy policy `2026-08-09.v1` classifies every direct and application-linked user-owned table, known private-object key, and provider grant. A schema-source regression fails when a new direct user table is not classified; previews remain read-only and fail closed without persistent storage.
- HTTP responses disable `X-Powered-By`, prohibit framing, constrain browser permissions, and add production CSP/HSTS.
- Native startup binds to loopback by default and production refuses port fallback. The HAI bridge is disabled by default, limited to local/private endpoint configuration, scoped to one user, protected by a separate 32+ character bearer token, body-bounded, and read-only.

## Required before production

1. Set all required environment variables and use managed secret storage.
2. Configure malware scanning, database backup/restore, alerting, and provider-specific quota limits.
3. Complete independent threat-model, dependency/license, legal, and privacy review.
4. Run external penetration, browser accessibility, and deployment tests.
5. Approve periods and legal bases for the checked-in retention map, then complete the separately verified executor for transactional database scrubbing, private-object deletion, and bulk provider cleanup.
