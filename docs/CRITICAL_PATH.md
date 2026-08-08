# Critical Path

Hire.AI's supported critical path is review-first:

1. **Profile and resume**: authenticated profile records and a selected, versioned resume are required before material preparation.
2. **Discovery**: policy-approved source adapters normalize listings, deduplicate source links, preserve freshness, and classify listing-safety signals.
3. **Matching**: profile evidence and saved preferences create a match ledger rather than treating an LLM response as fact.
4. **Preparation**: application materials are created only when readiness, source, and safety gates permit it.
5. **Human decision**: the review queue records approve, skip, manual handoff, and evidence requirements.
6. **External handoff**: the candidate completes the employer portal or approved provider action. Hire.AI records an application only after deterministic confirmation evidence.
7. **Tracking**: responses, interviews, offers, follow-ups, and notifications are linked to the application ledger.
8. **Success fee**: a qualifying offer goes through the success-fee and verification state machine; Stripe events are idempotently recorded.

## Smoke verification

Run `pnpm test` for the existing critical-path, application-approval, submission-evidence, response/interview, success-fee, scheduler, and source-policy tests. For local UI verification, start `pnpm dev`, authenticate through the development route only in development, and walk Profile -> Jobs -> Review Queue -> Applications.

## Non-negotiable boundary

No screen, API, worker, or provider adapter may represent an employer application as submitted without explicit confirmation evidence. CAPTCHA, third-party login, and employer portal interaction remain candidate-controlled.
