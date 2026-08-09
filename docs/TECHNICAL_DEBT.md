# Technical Debt And Blockers

| Item | Status | Owner / unblocker |
| --- | --- | --- |
| Verified job-source adapters beyond the ready public feeds | Partial | Platform policy, adapter implementation, acceptance tests, and operator approval. |
| Gmail, Drive, Dropbox, Outlook, LinkedIn, and GitHub live connections | Blocked | User-owned OAuth applications, approved redirect URIs/scopes, and credentials. |
| Real employer submission automation | Intentionally not implemented | Platform permission, safe official API support, user approval, and deterministic confirmation evidence. |
| Stripe, S3, Forge and malware-scanner production verification | Blocked | Production credentials and test accounts. |
| Legal/privacy/retention approval and erasure execution | Partial | Intake, cancellation, review, exhaustive record/object mapping, and count preview exist; approved periods/legal bases, provider revocation, transactional scrubbing, and verified execution remain. |
| Production backup/restore acceptance | Partial | Streaming checksummed tooling and tests exist; run an isolated restore against a provisioned database, configure encrypted off-host retention, and verify the storage provider's separate recovery policy. |
| Windows/ngrok hosted acceptance | Partial | Native and tunnel launchers exist; production credentials, a reserved HTTPS hostname, and public health/callback evidence are required. |
| External HAI peer acceptance | Partial | The read-only A2A 1.0 status contract is locally verified; configure a shared token and private peer URL in a controlled environment. |
| Team/workspace permissions and localization | Missing | Product decision and schema/UI implementation. |
