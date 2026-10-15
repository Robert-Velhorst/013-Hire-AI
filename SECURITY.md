# Security Policy

Hire.AI is an early-stage preview and is not accepted for production use. Please report suspected vulnerabilities privately. Do not test against a live service or submit real candidate data; no public production service is currently offered.

## Reporting

Use GitHub's **Report a vulnerability** form on the repository's [Security Advisories page](https://github.com/Robert-Velhorst/013-Hire-AI/security/advisories/new). Private vulnerability reporting is enabled. Include the affected commit or release, impact, reproduction steps, and a safe proof of concept where possible. Redact personal information, access tokens, passwords, and other secrets.

If the private form is unavailable, open a public issue titled **Request private security contact** only. Do not put vulnerability details, exploit code, affected user data, or credentials in a public issue, discussion, or pull request.

## Scope and handling

Reports involving authentication, authorization, candidate data or resumes, provider grants, application actions, payments, privacy erasure, source ingestion, or deployment configuration are in scope. Please allow maintainers to investigate and coordinate remediation before public disclosure. Acknowledgment, response, and remediation timelines are not guaranteed.

## Repository safeguards

Verified against GitHub on 2026-10-15 UTC: private vulnerability reporting, CodeQL default setup, Dependabot alerts and security updates, provider-pattern secret scanning, and secret push protection are enabled. No open Dependabot or secret-scanning alerts were returned. GitHub reported 29 open CodeQL alerts on `main` (2 critical, 23 high, 4 medium); they remain to be triaged and are not considered fixed by the presence of scanning.

The `main` branch is protected: pull requests, up-to-date base, seven required CI/security checks, and resolved review conversations are required. Administrators are included; force pushes and branch deletion are disabled. GitHub Actions defaults to read-only workflow permissions, cannot approve pull requests, is restricted to eight selected actions, and requires full-SHA action pinning. Generic-pattern secret scanning and secret validity checks are not enabled for this user-owned repository; GitHub documents generic-pattern scanning for organization-owned repositories with GitHub Secret Protection. Validity checks send supported detected credentials to their issuers. See [docs/SECURITY.md](docs/SECURITY.md) for details and the live [Security tab](https://github.com/Robert-Velhorst/013-Hire-AI/security) for current settings and alerts.

The project has no supported production release or service-level commitment. The published `v0.1.0-alpha.1` release and container are previews, not a managed service. Security fixes and advisories will be published through the repository when appropriate. See [docs/SECURITY.md](docs/SECURITY.md) for implementation details, current controls, known limitations, and production acceptance work.
