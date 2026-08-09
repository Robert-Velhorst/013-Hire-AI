# Codex Checkpoints

| Checkpoint | Evidence | State |
| --- | --- | --- |
| Source integrity | `main`, starting commit `e00ca3a`; unrelated generated directories left untracked | Complete |
| Runtime safety | HTTP safety tests and health/readiness code | Complete |
| Privacy export | server export test; Settings calls `privacy.exportData` | Complete |
| Static verification | `npm.cmd run check` | Complete |
| Focused verification | privacy and HTTP safety tests | Complete |
| Full regression | `npm.cmd test -- --run`: 159 files, 808 tests | Complete |
| Production build | `npm.cmd run build` | Complete |
| Configuration audit | Development doctor warns; production doctor fails closed for missing required configuration | Complete |
| Local health/readiness | Port 3040: `/healthz` and `/readyz` returned 200; readiness reports development memory | Complete |
| Browser acceptance | Playwright Settings export plus deletion request/cancel on desktop and 390 x 844 mobile; regular-user Admin denial reload has no new privileged-query errors | Complete |
| Privacy lifecycle | Migration 0035; idempotent request, cancellation, user-safe status, admin retention review, and audit tests | Partial: verified erasure execution requires approved retention rules |
| Retention inventory | Policy `2026-08-09.v1`; schema completeness, authorization, and fail-closed preview tests | Complete for inventory; execution remains intentionally disabled |
| Windows runtime contract | Explicit host/port selection, native launcher, doctor integration, and network tests | Complete locally; credential-complete production launch pending |
| HAI interoperability | Agent Card, concealed bearer auth, aggregate status, and read-only A2A 1.0 smoke | Complete locally; external HAI peer acceptance pending |
| ngrok readiness | ngrok 3.39.8 installed; configuration valid; fail-closed reserved-domain launcher | Partial: reserved HTTPS hostname and public health acceptance pending |
| Frontend delivery efficiency | Production-only bundle gate; 487-byte HTML shell; lazy route chunks retained | Complete for current production build |
| Dashboard request efficiency | Seven overlapping queries reduced to one bounded snapshot; GET persistence and non-admin global review reads removed | Complete for dashboard path |
| Operating query efficiency | Migration 0036; 17 schema-aligned indexes; bounded privacy/deduplication reads; shared child evidence, offer attribution, and interview-preparation datasets per ledger | Complete locally; production migration acceptance pending |
| Hosted deployment and provider acceptance | Requires credentials, a production database, and operator-owned external accounts | Partial |
