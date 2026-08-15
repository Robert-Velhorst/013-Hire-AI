# Windows, ngrok, and HAI operation

## Windows 11 native runtime

Hire.AI runs as a native Node.js process; Docker is not required. Production operation still requires the services and credentials reported by `npm.cmd run doctor`, including a reachable MySQL-compatible database.

1. Install Node.js 22 and a MySQL-compatible database.
2. Copy `.env.example` to `.env` and replace every required production value.
3. Record and verify a database backup before the first start after an upgrade.
4. Start the checked and built service:

```powershell
npm.cmd run start:windows -- -Port 3000
```

The script builds the app, runs the production doctor, applies lock-protected database migrations, audits the resulting schema, starts a hidden child process, and reports success only after `/readyz` confirms the configured database is reachable. Every preparation step fails closed before server startup. Use `-SkipDatabaseMigration` only when migrations were applied separately from the same checkout; the schema audit still runs and rejects an outdated database.

The service binds to `127.0.0.1` by default. Use `-HostAddress 0.0.0.0` only when a firewall and trusted reverse proxy intentionally protect a LAN/container listener. Production startup fails when its requested port is occupied; it never silently changes the externally configured port.

## ngrok tunnel

Use a reserved HTTPS ngrok origin so OAuth callbacks remain stable. Start the Windows runtime first, then open a second PowerShell terminal:

```powershell
npm.cmd run start:ngrok -- -PublicUrl https://hire-ai.example.ngrok.app/ -Port 3000
```

The tunnel script requires an installed and authenticated ngrok CLI, verifies local readiness before launch, and accepts public `/readyz` only when its opaque per-process instance ID exactly matches the local runtime. This prevents a stale or misrouted reserved hostname from being reported as the current Hire.AI process. It stops and reports ngrok's error when verification fails. Configure provider applications with these exact callback URLs before testing:

Set `OAUTH_PORTAL_URL` to the trusted login portal at runtime. Sign-in starts at Hire.AI's same-origin `/api/oauth/login` endpoint, which uses the trusted forwarded HTTPS origin to issue signed ten-minute state bound to an HttpOnly browser nonce. Do not link directly to the provider portal or construct OAuth state in the browser.

The application trusts forwarded protocol and client metadata only when the immediate peer is loopback, which matches the local ngrok agent. Do not place another non-loopback reverse proxy between ngrok and Hire.AI without first extending and testing the explicit proxy-trust policy; forwarded headers from direct LAN or public clients are intentionally ignored.

Cookie-authenticated POST requests through the tunnel must retain ngrok's public `Host`, `X-Forwarded-Proto: https`, and the browser's matching `Origin`. The launcher and default ngrok forwarding behavior satisfy that contract. A proxy that rewrites the host inconsistently will receive `403` for session writes and must be corrected rather than bypassing origin enforcement.

- Main sign-in: `https://hire-ai.example.ngrok.app/api/oauth/callback`
- Account connectors: `https://hire-ai.example.ngrok.app/api/connectors/oauth/callback`
- Stripe webhook: `https://hire-ai.example.ngrok.app/api/stripe/webhook`

Set `CONNECTOR_OAUTH_REDIRECT_URI` to the exact public connector callback ending in `/api/connectors/oauth/callback`. Configure a canonical base64 32-byte `CONNECTOR_TOKEN_ENCRYPTION_KEY`, a separate 32-4096 character `CONNECTOR_OAUTH_STATE_SECRET`, and complete credential pairs only for providers you enable. Leave all connector variables empty to disable connectors. Production startup and `pnpm doctor` reject partial or unsafe connector configuration. A green public readiness check proves the configured database answered, but does not prove OAuth, Stripe, storage, email, or provider acceptance; test each with an authorized sandbox account.

## HAI A2A connector

Hire.AI exposes a deliberately narrow A2A 1.0-shaped status connector for a local or private-network HAI peer. It is disabled by default and must not be pointed at a public ngrok origin.

```dotenv
HAI_CONNECTOR_ENABLED=true
HAI_CONNECTOR_TOKEN=<independently-generated-32-to-4096-character-token>
HAI_CONNECTOR_USER_ID=123
HAI_CONNECTOR_URL=http://127.0.0.1:3000/api/hai/a2a
```

Generate the token with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Production startup and `pnpm doctor` reject the documented placeholder, whitespace/control characters, ambiguous user IDs, public endpoints, and any path other than exactly `/api/hai/a2a`. The token is never printed by diagnostics.

Endpoints:

- `GET /.well-known/agent-card.json`: available only when configuration is valid.
- `GET /api/hai/status`: bearer-authenticated connector configuration status.
- `POST /api/hai/a2a`: bearer-authenticated JSON-RPC `SendMessage`, requiring `A2A-Version: 1.0`.

The response contains aggregate campaign, application, approval, connector, success-fee-state, and scheduler status for one configured numeric user ID. It excludes names, email addresses, profile content, job details, documents, messages, credentials, payment amounts, and raw audit records. It cannot submit applications, send messages, call providers, resolve approvals, alter billing, mutate workflows, or execute autonomous work.

HAI must register the Agent Card and token on its side and retain a controlled peer acceptance test. The checked-in contract proves Hire.AI's endpoint behavior; it does not claim that an external HAI deployment has been configured.
