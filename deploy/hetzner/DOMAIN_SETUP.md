# Hire.AI hostname setup

Selected hostname: `013-hire.ai.noodzakelijkonline.de`.

## Observed on 2026-10-01

- Hetzner project 15925962, server 164610353 is named `General-Server` and has
  IPv4 `159.69.55.178`. The shared server must be inspected before changes.
- The `noodzakelijkonline.de` zone contains an A record named `013-hire.ai`,
  pointing to that address. A public DNS lookup returned the expected address.
- The web console displays an Ubuntu login prompt. Browser sign-in is separate
  from operating-system login. No authenticated shell inspection was performed.
- Local `.ssh` contains known-host records but no private key; the attempted
  non-interactive root SSH connection was rejected. Do not assume historical
  passwords remain valid or reset credentials to work around this.

## Current public reachability probe (2026-10-14 Europe/Amsterdam)

- DNS currently resolves the selected hostname to A record `159.69.55.178`.
- From this administrator workstation, TCP ports 80 and 443 both accept
  connections. An unauthenticated `GET /healthz` over HTTP returned `308` with a
  redirect to the same HTTPS URL.
- The corresponding HTTPS request failed during TLS negotiation with an
  `internal_error` TLS alert. This client-side observation does not identify the
  cause, establish which proxy answered, or prove that a certificate was issued.
- No host login, Caddy inspection/reload, firewall change, or application request
  over a completed TLS connection was performed. HTTPS and application health
  remain unaccepted. These observations supersede the earlier administrator-side
  report that ports 80/443 were closed; that report remains valid for its date.

## Prepared configuration, not installed

`Caddyfile.hire` is a host-level site fragment for the selected hostname, routing
to the existing intended loopback app port 3000. It excludes the private HAI
connector and its discovery metadata from public proxying. It contains no secrets.
It has not been validated by Caddy or loaded on the server.

After authenticated access, inspect listeners, containers, proxy configuration,
firewalls and `/opt/hire-ai` without dumping secrets. If another proxy already owns
ports 80/443, add the hostname there instead of replacing it or launching a second
proxy. Preserve other sites and inspect a recoverable configuration copy first.

Verify the actual application port and readiness before using this fragment.
Production requires `TRUSTED_PROXY_IPS` to name exact proxy peer addresses.
Docker port forwarding can make the host proxy appear as a bridge address, so
inspect the running network and configure the actual peer in `release.env`.
Prove HTTPS origin checks, Secure cookies and client-IP handling in the actual
topology. Do not set unrestricted proxy trust or trust all private networks to
silence the mismatch.

The public identity callback is
`https://013-hire.ai.noodzakelijkonline.de/api/oauth/callback`.
The connector callback is
`https://013-hire.ai.noodzakelijkonline.de/api/connectors/oauth/callback`.
Configure the applicable registered providers before accepting users; the hostname
does not itself create identity applications or provider credentials.

Validate the merged proxy configuration before reloading. Verify DNS and relevant
CAA/AAAA records, certificate issuance, HTTP-to-HTTPS redirect, public application
readiness, sign-in and private connector exclusion. Certificate issuance requires
the hostname to reach the intended proxy and persistent certificate storage.
Opening public ingress must follow inspection of the running application and the
existing host firewall; database and administrative endpoints remain restricted.

Official references:
- [Caddy reverse proxy](https://caddyserver.com/docs/quick-starts/reverse-proxy)
- [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https)

DNS is configured and the host now responds on HTTP/HTTPS ports, but the HTTPS
handshake currently fails from the tested network. Resolve the TLS problem only
after authenticated inspection of the shared proxy and host, then complete the
application/provider acceptance checks before publication.
