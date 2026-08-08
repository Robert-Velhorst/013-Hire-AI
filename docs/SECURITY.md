# Security

## Enforced controls

- Session cookies are `httpOnly`; secure requests use `SameSite=None; Secure` and local requests use `SameSite=Lax`.
- Protected and admin tRPC middleware enforce authentication and role authorization.
- User-owned mutations pass the current user ID into storage operations; cross-user access tests cover critical records.
- File uploads validate size, MIME type, and signature. Production uploads require a malware-scanner endpoint.
- Connector tokens are encrypted and kept outside public profile tables; social links are references, not credentials.
- Application, payment, and provider records use audit events, ownership checks, and idempotency controls.
- Account deletion requests are session-owned, idempotent while open, auditable, and routed to high-priority operator review. Admin review records `dataDeleted: false`; no review action silently erases regulated evidence.
- HTTP responses disable `X-Powered-By`, prohibit framing, constrain browser permissions, and add production CSP/HSTS.

## Required before production

1. Set all required environment variables and use managed secret storage.
2. Configure malware scanning, database backup/restore, alerting, and provider-specific quota limits.
3. Complete independent threat-model, dependency/license, legal, and privacy review.
4. Run external penetration, browser accessibility, and deployment tests.
5. Approve a retention schedule and implement a separately verified erasure executor for records and provider grants eligible for deletion.
