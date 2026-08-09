# Technical Debt And Blockers

| Item | Status | Owner / unblocker |
| --- | --- | --- |
| Verified job-source adapters beyond the seven ready public feeds | Partial | Jobicy and Arbeitnow now have documented API, fixture, live-shape, attribution/filtering, and polling-policy evidence. Arbeitnow and every remaining provider still require deployment-time terms acceptance; remaining platforms also need source-specific policy, adapters, and acceptance tests. |
| Gmail, Drive, Dropbox, Outlook, LinkedIn, and GitHub live connections | Blocked | User-owned OAuth applications, approved redirect URIs/scopes, and credentials. |
| Real employer submission automation | Intentionally not implemented | Platform permission, safe official API support, user approval, and deterministic confirmation evidence. |
| Stripe, S3, Forge and cloud-scanner production verification | Blocked | Production credentials and test accounts. Native Windows Defender scanning is implemented and locally detected; the configured cloud scanner still requires live acceptance. |
| Legal/privacy/retention approval and live acceptance | Partial | Intake, cancellation, review, exhaustive mapping, provider/object cleanup, and rollback-tested transactional finalization exist; approved periods/legal bases and controlled live-provider acceptance remain. |
| Deployment backup/restore acceptance | Partial | Streaming checksummed tooling, Docker client mode, tests, and a two-container isolated restore passed; configure encrypted off-host retention and repeat recovery against the provisioned deployment and storage-provider policy. |
| Windows/ngrok hosted acceptance | Partial | Native and tunnel launchers exist; production credentials, a reserved HTTPS hostname, and public health/callback evidence are required. |
| External HAI peer acceptance | Partial | The read-only A2A 1.0 status contract is locally verified; configure a shared token and private peer URL in a controlled environment. |
| Candidate collaboration within workspaces | Governance complete; candidate sharing intentionally disabled | Define an explicit consent, tenant-isolation, revocation, and audit model before exposing candidate-domain records to workspace members. |
| Full product localization | Partial | English/Dutch account persistence plus shared headers, Settings/privacy controls, AI preference controls and scheduler summaries, saved-jobs, job-alerts, Team, and not-found translations exist. Define a safe policy for backend-generated evidence/diagnostic text, translate remaining workflow copy, and complete native-speaker/accessibility review. |
