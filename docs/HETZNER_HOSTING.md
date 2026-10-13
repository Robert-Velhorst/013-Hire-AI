# Hetzner Hosting

Decision recorded on 2026-09-04: Robert selected Hetzner for online, multi-user Hire.AI and subsequently confirmed that he created the account. On 2026-09-05, after reporting a EUR 25 credit top-up, he explicitly authorized buying the discussed plan. The server was purchased through the authenticated Hetzner Console. OS preparation, an on-server application image build and a private database installation have since been verified below. The application is not serving users; domain and production provider configuration remain open.

## Purchased Server

- Hetzner resource name: `013-hire-ai`, renamed from `tools-01` on 2026-09-05 at Robert's request (display name requested: "013 - Hire.ai"). The Ubuntu hostname was subsequently changed and verified as `013-hire-ai` after successful OS login. The intention to host other tools later is unchanged.
- Plan/location: CPX12, x86 AMD, Falkenstein (FSN1), Germany.
- Capacity: 1 vCPU, 2 GB RAM, 40 GB local disk; order showed 20 TB included traffic.
- Image: Ubuntu 24.04. Networking: public IPv4 and IPv6.
- Checkout price: EUR 13.90/month for the server plus EUR 0.61/month for IPv4, **EUR 14.51/month including 21% VAT**. This is the recurring server/IP quote, not the cost of all future services.
- No paid backups, volumes, snapshots or other paid add-ons were selected during purchase. No SSH key was installed; the provider's initial-access flow is email-based. The cloud firewall was added after purchase as recorded below. Secure OS administration must precede application deployment. Do not put credentials in this document.
- Verified in the Console: `Server created` and `Server started`. This is infrastructure provisioning evidence only, not OS login, application health, security, capacity or recovery acceptance.

## Initial Network Hardening

Verified on 2026-09-05 in the authenticated Console and through bounded TCP connection checks:

- Firewall `013-hire-ai-admin` is applied to this server only.
- TCP 22 is allowed from the current administrator connection's single public IPv4 address (`/32`), not all IPv4/IPv6 addresses. The personal source address is intentionally not reproduced in repository documentation; the applied rule is authoritative.
- ICMP remains allowed for IPv4 and IPv6. All other inbound traffic is denied. No outbound restrictions were added.
- From the administrator computer, TCP 22 connected; ports 80, 443 and 3306 did not connect within three seconds each. This confirms that observation, not successful SSH authentication or a probe from an independent unauthorized network.
- If the administrator's public IP changes, update the specific rule through Hetzner Console before attempting SSH again. The provider browser console is the recovery route. Never temporarily allow all SSH sources as a routine workaround.
- Following Robert's password reset, root login succeeded in the provider browser console and over SSH. The SSH host fingerprint was compared against the trusted provider console before accepting it locally. No SSH key was installed. Rotate the chat-shared password privately; never put it in repository files.
- Robert declined paid Hetzner backups and explicitly deferred backup work until later. Leave them disabled; do not purchase a replacement backup service. This does not block installation preparation, but recovery acceptance remains unverified. The server/IP quote remains EUR 14.51/month including VAT, excluding other services and excess usage.

## Verified OS Preparation

On 2026-09-05 (Europe/Amsterdam; the server reports UTC), authenticated administration confirmed Ubuntu 24.04.4, approximately 1.9 GiB RAM, no swap and approximately 35 GiB available on the root filesystem. The initial `/opt` directory was empty and only SSH and the system resolver were listening on TCP. These are host observations, not an application capacity test.

- Verified OS hostname: `013-hire-ai`.
- Installed Docker Engine 29.8.0 and Compose 5.5.1 from the [official Docker Ubuntu repository](https://docs.docker.com/engine/install/ubuntu/). The Docker service was active and the isolated `hello-world` container completed successfully.
- Applied 46 available Ubuntu package upgrades, including OpenSSH. The initially held-back `linux-image-virtual` package and its new kernel/modules were subsequently installed. After an actual server reboot, `uname -r` reported `6.8.0-139-generic`, the hostname remained `013-hire-ai`, Docker was active and MySQL returned healthy automatically.
- Created the root-only directory `/opt/hire-ai/releases` for deployment artifacts. No paid backup service was enabled and no public web or database access was opened.
- Rebuilt the current uncommitted workspace successfully as `hire-ai:staging-20260905` (base Git HEAD `c12562d239ad1a3a7c78196a9c64651a56438eef`; this is not a clean published revision). The build reported image manifest-list digest `sha256:300a785edffe640032e115532e1784105490ff1a74d19b76cadedae2c2893661` and configuration digest `sha256:df57267dfa70ebd3fdbaa25c5c6bf08d4f0b4c85e6246d262988a45c0a4e69d9`.
- The subsequent local Docker archive export stalled and only that export process was stopped. A later local image inspection also stalled. Other local Docker workloads were not stopped or restarted. The source-transfer and remote-build route below then succeeded; the local Docker cause was not resolved and must not be reported as fixed.
- Repeated administrator-side connection checks after preparation: TCP 22 connected, while 80, 443 and 3306 each timed out within three seconds. Remote listening-socket inspection still showed only SSH and the system resolver on TCP.

## Verified Private Installation

Continued on 2026-09-05 using the approved server, without enabling paid backups or public web access:

- Packaged 670 build-source files from the current working tree, excluding local environment files, Git metadata, installed dependencies, generated output and other projects. The archive SHA-256 was `7e96715a1d9fdd6b436f100b5cfb9e26b17f849c11d9e82b0c15ca8f05d9c56c`, verified again after upload. Source resides in `/opt/hire-ai/releases/source-7e96715a1d9f`.
- The existing Dockerfile built successfully on the server as `hire-ai:source-7e96715a1d9f`. Verified image ID: `sha256:ed8f9f989874c85b95789e060708e72865615bf310d1222b0467f0c0b3b33d93`. No production credentials or candidate data were copied into the image.
- Added [private deployment configuration](../deploy/hetzner/README.md), copied to `/opt/hire-ai`. `release.env` records the actual image ID and MySQL digest. Root-only files contain separately generated database and session secrets; no credential values are recorded here or in Git.
- MySQL runs as `hire-ai-db-1` with the persistent `hire-ai_mysql_data` volume, a 768 MiB memory limit, an internal-only network and no published ports. All 75 migrations applied successfully. The schema audit passed before and after reboot: all 44 required application tables, 160 required indexes and 20 foreign keys were present without column/index/relationship drift. The raw database count includes the migration metadata table and additional indexes.
- The initializer tests passed for repeat-run preservation, owner-only permissions, rejection of inconsistent existing configuration and rejection of a symlinked secrets directory. Merged Compose assertions verified loopback-only application publishing, no database publishing, a read-only application filesystem, dropped capabilities and disabled schedulers.
- On 2026-09-05, additional path-safety tests first reproduced unsafe ancestor traversal and unintended permission changes in disposable test directories. The repaired initializer then passed all six test groups on this Ubuntu host: unsafe/non-canonical paths, symlink ancestors, existing non-private directories, untrusted ancestor ownership/permissions, credential preservation and inconsistent/symlink secret locations. System-path tests intercept the first write and never modify the named system directories. The updated initializer and both test scripts were copied to `/opt/hire-ai`; rerunning the real initializer preserved all five credential/environment files byte-for-byte, and MySQL remained `running/healthy`. The Linux CI job now includes both suites, but this workflow change has not yet been published or run on GitHub.
- The production doctor and default application entry command both exited with status 1 as expected: six required provider variables remain absent (`VITE_APP_ID`, `OAUTH_SERVER_URL`, `OWNER_OPEN_ID`, `BUILT_IN_FORGE_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`), the OAuth portal is not configured and the Linux document scanner is missing. No fake values were supplied. Database/session settings passed their configuration checks.
- `.env.production` is deliberately absent until actual provider configuration is supplied. The application Compose configuration refuses to start without it. The application is not running or publicly reachable. Domain/TLS, real sign-in, provider behavior, candidate isolation, document scanning/storage, capacity and recovery still need acceptance.

## Account Setup For Robert

Authenticated Console access and purchasing were verified. The checklist below remains a reference; two-factor authentication has not been checked. The EUR 25 top-up was reported by Robert; its remaining balance was not independently checked.

1. Open [Hetzner Accounts](https://accounts.hetzner.com/login), choose **Register now**, enter your own account and billing details, and confirm your email address. Complete any verification directly with Hetzner, not in chat.
2. Enable two-factor authentication and store recovery information privately. Handle payment details directly in your account.
3. The CPX12 purchase and quote are recorded above. Domain and secure deployment access remain open. Do not paste passwords, API tokens, private SSH keys or identity documents into chat or repository files.

Registration requirements and navigation are documented in [Hetzner's account guide](https://docs.hetzner.com/general/billing-and-account-management/account-getting-started/).

## Proposed First Deployment

### Initial Cost Constraint

Robert initially estimated approximately EUR 10 per month, then selected the displayed EUR 13.90 CPX12 plan, agreed to include IPv4 and authorized its purchase. The verified inclusive checkout total was EUR 14.51/month. This does not authorize later upgrades or paid add-ons, and it is not evidence of sufficient production capacity. Do not substitute a more expensive plan without a decision from Robert.

Checked on 2026-09-04: the public [Hetzner Cloud page](https://www.hetzner.com/cloud/) marks the cost-optimized offering as currently unavailable. Confirm the exact package and availability in the account before ordering. The published [price adjustment table](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/) lists CX23 at EUR 5.49 and CX33 at EUR 8.49 per month in Germany/Finland, excluding VAT and IPv4; these reference prices do not prove either plan is orderable.

Hetzner bills server backups at 20% of the server price and Primary IPv4 separately. Spending alerts are notifications, not hard spending caps. See the [billing FAQ](https://docs.hetzner.com/cloud/billing/faq/). Include applicable VAT, backup and storage charges in the actual quote; domain and AI/provider usage also require their own cost accounting. A EUR 10 server price is not a promise that the complete service costs EUR 10.

Keep the first deployment a limited staging/pilot environment until representative memory, CPU, disk, scanner and concurrent-user tests pass on the selected machine. A lower budget does not remove document scanning, account isolation or recovery requirements. Do not claim a user-capacity figure without measurements.

### Topology

The proposed initial topology is one application instance with a TLS reverse proxy, private MySQL access, private document storage and a malware-scanning service. This is a staging topology to validate before inviting real candidates, not a high-availability or capacity claim. Keep staging and production data, accounts and secrets separate.

Record the chosen project, region, server architecture, supported Linux image, public hostname, backup destination and recurring budget before provisioning. Validate the built container on that architecture. Hetzner exposes server image, networking, SSH keys, firewall and backup choices during [server creation](https://docs.hetzner.com/cloud/servers/getting-started/creating-a-server/); creating the server is a purchase and requires an approved cost.

Network and application requirements:

- Expose only the intended web entry point publicly; restrict SSH to the administrator's network or VPN. Do not expose MySQL or a scanner endpoint to the internet.
- Inject production secrets at runtime, outside the repository and build context. Use the repository's production doctor; never substitute placeholder credentials to bypass it.
- Choose a reverse-proxy topology before writing its deployment configuration. The current Express proxy policy trusts loopback only. A proxy in another Docker bridge container is not automatically trusted. Validate HTTPS detection, secure session cookies, callback URLs, origin protection and client-IP rate limits with the actual peer address. Do not set unrestricted proxy trust as a workaround.
- Keep the autonomous and scraping schedulers disabled during initial acceptance. Enable sources only after their access policy and traffic limits are configured and tested.
- Start with one application process. Multiple replicas require shared upstream rate limiting and verified worker coordination, not merely a higher replica count.
- Configure an actual Linux-compatible scanner endpoint and private storage. The Windows development scanner is not available inside the Linux runtime image.

## Provisioning And Release Sequence

1. Account access, CPX12 purchase and infrastructure start are complete. Select the domain and establish secure administration without exposing credentials.
2. OS access, the private database, image build and locally generated secrets are verified above. Complete TLS and real provider settings. The admin-only firewall remains applied; public web rules must wait for the intended deployment. The [Hetzner Compose files](../deploy/hetzner/README.md) define the private installation, not a completed public release.
3. Build an immutable image from the reviewed revision, run migrations explicitly, and validate its runtime schema using the commands in the [Operator Runbook](OPERATOR_RUNBOOK.md#deployment).
4. Verify readiness and real sign-in, account isolation, private resume upload/scanning, provider callbacks and error recovery. Never use the sample-data preview as this evidence.
5. Perform an off-host database and object-storage backup/restore drill against an isolated target. Hetzner server backups do **not** include attached Volumes; they do not replace a separate private-object and database recovery plan. See [Hetzner backup scope](https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/).
6. Complete all [Production Acceptance](PRODUCTION_ACCEPTANCE.md#public-release-gates) requirements before public release. In particular, real employer submission remains an implementation gap; selecting a host does not resolve it.

## Current Boundary

The server image build, private database migrations/schema and post-reboot database health are verified. The application correctly refuses startup with the currently missing production configuration. No healthy application service, DNS, TLS, real identity/provider journey, load or backup/restore acceptance has been demonstrated. The domain remains undecided. The work remains local and on the authorized host, not a newly published Git revision.
