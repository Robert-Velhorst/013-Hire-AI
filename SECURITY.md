# Security Policy

Hire.AI is an early-stage, self-hostable preview project. It is not a managed service and has not been accepted for production use. Security reports are welcome; please keep vulnerability details private until a fix or coordinated disclosure is agreed.

## Supported versions

There is no supported production release, support window, or service-level commitment. The published [`v0.1.0-alpha.1` release](https://github.com/Robert-Velhorst/013-Hire-AI/releases/tag/v0.1.0-alpha.1) is an evaluation preview only. Maintainers may publish security fixes for `main` and the preview release as capacity permits; no response, remediation, or backport time is guaranteed. Do not use the preview to process real candidate data without completing the production acceptance requirements.

## Report a vulnerability

Use **Report a vulnerability** on the repository's [GitHub Security tab](https://github.com/Robert-Velhorst/013-Hire-AI/security). Private vulnerability reporting is enabled; the form keeps the initial report out of public issues and discussions. Include the affected commit or release, impact, reproduction steps, and a safe proof of concept where useful. Do not include real user data, working credentials, or unrelated secrets in a report.

If private reporting is unavailable, open a public issue with only the title **Request private security contact**. Do not include vulnerability details, exploit code, affected user data, or credentials. Maintainers will provide a private reporting route. Do not use public issues, discussions, or pull requests to disclose an unpatched vulnerability.

## Scope and response

Reports involving authentication, authorization, candidate data, resumes, connector tokens, application actions, payments, privacy erasure, dependency vulnerabilities, or deployment configuration are in scope. Please allow maintainers time to investigate and coordinate a fix before public disclosure. Acknowledgement, severity assessment, remediation, and disclosure timing depend on impact and maintainer availability; no response-time or remediation-time guarantee is currently offered. Security reports are not a substitute for ordinary bug reports or product support requests.

## Repository safeguards

The following GitHub repository controls were verified on 2026-10-16 UTC: private vulnerability reporting, CodeQL default setup, Dependabot security updates, provider-pattern secret scanning and push protection are enabled. The `main` branch requires pull requests, an up-to-date base, seven named status checks, and resolved review conversations; force pushes and branch deletion are disabled. GitHub Actions uses read-only default token permissions, an allowlist of eight actions, and required full-SHA pinning.

At the 2026-10-16 17:32 UTC API check, GitHub reported 21 open CodeQL alerts on `main` (12 `error` and 9 `warning` rule severities), and no open Dependabot or secret-scanning alerts. Open findings are not considered fixed merely because scanning is enabled. Generic non-provider secret-pattern scanning and provider-token validity checks are unavailable for this user-owned repository under GitHub's current eligibility requirements. Validity checks can send detected credentials to their issuers. Alert counts and repository settings change over time; the live [Security tab](https://github.com/Robert-Velhorst/013-Hire-AI/security) is authoritative. Detailed controls and production gaps are documented in [docs/SECURITY.md](docs/SECURITY.md).

The project has no supported production release or service-level commitment yet. Security fixes and advisories will be published through the repository when appropriate. See [docs/SECURITY.md](docs/SECURITY.md) for the implemented controls and outstanding acceptance work.
