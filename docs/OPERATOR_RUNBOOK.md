# Operator Runbook

## Local operation

```powershell
pnpm install --frozen-lockfile
pnpm doctor
pnpm check
pnpm test
pnpm build
pnpm dev
```

The server exposes `/healthz` and `/readyz`. Development can use in-memory persistence for review, but it is not durable and must not be treated as production data.

## Database and workers

Set `DATABASE_URL`, then run `pnpm db:migrate`. `AUTONOMOUS_SCHEDULER_ENABLED` controls review-only autonomous planning. `JOB_SCRAPING_SCHEDULER_ENABLED` is off by default; enable only approved sources and set an explicit source allowlist where needed.

## Incident response

1. Disable both scheduler flags.
2. Disconnect the affected connector or disable its provider configuration.
3. Preserve audit events and review records; do not fabricate completion evidence.
4. Investigate with admin source health and review queues.
5. Resume only after the provider policy, credentials, and test evidence are verified.

## Privacy deletion review

1. Confirm the request belongs to the account holder and inspect the user audit trail.
2. Identify active billing, employment verification, payment recovery, disputes, and legal holds.
3. Record which data is eligible for erasure and the retention basis for everything that must remain.
4. Treat resolving the review as a decision record only; it does not revoke providers, delete objects, or erase database records.
5. Do not report completion until a separately approved executor produces itemized deletion and revocation evidence.

## Deployment

Build with `docker build -t hire-ai .` when Docker is available. The container will fail startup in production if the core required environment variables are absent. Do not deploy until `pnpm doctor` passes with production configuration and malware scanning configured.
