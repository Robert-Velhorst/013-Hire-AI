# Codex Checkpoints

| Checkpoint | Evidence | State |
| --- | --- | --- |
| Source integrity | `main`, starting commit `e00ca3a`; unrelated generated directories left untracked | Complete |
| Runtime safety | HTTP safety tests and health/readiness code | Complete |
| Privacy export | server export test; Settings calls `privacy.exportData` | Complete |
| Static verification | `npm.cmd run check` | Complete |
| Focused verification | privacy and HTTP safety tests | Complete |
| Full regression | `npm.cmd test -- --run`: 172 files, 889 tests; 1 MySQL integration test separately passed | Complete |
| Production build | `npm.cmd run build` | Complete |
| Configuration audit | Development doctor warns; production doctor fails closed for missing required configuration | Complete |
| Local health/readiness | Port 3040: `/healthz` and `/readyz` returned 200; readiness reports development memory | Complete |
| Browser acceptance | Playwright Settings export plus deletion request/cancel on desktop and 390 x 844 mobile; regular-user Admin denial reload has no new privileged-query errors | Complete |
| Privacy lifecycle | Migrations 0035/0038; idempotent request, cancellation, user-safe status, retention inventory, durable task plan, leased external cleanup, manual evidence, transactional finalization, and audit tests | Implemented; production use still requires approved retention periods/legal bases and provider acceptance |
| Retention inventory | Policy `2026-08-09.v2`; schema/finalizer lockstep, authorization, fail-closed preview, workspace ownership guard, and clean-MySQL rollback tests | Complete for checked-in policy and implementation |
| Windows runtime contract | Explicit host/port selection, native launcher, doctor integration, network/HAI tests, PowerShell parser validation, and dedicated `windows-latest` CI | Complete in CI run `31291576077`; credential-complete production launch pending |
| Supply-chain audit | Pnpm 11 frozen graph; restricted build scripts; patched Vitest/Vite, Nano ID, Mermaid, DOMPurify, PostCSS, and esbuild; `pnpm security:audit`; moderate-or-higher CI gate | Complete locally and enforced in CI |
| HAI interoperability | Agent Card, concealed bearer auth, aggregate status, and read-only A2A 1.0 smoke | Complete locally; external HAI peer acceptance pending |
| ngrok readiness | ngrok 3.39.8 installed; configuration valid; fail-closed reserved-domain launcher | Partial: reserved HTTPS hostname and public health acceptance pending |
| Frontend delivery efficiency | Production-only bundle gate; 487-byte HTML shell; lazy route chunks retained | Complete for current production build |
| Browser shell accessibility | One primary landmark, keyboard-named brand/account controls, authenticated dashboard-to-review interaction, clean console, and 390-pixel no-overflow smoke | Complete locally; independent assistive-technology and usability acceptance remain |
| Database recovery tooling | Streaming MySQL backup, atomic checksummed bundle, local/Docker client modes, independent verification, target-bound confirmation, adversarial tests, and two-container MySQL 8.4 drill | Complete locally; deployment-specific off-host retention and restore acceptance remain |
| Discovery resource controls | Adapter cancellation propagation, per-source serialization/pacing, bounded cross-source concurrency/deadlines, selective retry/backoff, production allowlist doctor gate, and admin-visible policy | Complete in code; live provider quota acceptance remains operator evidence |
| Dashboard request efficiency | Seven overlapping queries reduced to one bounded snapshot; GET persistence and non-admin global review reads removed | Complete for dashboard path |
| Operating query efficiency | Migrations 0036-0040; 18 schema-aligned operating indexes plus stable ledger and active-work indexes; indexed due-alert selection with paged canonical-job and application-ledger reads; bounded dashboard/autonomous application, approval, and review-decision workloads; exact aggregate totals, current-job history, and daily preparation counts; exact owned lifecycle/admin evidence/approval/preparation/decision-close/employer-reply/interview-context queries; shared child evidence for the bounded operating set | Complete locally with synthetic 260-application/105-approval evidence; migration 0040 passed clean-container CI |
| Account localization | Migration 0041; supported-locale contract; audited user-scoped API; React locale provider; English/Dutch navigation, auth shell, and Settings control | Implemented foundation; remaining workflow copy and native-speaker/accessibility acceptance are partial |
| Container runtime | Pnpm 11 frozen build, non-root runtime, configuration doctor entrypoint, bundled lock-protected migrator, Docker health probe, MySQL 8.4 readiness smoke | Complete locally and enforced in Linux CI |
| Connector cleanup | Disable-first disconnect, bounded Google/Dropbox/GitHub revocation, Google shared-grant cleanup, Microsoft/LinkedIn manual guidance, encrypted retry state | Complete in code; live provider acceptance remains operator evidence |
| Hosted deployment and provider acceptance | Requires credentials, a production database, and operator-owned external accounts | Partial |
