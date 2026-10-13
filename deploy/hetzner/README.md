# Private Hetzner Staging

These files prepare Hire.AI on the approved Ubuntu host. They do not make it a public, production-ready service. See [hosting evidence](../../docs/HETZNER_HOSTING.md) and [release gates](../../docs/PRODUCTION_ACCEPTANCE.md). No paid backups are enabled by this configuration.

## Layout And Boundaries

Copy the deployment files to `/opt/hire-ai`, owned by root with mode `0700`. Keep application source archives in `releases/`; do not copy local `.env` files, credentials, candidate documents, database files or other projects there. The source archive checksum identifies the transferred uncommitted workspace; it is not a published Git revision.

- `compose.yaml` starts only MySQL, with a persistent named volume, no published ports and an internal Docker network. Its health check proves MySQL liveness, not valid credentials or a compatible schema; run the separate migration and schema checks below.
- `compose.app.yaml` adds the application only when explicitly selected. The web port binds to server loopback, not the internet. The application runs as the image's non-root user, with a read-only filesystem, bounded temporary storage, dropped capabilities and disabled background schedulers. Automatic app restarts are deliberately off during acceptance.
- `release.env` pins the verified application image ID already built on this server and the pulled MySQL digest. It contains no credentials. The application ID is not a publicly downloadable image; transfer/build and verify a new artifact before updating it.
- `initialize-secrets.sh` creates random local database and session secrets. Existing values are preserved; inconsistent files or symlinked secret locations are rejected. The deployment path must be canonical, absolute and below a top-level directory (for example `/opt/hire-ai`, never `/` or `/opt`). Every existing ancestor must be root-owned and free of symlinks; writable non-sticky ancestors are rejected. An existing deployment directory must already have mode `0700`; the initializer will not change its permissions. Run only in a dedicated deployment directory under trusted administration. It does not generate OAuth, AI, storage, payment or scanner credentials.
- Secret files and runtime environment files belong on the host only, not in Git. Never print merged Compose configuration after resolving real environment files or dump container environment variables into logs.

The initial memory limits are 768 MiB for MySQL and 512 MiB for the application. They leave some host capacity but are not evidence that scanners, additional tools or many simultaneous users will fit on the 2 GB server. Do not build large releases alongside a busy live workload.

## Database Preparation

Run as root on the approved host:

```bash
cd /opt/hire-ai
bash -n initialize-secrets.sh
bash initialize-secrets-paths.test.sh
bash initialize-secrets.test.sh
bash initialize-secrets.sh
docker compose --env-file release.env config --quiet
docker compose --env-file release.env up -d --wait --wait-timeout 180 db
set -a
. ./release.env
set +a
docker run --rm --network hire-ai_backend --memory=384m \
  --env-file .env.database "$HIRE_AI_IMAGE" node scripts/database-migrate.mjs
docker run --rm --network hire-ai_backend --memory=384m \
  --env-file .env.database "$HIRE_AI_IMAGE" node dist/database-schema-audit.js
```

Run migrations explicitly against the intended database, never automatically on application startup. Do not run `docker compose down -v`: the named volume contains the persistent database. Do not regenerate passwords to repair an initialized database; MySQL initialization variables do not rotate existing database accounts.

## Application Acceptance

Create `/opt/hire-ai/.env.production` privately with mode `0600` when real configuration is available. It must supply the actual identity application/server/portal/owner settings, Forge AI/storage access, Stripe credentials and Linux-compatible document scanner configuration required by the production doctor. Follow the repository's `.env.example` and operator runbook; do not invent credentials or set development mode to get past checks. Domain, TLS, callback origins and external provider acceptance are separate requirements.

The initializer already supplies `.env.database` and `.env.session`; the application loads these after the provider file. A missing `.env.production` deliberately prevents the combined deployment from starting. The production doctor also rejects incomplete settings.

```bash
docker compose --env-file release.env -f compose.yaml -f compose.app.yaml config --quiet
docker compose --env-file release.env -f compose.yaml -f compose.app.yaml \
  run --rm --no-deps app node scripts/doctor.mjs
# Only after configuration passes:
docker compose --env-file release.env -f compose.yaml -f compose.app.yaml up -d app
curl --fail http://127.0.0.1:3000/readyz
```

Do not open the public firewall based only on a passing doctor or readiness endpoint. Validate actual sign-in, candidate isolation, private storage/scanning, origin protection and proxy trust first. The current server trusts loopback proxies only; a Docker bridge proxy needs an explicitly reviewed configuration. Do not use unrestricted proxy trust. Keep the existing admin-only firewall until those checks and domain/TLS are ready.

## Recovery And Remaining Work

The database restart policy supports return after a host reboot; verify health and schema again after the reboot. This is not a backup or restore test. Robert deferred paid backups and recovery work; no backup service is purchased here. Full recovery acceptance, external integrations and real employer submission remain open. Installation success is not a claim that Hire.AI can already complete a real application journey.

Reference: [Docker Compose configuration validation](https://docs.docker.com/reference/cli/docker/compose/config/) and the [official MySQL image](https://hub.docker.com/_/mysql).
