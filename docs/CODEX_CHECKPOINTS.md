# Codex Checkpoints

| Checkpoint | Evidence | State |
| --- | --- | --- |
| Source integrity | `main`, starting commit `e00ca3a`; unrelated generated directories left untracked | Complete |
| Runtime safety | HTTP safety tests and health/readiness code | Complete |
| Privacy export | server export test; Settings calls `privacy.exportData` | Complete |
| Static verification | `npm.cmd run check` | Complete |
| Focused verification | privacy and HTTP safety tests | Complete |
| Full regression | `npm.cmd test -- --run`: 153 files, 783 tests | Complete |
| Production build | `npm.cmd run build` | Complete |
| Configuration audit | Development doctor warns; production doctor fails closed for missing required configuration | Complete |
| Local health/readiness | Port 3040: `/healthz` and `/readyz` returned 200; readiness reports development memory | Complete |
| Browser acceptance | Playwright dev-login Settings export; downloaded v1 export excludes credentials and private file data | Complete |
| Hosted deployment and provider acceptance | Requires credentials, a production database, and operator-owned external accounts | Partial |
