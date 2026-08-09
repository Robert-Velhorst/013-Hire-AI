# Acceptance Tests

| Area | Automated evidence | Manual acceptance result |
| --- | --- | --- |
| Authentication and ownership | tRPC authorization and ownership tests | Sign in as a regular user and confirm admin routes are denied. |
| Resume and profile readiness | resume, profile-evidence, and profile-skill tests | Upload a supported resume, select its version, and verify readiness changes. |
| Discovery and safety | scraper, normalization, deduplication, freshness, and listing-safety tests | Run only configured ready sources; confirm blocked listings cannot be prepared. |
| Review and handoff | application approval, submission evidence, and autonomous execution-guard tests | Approve a prepared record and confirm the UI directs the user to complete the employer handoff. |
| Interview/offer tracking | response, interview notification, and success-fee tests | Record an employer response with source evidence and confirm interview notification behavior. |
| Privacy export | `server/privacyData.test.ts` | Verified locally through Settings: versioned export downloaded without private file bytes, credential fields, or a resume file URL. |
| Privacy deletion review | `server/privacyDeletionReview.test.ts`; `client/src/lib/adminReviewEvidence.test.ts` | Verified locally through Settings: request, no-deletion status, cancellation, and closed status; operator resolution remains a decision, not erasure execution. |
| Privacy retention preview | `server/privacyRetention.test.ts` | Admin preview must classify all 32 direct/indirect tables, known object fields, and provider grants; memory mode must fail closed and execution must remain disabled. |
| Admin denial | `client/src/lib/adminQueryAuthorization.test.ts` | A regular user receives Access Denied without firing privileged admin queries or producing new authorization errors. |
| Runtime operations | `server/_core/httpSafety.test.ts`; `npm.cmd run doctor` | Verified locally: `/healthz` and `/readyz` returned 200; production doctor fails with incomplete configuration. |
| Windows runtime | `server/_core/network.test.ts`; PowerShell parser checks | The native launcher builds, audits configuration, binds explicitly, and reports success only after `/healthz` responds. A credential-complete production launch remains operator acceptance. |
| HAI status connector | `server/haiConnector.test.ts` | Verified locally on port 3040: Agent Card discovery, concealed unauthenticated status, and authenticated A2A 1.0 aggregate status completed without exposing user content or executing actions. |
| ngrok exposure | `scripts/start-ngrok.ps1`; ngrok configuration check | ngrok 3.39.8 and its local configuration were verified. Public health and callback acceptance remain pending a reserved HTTPS hostname. |
| Production bundle | `scripts/check-production-bundle.mjs`; `npm.cmd run build` | Production HTML must remain below 25 KiB and exclude Manus/JSX-location development instrumentation. Current shell: 487 bytes, down from 367,750 bytes. |
| Dashboard request efficiency | `client/src/lib/dashboardPerformanceClaims.test.ts`; `server/applicationCampaigns.test.ts` | Dashboard uses one operating-snapshot query, returns at most 10 projected recent applications, and does not create campaign state during a protected read. |
| Embedded development runtime | `server/_core/viteConfig.test.ts` | Build and serve modes share the same factory; development keeps its client root/instrumentation while production excludes it. `/src/main.tsx` returned JavaScript in the local smoke. |
| Operating query indexes | `server/migrationJournal.test.ts` | Migration `0036` and the Drizzle schema must declare the same 17 operating indexes. Production acceptance must apply the migration and inspect query plans against representative data. |
| Operating evidence batching | `client/src/lib/dashboardPerformanceClaims.test.ts`; `server/responseInterviewMemory.test.ts` | Responses, schedules, and follow-ups are loaded through three shared batch paths, mixed application IDs return only owned records, and interview preparation uses one user-level lookup. |
| Preloaded offer attribution | `server/applicationApprovals.test.ts`; `client/src/lib/dashboardPerformanceClaims.test.ts` | The operating ledger reuses its existing application, approval, and response data; mixed-user supplied rows are filtered to the authenticated user. |
| Scoped admin snapshot | `server/auditAdminReview.test.ts`; `client/src/lib/dashboardPerformanceClaims.test.ts` | Admin operating-ledger reads are capped at 100 active items for the requested user and cannot include another user's or closed review records. |
| Scoped verification review | `server/auditAdminReview.test.ts`; `server/adminVerificationReview.test.ts` | Employment-verification decisions load and resolve only active reviews for the affected user and verification without reading the global admin queue. |

Expected outcomes are enforced through tests where practical. Provider callbacks, real S3 objects, Stripe webhook delivery, and legal/compliance flows require credentials and controlled external verification.
