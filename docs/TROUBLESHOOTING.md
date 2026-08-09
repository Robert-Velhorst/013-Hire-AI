# Troubleshooting

| Symptom | Meaning | Safe response |
| --- | --- | --- |
| `/readyz` says `development_memory` | No database is configured in development. | Configure `DATABASE_URL` before relying on persistence. |
| `pnpm doctor` fails in production | Required configuration or malware scanning is missing. | Set values in the deployment secret store; never commit them. |
| Job source is unavailable | The source is not approved for automatic discovery or needs an adapter. | Use the manual source link or complete provider onboarding. |
| Application cannot be prepared | Resume, profile, listing safety, freshness, or source gates failed. | Resolve the named evidence gap, then retry. |
| Provider callback fails | OAuth credentials, redirect URI, scopes, or provider availability may be wrong. | Verify the provider configuration and use manual handoff until it is fixed. |
| File upload rejected | Type/signature, size, or malware scanning failed. | Use a supported document. On Windows verify Defender is enabled; in cloud/container deployments verify `FILE_MALWARE_SCAN_URL`, optional token, and scanner availability. |
