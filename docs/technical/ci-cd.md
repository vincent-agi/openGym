# CI/CD and releases

All automation is GitHub Actions in `.github/workflows/`. This page explains what runs, when, what blocks a merge,
and how a release reaches `ghcr.io`.

## Pipeline overview

```
 feature branch ──PR──▶ ci.yml + security.yml   (must be green to merge)
                              │ squash-merge (Conventional Commit title)
                              ▼
                            main ──▶ publish.yml : build → Trivy scan → push :latest, :sha-<short>
                              │ ──▶ release.yml : release-please keeps a "release PR" up to date
                              │ ──▶ ci.yml, security.yml (again, on the merged commit)
                              ▼
              merge the release PR ──▶ tag vX.Y.Z + GitHub Release
                              └──▶ release.yml calls publish.yml with version=X.Y.Z → also :X.Y.Z, :X.Y
```

## Workflows

### `ci.yml` — CI

Triggers: every `pull_request`, and `push` to `main`. Concurrency: cancels superseded runs on the same ref.
`permissions: contents: read`. Node 22, with npm caching.

| Job (required check name) | Steps |
|---|---|
| `Frontend (test + build)` | `npm ci` → `npm run test` (Vitest) → `npm run build` in `frontend/`. |
| `API (syntax + boot smoke)` | `npm ci` → `node --check server.js` → start the server on port 3999 with a temp `DATA_DIR` and poll until it answers any HTTP status. |
| `Scripts (shellcheck + tests) (ubuntu-latest / macos-latest)` | `shellcheck -S warning` on `scripts/`, then `scripts/tests/run.sh` under the system bash (3.2 on macOS) and `opengym help --check`. **Not required yet**: add it to branch protection once stable. |

There is deliberately **no `paths:` filter**: a required check skipped by a path filter stays "pending" forever and blocks
the merge.

Known gaps: the API has **no automated test suite** (the smoke test only proves the process starts), and
`frontend/scripts/check-locales.mjs` — which guards that all 11 locale files share the same key set — is **not wired
into CI**. Run it locally after touching strings: `node frontend/scripts/check-locales.mjs`.

### `security.yml` — Security

Triggers: `pull_request`, `push` to `main`, and a weekly schedule (`17 4 * * 1`, Monday 04:17 UTC) so new advisories
surface on unchanged code.

| Job (required check name) | What it does | Blocks merge? |
|---|---|---|
| `CodeQL (javascript-typescript)` | Static analysis of `frontend/` and `api/` (ignores `android`, `ios`, `dist`, `node_modules`). Uploads SARIF to the Security tab. | Yes |
| `Dependency audit (frontend)` / `(api)` | `npm audit` (reported, never fails) then `npm audit --omit=dev --audit-level=high` (fails on high/critical **runtime** advisories). Dev-tooling advisories are reported only. | Yes (runtime high/critical) |
| `Secret scan (gitleaks)` | `gitleaks-action` over the PR's commit range (`fetch-depth: 0`). Personal repos need no licence; org repos need `GITLEAKS_LICENSE`. | Yes |

### `publish.yml` — Publish images

Triggers: `push` to `main`, `workflow_dispatch`, and `workflow_call` (used by `release.yml`, with an optional `version`
input). Concurrency group `publish-<ref>` with `cancel-in-progress: false` so a half-pushed release is never cancelled.
Permissions: `contents: read`, `packages: write`.

Matrix: `api` (context `./api`) and `web` (context `.`, dockerfile `web/Dockerfile`). For each:

1. Lowercase the owner → `IMAGE=ghcr.io/<owner>/opengym-<name>` (GHCR requires lowercase).
2. Set up QEMU and Buildx; log in to `ghcr.io` with the built-in `GITHUB_TOKEN` (no personal credentials).
3. Derive tags: `latest` (only on `refs/heads/main`), `sha-<short>`, and — when `version` is given — `X.Y.Z` plus `X.Y`.
4. **Build one amd64 image locally** (`load: true`) and **scan it with Trivy** (`HIGH,CRITICAL`, `ignore-unfixed: true`,
   `exit-code: 1`). A failure here stops the job and **nothing is pushed**.
5. Build **linux/amd64 + linux/arm64** (cache hit from step 4) and **push** with the derived tags and OCI labels.

Caches use the GitHub Actions cache (`type=gha`, scoped per image). The `web` build pins its Node stage to
`--platform=$BUILDPLATFORM` so cross-arch builds avoid QEMU-emulated `npm install`, which is known to corrupt native
binaries (esbuild/rollup).

Note: on a release, the merge to `main` triggers `publish.yml` once (as `latest` + `sha`) **and** `release.yml` calls it a
second time with the version. The concurrency group serialises them; both produce valid images.

### `release.yml` — Release

Trigger: `push` to `main`. Uses `googleapis/release-please-action@v4` with `release-please-config.json` and
`.release-please-manifest.json` (currently `1.5.0`).

- It reads **Conventional Commits** since the last tag and maintains an open **release PR** containing the version bump
  and `CHANGELOG.md`.
- Merging that PR creates the git tag `vX.Y.Z` and the GitHub Release, then calls `publish.yml` with the version.
- Version files updated: `frontend/package.json` and `api/package.json` (`extra-files`). **The Android
  `versionName`/`versionCode` in `frontend/android/app/build.gradle` is not bumped automatically** (it is at `1.2.4`
  while the app is `1.5.0`); `docs/MOBILE.md` says to keep it in step manually, and `versionCode` must increase for
  updates to install.
- The release PR is created with `secrets.RELEASE_PLEASE_TOKEN || secrets.GITHUB_TOKEN`. PRs opened with the default
  `GITHUB_TOKEN` **do not trigger other workflows**, so without the PAT the release PR gets no CI and cannot satisfy
  required checks.

Version bump rules:

| Commit | Bump | Changelog section |
|---|---|---|
| `feat` | minor | Features |
| `fix` | patch | Bug Fixes |
| `perf` | none alone | Performance |
| `refactor` | none alone | Refactoring |
| `feat!` / `fix!` / `BREAKING CHANGE:` footer | major | — |
| `chore`, `docs`, `ci`, `test` | none | hidden |

### Dependabot (`.github/dependabot.yml`)

Weekly, grouped, labelled `automation` + `chore`, commit prefix `chore(deps)`:

| Ecosystem | Directory | Group |
|---|---|---|
| npm | `/frontend` | `npm-frontend` |
| npm | `/api` | `npm-api` |
| docker | `/api`, `/web` | `docker-base-images` |
| github-actions | `/` | `github-actions` |

Dependabot PRs run the normal CI and Security workflows, so a breaking bump fails before merge.

## Branch protection and governance

Exact settings are in [`BRANCH_PROTECTION.md`](../BRANCH_PROTECTION.md). In short for `main`:

- Pull request required; **1 approval and Code Owner review** (set approvals to 0 for a solo maintainer, since GitHub
  does not let you approve your own PR).
- Required, up-to-date status checks: `Frontend (test + build)`, `API (syntax + boot smoke)`,
  `CodeQL (javascript-typescript)`, `Dependency audit (frontend)`, `Dependency audit (api)`, `Secret scan (gitleaks)`.
  Check names must match exactly; they only appear in the picker after running once on a PR.
- Block force-push and deletion; linear history with squash merges (one PR = one changelog line).
- Dependabot minor/patch PRs may auto-merge once green; major bumps and the release PR are merged by a human.
- `CODEOWNERS` routes `/api/`, `/frontend/`, `/web/`, `/.github/workflows/` and `dependabot.yml` to the maintainer.
- PR template (`.github/pull_request_template.md`): Summary, Related issues, How tested, and a checklist (CI green, no
  secrets or personal data, docs updated).

## One-time repository setup

1. Apply the branch ruleset above.
2. Enable **Dependabot alerts and security updates**, **secret scanning + push protection**, **code scanning**.
3. Enable **private vulnerability reporting** (Settings → Advanced Security) — `SECURITY.md` links to it.
4. Create a fine-grained PAT (Contents and Pull requests: write) and store it as `RELEASE_PLEASE_TOKEN`.
5. After the first publish, make the GHCR packages `opengym-api` and `opengym-web` **public** so
   `docker compose pull` works anonymously.
6. Merge a `feat:`/`fix:` commit and confirm release-please opens its PR.

## Cutting a release

1. Land work on `main` through PRs titled as Conventional Commits.
2. Open the **release PR** that release-please maintains. Review the version and changelog.
3. Merge it. Within minutes: tag `vX.Y.Z`, GitHub Release, images `:X.Y.Z`, `:X.Y`, `:latest`, `:sha-…` on GHCR.
4. For a mobile release, additionally bump `versionName`/`versionCode`, rebuild and sign the APK
   ([MOBILE.md](../MOBILE.md)) and update the website download.
5. Announce; self-hosters run `docker compose pull && docker compose up -d`.

## Rolling back a bad release

- **Deployments:** pin the previous tag in Compose ([rollback](deployment.md#rollback)).
- **Registry:** there is no automated unpublish. Publish a fix (`fix:` commit → patch release), or delete the bad tag in
  the GHCR UI. `:latest` always points at the newest successful `main` build.

## Running the checks locally

```bash
# what ci.yml runs
( cd frontend && npm ci && npm test && npm run build )
( cd api && npm ci && node --check server.js )

# locales (not in CI)
node frontend/scripts/check-locales.mjs

# what security.yml's audit runs
( cd frontend && npm audit --omit=dev --audit-level=high )
( cd api && npm audit --omit=dev --audit-level=high )

# image scan like publish.yml (needs Docker and Trivy)
docker build -t scan/api ./api && trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 scan/api
docker build -f web/Dockerfile -t scan/web . && trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 scan/web

# secrets
gitleaks detect --redact
```

## Troubleshooting CI

| Symptom | Cause / fix |
|---|---|
| Required check stays "Expected — waiting for status" | The check name does not match, or a path filter skipped it. Do not add `paths:` to required workflows. |
| Release PR has no checks | `RELEASE_PLEASE_TOKEN` not set; the default token does not trigger workflows. |
| Trivy blocks the push | A fixable HIGH/CRITICAL CVE in a base image or dependency. Merge the Dependabot bump or rebuild to pick up the patched base. Use `ignore-unfixed` only for what cannot be fixed. |
| `web` build fails with odd module-resolution errors on arm64 | An emulated `npm install` corrupted native binaries; keep `--platform=$BUILDPLATFORM` on the build stage. |
| `docker compose pull` → `denied` | GHCR package still private; make it public or build from source. |
| gitleaks fails on a PR | A secret (or test fixture that looks like one) is in the commit range. Remove it **and rotate it**; history rewrite is needed to clear it from the range. |
