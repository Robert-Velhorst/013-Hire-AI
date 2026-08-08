# Acceptance Tests

| Area | Automated evidence | Manual acceptance result |
| --- | --- | --- |
| Authentication and ownership | tRPC authorization and ownership tests | Sign in as a regular user and confirm admin routes are denied. |
| Resume and profile readiness | resume, profile-evidence, and profile-skill tests | Upload a supported resume, select its version, and verify readiness changes. |
| Discovery and safety | scraper, normalization, deduplication, freshness, and listing-safety tests | Run only configured ready sources; confirm blocked listings cannot be prepared. |
| Review and handoff | application approval, submission evidence, and autonomous execution-guard tests | Approve a prepared record and confirm the UI directs the user to complete the employer handoff. |
| Interview/offer tracking | response, interview notification, and success-fee tests | Record an employer response with source evidence and confirm interview notification behavior. |
| Privacy export | `server/privacyData.test.ts` | Verified locally through Settings: versioned export downloaded without private file bytes, credential fields, or a resume file URL. |
| Runtime operations | `server/_core/httpSafety.test.ts`; `npm.cmd run doctor` | Verified locally: `/healthz` and `/readyz` returned 200; production doctor fails with incomplete configuration. |

Expected outcomes are enforced through tests where practical. Provider callbacks, real S3 objects, Stripe webhook delivery, and legal/compliance flows require credentials and controlled external verification.
