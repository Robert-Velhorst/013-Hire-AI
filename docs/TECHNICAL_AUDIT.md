# Technical Audit

Audit date: 2026-08-08

## Runtime and boundaries

- Frontend: React, Vite, Tailwind, shadcn components.
- API: Express and tRPC. Protected procedures require a session; admin procedures require the `admin` role.
- Persistence: Drizzle/MySQL with an intentionally explicit in-memory development fallback.
- Jobs: policy-driven public discovery sources only. Account-gated and unsupported sources remain unavailable until an approved adapter exists.
- External effects: Hire.AI prepares, reviews, and records employer handoffs. It does not claim an employer submission, email delivery, provider connection, or interview without recorded evidence.

## Audit findings closed in this change

| Finding | Resolution |
| --- | --- |
| Settings exported only browser-loaded profile and application data while claiming all data. | `privacy.exportData` now builds an authenticated server-side export and records an audit event. Private document bytes, storage keys, OAuth grants, and credentials are excluded. |
| No operational HTTP probes. | `/healthz` and `/readyz` now return bounded JSON status; readiness identifies development-memory persistence rather than presenting it as a database. |
| No baseline HTTP response hardening. | The server disables `X-Powered-By` and applies anti-framing, MIME, referrer, permissions, cross-origin, production CSP, and HSTS headers. |
| No local self-diagnostic command. | `pnpm doctor` checks runtime files, migration inventory, production-required configuration, and the malware-scanner gate without printing values. |
| No container build definition. | `Dockerfile` and `.dockerignore` provide a production Node 22 build path. |
| Production HTML embedded the Manus development runtime and a second React runtime. | Manus and JSX-location plugins now run only for the Vite development server. The production shell fell from 367,750 bytes to 487 bytes, and the build fails if development markers return or the shell exceeds 25 KiB. |

## Material unresolved risks

1. Production needs MySQL/TiDB, OAuth, Stripe, Forge, S3, malware scanning, and any enabled connector credentials.
2. A real browser or official API provider adapter needs separate policy, account, quota, and acceptance-test approval before activation.
3. Employment/payment retention and success-fee terms need legal and privacy review before real-user launch.
4. Docker has not been built in this workspace because Docker Desktop availability is external to the repository.
