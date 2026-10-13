# Confirmed Hire.AI product direction

User-approved interview decisions, 2026-09-06. This is the implementation target,
not a claim of existing functionality or production readiness. Preserve existing
work; validate each increment before enabling external actions.

## Service boundary

- All professions and experience levels; fully remote jobs only. Geographic and
  time-zone restrictions must fit the candidate. Hybrid roles are excluded.
- Minimize user work, prioritize suitable applications over volume. Initial
  document/account access is consent-scoped; confirm facts and hard preferences.
- Search, match, prepare factual documents, apply, clarify missing conditions,
  follow up, schedule and prepare interviews. Authority ends at the interview.
  Negotiation, acceptance, signatures and resignation remain with the user.
- Ask the employer about unknown decisive conditions. If unanswered, park that
  application and ask the user whether to make a specific exception.
- Do not fabricate qualifications or personally completed assessments. Request
  alternatives; otherwise let the candidate complete the requirement or skip.
- Identify autonomous correspondence as assistance on behalf of the candidate.
- Continue other suitable applications until employment or pause is reported,
  within agreed interview availability and limits. Request minimal outcome and
  first-pay status, without handling post-interview negotiations.

## Discovery and contact

- Global and local boards plus employer sites are the coverage ambition, not a
  realized universal-coverage claim. Record working, unavailable and restricted
  sources and last successful checks. Do not bypass access controls.
- Check daily for new or changed jobs. Share discovery across users; avoid
  repeated AI processing of unchanged data. Reassess relevant job/profile changes.
- Deduplicate postings and applications across sources. Reposts alone do not
  authorize reapplication. Verify conflicts in decisive conditions before applying.
- At most two follow-ups per unanswered contact sequence. Respect stated reply
  dates, rejection, contact objections and closed jobs. Unknown delivery outcomes
  require reconciliation, never blind retries.
- No suitable jobs: keep searching without relaxing hard constraints; notify
  once and subsequently only on meaningful changes or required decisions.

## User protection and operations

- Trace sources, decisions, documents, sends, replies and costs. Allow pausing
  future actions, excluding employers and revoking scoped account permissions.
- Pause affected operations on serious errors and notify users. Never charge
  for our errors or recovery. Do not imply sent messages can be undone.
- Stop applications on employment. A restart needs a reason and current criteria.
  Normal career changes and dismissal are not automatic exclusion grounds.
- Permanent exclusion is reserved for deliberate system abuse, with human review
  by Robert and an opportunity to respond. Temporary capacity limits mean waiting.
- Proposed personal-content deletion: within 30 days of account termination,
  subject to legal review and narrowly separated necessary retention exceptions.

## Commercial targets, not enabled billing authority

- Total monthly operating ceiling: EUR 100 including hosting, AI, storage and
  external services. No automatic increase; pause new costly work at the ceiling.
  This document does not implement or prove cross-provider budget enforcement.
- Subject to legal validation: employer and employee each contribute 1% of gross
  monthly salary actually received from the attributable placement, for its duration.
  Continuous same-employer renewals count; unrelated independently found jobs do not.
- Employer payment needs proven agreement; an employment contract alone is not
  consent to Hire.AI fees. Non-paying employer placements remain possible.
- Alternative prepaid credits: attributable resource costs multiplied by 2.5,
  transparent shared-cost allocation, no expiry, no debt or automatic purchases.
  Reserve bounded costs and release unused reservations. No recovery-error charges.
- The success model funds subsequent searches without advance payment. Credit
  users consume remaining/new credits unless sponsored. Do not promise universal
  free access under an unfunded prepaid model.
- Proposed internal fund redistributes eligible remaining balances on termination
  to users unable to pay. Transfer legality and refund rights remain unresolved.
  Inactivity/temporary blocks preserve balances; disputed funds remain reserved.
  Start with self-declared need, small grants and transparent queues, not salary ranking.

## Release gates and unresolved decisions

- The proposed 20-person/country-limited launch was rejected. No replacement launch
  format was approved; do not infer permission for unrestricted public launch.
- Real automatic submissions require demonstrated consent, correct facts/files,
  duplicate prevention, traceability, pause behavior and safe uncertain-send handling.
- Evaluate after four weeks of actual trial use: user effort, suitable applications,
  interviews, incidents and costs. Robert decides expansion; serious defects block it.
- Employee fees, credit pricing and fund transfers need market-specific legal review.
  Foreign incorporation or renaming a fee does not establish compliance.
- Profitability, source coverage, funding and deployment readiness remain to be
  demonstrated. Do not promise a job or uninterrupted employment.

## Implementation progress

- First increment: accepted Gmail follow-up responses without a message identifier
  become `unknown`, not retryable `failed`. Regression tests use mocked storage and
  provider responses and verify that a subsequent attempt does not call the provider.
- Remaining targets above are requirements to audit and implement, not completed
  checklist items. Existing provider approval gates remain in place.
