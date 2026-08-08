# Technical Debt And Blockers

| Item | Status | Owner / unblocker |
| --- | --- | --- |
| Verified job-source adapters beyond the ready public feeds | Partial | Platform policy, adapter implementation, acceptance tests, and operator approval. |
| Gmail, Drive, Dropbox, Outlook, LinkedIn, and GitHub live connections | Blocked | User-owned OAuth applications, approved redirect URIs/scopes, and credentials. |
| Real employer submission automation | Intentionally not implemented | Platform permission, safe official API support, user approval, and deterministic confirmation evidence. |
| Stripe, S3, Forge and malware-scanner production verification | Blocked | Production credentials and test accounts. |
| Legal/privacy/retention approval and erasure execution | Partial | Intake, cancellation, review, and audit controls exist; counsel/operator policy, record-level retention mapping, provider revocation, and a verified erasure executor remain. |
| Backup/restore and deployment drill | Partial | A provisioned database, object storage, and deployment environment. |
| Team/workspace permissions and localization | Missing | Product decision and schema/UI implementation. |
