# Security Policy

Hire.AI is an early-stage preview and is not accepted for production use. Please report suspected vulnerabilities privately. Do not test against a live service or submit real candidate data; no public production service is currently offered.

## Reporting

Use GitHub's **Report a vulnerability** form on the repository's [Security Advisories page](https://github.com/Robert-Velhorst/013-Hire-AI/security/advisories/new). Private vulnerability reporting is enabled. Include the affected commit or release, impact, reproduction steps, and a safe proof of concept where possible. Redact personal information, access tokens, passwords, and other secrets.

If the private form is unavailable, open a public issue titled **Request private security contact** only. Do not put vulnerability details, exploit code, affected user data, or credentials in a public issue, discussion, or pull request.

## Scope and handling

Reports involving authentication, authorization, candidate data or resumes, provider grants, application actions, payments, privacy erasure, source ingestion, or deployment configuration are in scope. Please allow maintainers to investigate and coordinate remediation before public disclosure. Acknowledgment, response, and remediation timelines are not guaranteed.

The project has no supported production release or service-level commitment. The published `v0.1.0-alpha.1` release and container are previews, not a managed service. Security fixes and advisories will be published through the repository when appropriate. See [docs/SECURITY.md](docs/SECURITY.md) for implementation details, current controls, known limitations, and production acceptance work.
