# Security

## Enforced controls

- Session cookies are `HttpOnly` and `SameSite=Lax`; trusted HTTPS requests also use `Secure`. Production requires a unique 32-4096 character signing secret and rejects surrounding whitespace, control characters, and known placeholders. Primary OAuth starts through a same-origin server route with HMAC-signed ten-minute state bound to an HttpOnly browser nonce; unsigned, tampered, cross-browser, expired, future, and unsafe-callback state is rejected before token exchange. OAuth JWT and cookie expiry share one absolute lifetime, defaulting to seven days and production-bounded from 15 minutes through 30 days. Signed sessions are bound to the configured Hire.AI application and a per-user session generation. Logout advances that generation so copied pre-logout cookies cannot be replayed.
- Protected and admin tRPC middleware enforce authentication and role authorization.
- Protected and admin tRPC middleware also require `accountStatus=active` before route logic runs. Suspended, pending, and unknown authenticated states retain only public status/logout access; the frontend restriction gate prevents operational queries from mounting.
- User-owned mutations pass the current user ID into storage operations; cross-user access tests cover critical records.
- Sensitive storage namespaces enforce malware scanning centrally before upload. Windows standalone uses Microsoft Defender by default; cloud/container deployments use the bounded HTTP scanner with optional bearer authentication. Production fails closed when neither is available.
- Connector tokens are encrypted and kept outside public profile tables; social links are references, not credentials. Connector OAuth fails closed at startup and runtime: empty configuration is disabled, while any configured value requires an exact credential-free callback, a canonical base64 32-byte token key, a dedicated bounded state secret, and at least one complete provider pair. Diagnostics report issue names without printing secret values.
- Connector disconnect disables access before cleanup, uses scoped provider revocation where supported, deletes local grants after successful or manual-only cleanup, and retains failed-revocation grants only for an auditable retry. Microsoft and LinkedIn never trigger broader account-session revocation.
- Application, payment, and provider records use audit events, ownership checks, and idempotency controls.
- Account deletion requests are session-owned, idempotent while open, auditable, and routed to high-priority operator review. Admin review records `dataDeleted: false`; no review action silently erases regulated evidence.
- Privacy policy `2026-08-09.v2` classifies every direct and application-linked user-owned table, including workspace membership and invitation relationships, known private-object key, and provider grant. A schema-source regression fails when a new direct user table is not classified; previews remain read-only and fail closed without persistent storage.
- Workspace invitations are email-bound, expire after seven days, and persist only a SHA-256 token hash. Role changes and ownership transfers are audited. Membership does not authorize candidate-domain data access.
- HTTP responses disable `X-Powered-By`, prohibit framing, constrain browser permissions, and add production CSP/HSTS.
- Native startup binds to loopback by default and production refuses port fallback. Public ngrok readiness must echo the exact local process's opaque runtime ID before the launcher reports success. The HAI bridge is disabled by default, limited to the exact local/private `/api/hai/a2a` endpoint, scoped to one canonical positive user ID, protected by a separate 32-4096 character non-placeholder bearer token without whitespace/control characters, body-bounded, and read-only.
- User-supplied remote audio accepts credential-free HTTPS only, rejects any DNS answer set containing a local, private, reserved, or non-IP address, and pins the approved addresses to the TLS connection. Redirects are not followed, preventing DNS rebinding or redirect-based access to internal services.
- Provider-controlled job fields are normalized against the shared database storage contract before persistence. Oversized content is bounded, oversized source identities retain a collision-resistant digest, and executable, credential-bearing, or overlong application links are discarded.

## Required before production

1. Set all required environment variables and use managed secret storage.
2. Configure malware scanning, database backup/restore, alerting, and provider-specific quota limits.
3. Complete independent threat-model, dependency/license, legal, and privacy review.
4. Run external penetration, browser accessibility, and deployment tests.
5. Approve periods and legal bases for the checked-in retention map, then perform controlled live-provider acceptance of the review-gated erasure executor before production use.
