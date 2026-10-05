# openGym technical documentation

For people who **build, deploy, secure and operate** openGym: developers, DevSecOps engineers, system
administrators and database administrators.

If you use openGym to train, read the [user guide](../user/README.md) instead.

> Scope: this documentation describes release **1.5.0** (`api/package.json`, `frontend/package.json`).
> Line numbers are deliberately not quoted; file and function names are.

## Pick your path

| You are… | Start with | Then |
|---|---|---|
| **Sysadmin / self-hoster** | [Deployment](deployment.md) | [Configuration](configuration.md), [Operations](operations.md), [Automation scripts](automation.md) |
| **DevSecOps** | [Security](security.md) | [Deployment § reverse proxy](deployment.md#reverse-proxy-and-tls), [CI/CD](ci-cd.md) |
| **DB admin** | [Data model and storage](data-model.md) | [Operations § backup and restore](operations.md#backup-and-restore) |
| **Backend developer** | [Architecture](architecture.md) | [API reference](api-reference.md) |
| **Frontend developer** | [Development guide](development.md) | [Architecture](architecture.md) |
| **Maintainer / release manager** | [CI/CD and releases](ci-cd.md) | [Branch protection](../BRANCH_PROTECTION.md) |

## Contents

1. [Architecture](architecture.md) — components, request flow, design decisions and hard limits.
2. [Configuration](configuration.md) — environment variables, ports, volumes, image tags.
3. [Deployment](deployment.md) — Docker Compose, reverse proxy and TLS, updates, rollback, other targets.
4. [Operations](operations.md) — health, logs, backup and restore, upgrades, monitoring, troubleshooting runbook.
5. [Data model and storage](data-model.md) — file layout, `db.json` and per-user state schemas, integrity, manual surgery.
6. [API reference](api-reference.md) — every HTTP endpoint, authentication, errors.
7. [Security](security.md) — threat model, hardening checklist, secrets, incident response.
8. [CI/CD and releases](ci-cd.md) — workflows, release-please, image publishing, supply-chain checks.
9. [Development guide](development.md) — local setup, code layout, state management, i18n, tests, mobile builds.
10. [Automation scripts](automation.md) — the `opengym` CLI: maintenance, monitoring, alerts and reporting scripts, conventions, configuration.

## Existing documents

These files predate this folder and stay authoritative for their topic:

- [`SELF_HOSTING.md`](../SELF_HOSTING.md) — step-by-step self-hosting walkthrough.
- [`MOBILE.md`](../MOBILE.md) — building the Capacitor mobile apps.
- [`BRANCH_PROTECTION.md`](../BRANCH_PROTECTION.md) — exact repository settings for `main`.
- [`SECURITY.md`](../../SECURITY.md) — vulnerability reporting and the project's own security model.
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) — contribution rules and commit conventions.

## Quick facts

| | |
|---|---|
| Runtime | Node 22 (Alpine) for the API; nginx 1.27 (Alpine) for the web tier |
| Languages | JavaScript (ES modules), React 19, no TypeScript |
| Database | **None.** JSON files on a local volume |
| Auth | WebAuthn passkeys, HMAC-signed session cookie |
| API dependencies | `@simplewebauthn/server`, `web-push` |
| Images | `ghcr.io/duartesantos8/opengym-api`, `ghcr.io/duartesantos8/opengym-web` (amd64 + arm64) |
| Scaling model | **Single instance.** In-memory state and file storage; see [limits](architecture.md#hard-limits) |
| License | AGPL-3.0-or-later |
