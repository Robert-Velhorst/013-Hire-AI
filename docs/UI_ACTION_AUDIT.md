# UI Action Audit

The authenticated routes are Dashboard, Jobs, Applications, Review Queue, Alerts, Profile, AI Preferences, Saved Jobs, Billing, Settings, and Admin. Their mutations use tRPC procedures rather than client-only success state.

| UI area | Wired behavior | Truthfulness guard |
| --- | --- | --- |
| Jobs | search, filters, save, decision, and preparation flows | Source readiness, freshness, duplicate canonicality, and listing safety are shown before preparation. |
| Review Queue | approve/skip/manual handoff and evidence review | Approval is not external submission; the next action explains the candidate's manual responsibility. |
| Applications | notes, follow-ups, delivery confirmation, employer responses, interviews, and offer states | Status changes validate ownership and source evidence. |
| Profile | profile evidence, versioned resumes, public social links, and connector requests | Private tokens are not shown or saved to public profile fields. |
| Settings | autonomous-preparation policy, server-side data export, and account-deletion review/cancellation | Export excludes document bytes, storage keys, and credentials; deletion review never claims erasure. |
| Admin | source health, privacy/operating reviews, read-only erasure inventory, billing/compliance operations | Admin authorization is server-enforced; privileged queries stay disabled for non-admin users and erasure preview never implies execution. |

Manual browser verification is still required for deployment-specific OAuth and payment paths. A button must be removed or disabled if its backing procedure cannot be authorized in the target environment.
