# Codex Checkpoints

| Checkpoint | Evidence | State |
| --- | --- | --- |
| Source integrity | `main`, starting commit `e00ca3a`; unrelated generated directories left untracked | Complete |
| Runtime safety | HTTP safety tests and health/readiness code | Complete |
| Privacy export | server export test; Settings calls `privacy.exportData` | Complete |
| Static verification | `npm.cmd run check` | Complete |
| Focused verification | privacy and HTTP safety tests | Complete |
| Full regression | `npm.cmd test -- --run`: 155 files, 788 tests | Complete |
| Production build | `npm.cmd run build` | Complete |
| Configuration audit | Development doctor warns; production doctor fails closed for missing required configuration | Complete |
| Local health/readiness | Port 3040: `/healthz` and `/readyz` returned 200; readiness reports development memory | Complete |
| Browser acceptance | Playwright Settings export plus deletion request/cancel on desktop and 390 x 844 mobile; regular-user Admin denial reload has no new privileged-query errors | Complete |
| Privacy lifecycle | Migration 0035; idempotent request, cancellation, user-safe status, admin retention review, and audit tests | Partial: verified erasure execution requires approved retention rules |
| Hosted deployment and provider acceptance | Requires credentials, a production database, and operator-owned external accounts | Partial |
