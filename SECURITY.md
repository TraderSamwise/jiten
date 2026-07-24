# Security Policy

## Reporting a Vulnerability

Please **do not** report security vulnerabilities through public GitHub issues.

Instead, report them privately by email to **sam@tealstreet.io**, or via GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
("Report a vulnerability" under the repository's **Security** tab).

Please include:

- a description of the issue and its impact,
- steps to reproduce (proof-of-concept if possible),
- affected version / commit, and platform (iOS / Android / web).

You can expect an initial acknowledgement within a few days. We'll keep you informed as we
work on a fix and coordinate disclosure.

## Scope

Jiten is offline-first and stores user data locally in SQLite. The optional cloud layer
uses Clerk (auth) and Turso (per-user hosted SQLite). Reports of particular interest:

- authentication / session handling in the backend (`api/`, `server/`)
- data isolation between users in the sync layer
- injection or data-exfiltration paths in the reader WebView bridge
- handling of imported book content and dictionary data

Thank you for helping keep Jiten and its users safe.
