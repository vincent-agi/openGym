# Branch protection policy for `main`

Branch protection can't be committed as a file: a repo admin applies it once in
**Settings → Branches → Add branch ruleset** (or classic rule) for `main`. This is the exact list.

## Turn on

- [x] **Require a pull request before merging** (no direct pushes to `main`, admins included)
  - [x] Require approvals: **1**
  - [x] Require review from **Code Owners** (`.github/CODEOWNERS`)
  - [x] Dismiss stale approvals when new commits are pushed
  - Solo maintainer? GitHub doesn't let you approve your own PR, so with a single code owner set
    approvals to **0** and untick "Require review from Code Owners" until a second reviewer exists;
    the status checks below still gate every merge.
- [x] **Require status checks to pass before merging**, and **require branches to be up to date**:

  | Check name (exact) | Workflow |
  | --- | --- |
  | `Frontend (test + build)` | `ci.yml` |
  | `API (syntax + boot smoke)` | `ci.yml` |
  | `CodeQL (javascript-typescript)` | `security.yml` |
  | `Dependency audit (frontend)` | `security.yml` |
  | `Dependency audit (api)` | `security.yml` |
  | `Secret scan (gitleaks)` | `security.yml` |

  Checks only appear in the picker after they have run once on a PR.
- [x] **Block force pushes** and **block deletions**
- [x] **Require linear history** if using squash merges (recommended: one PR = one changelog line)

## Repo settings to enable (Settings → Code security)

- Dependabot alerts + Dependabot security updates
- Secret scanning + push protection
- Code scanning (CodeQL results appear in the Security tab)

## Automation PRs (Dependabot, release-please)

Bot PRs carry the `automation` label. They must still pass **all required status checks**, but do
not need a human approval when the change is routine and green:

- Dependabot minor/patch bumps: auto-merge allowed once checks pass.
- Dependabot **major** bumps and the **release-please PR**: a human merges them (a release is a
  deliberate act).

Implementation: add a ruleset **bypass** for the `dependabot[bot]` actor on the
"required approvals" rule only (not on status checks), or let a maintainer enable auto-merge on
the PR (`gh pr merge --auto --squash`) after review. Don't weaken the status-check requirement.

## One-time follow-ups

- Create a fine-grained PAT (Contents + Pull requests: write) as repo secret `RELEASE_PLEASE_TOKEN`:
  PRs opened by the default `GITHUB_TOKEN` don't trigger CI, so the release PR would never get its
  required checks.
- Make GHCR packages `gymme-api` / `gymme-web` public so `docker compose pull` works anonymously.
