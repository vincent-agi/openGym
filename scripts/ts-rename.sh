#!/usr/bin/env bash
# Rename JavaScript files to TypeScript in a batch, without losing their Git history.
#
#   scripts/ts-rename.sh [--dry-run] <file-or-directory>...
#
#   .js -> .ts   .jsx -> .tsx   .test.js -> .test.ts   .test.jsx -> .test.tsx
#
# It makes three commits, so each can be reviewed and blamed for what it is:
#   1. "rename": git mv only. Every file is a 100 % similar rename (checked), so history follows.
#   2. "update import specifiers": './a.js' -> './a.ts' in every importer. Purely mechanical.
#   3. ".git-blame-ignore-revs": records 1 and 2 so `git blame` skips them.
# Commit 1 alone does not build (importers still say .js); the commits belong to one pull request.
#
# Never touched: node_modules, dist, android, ios, public/ (files copied verbatim into the build),
# non-source files, and anything outside the paths given. Glob patterns such as
# import.meta.glob('../x/*.js') and plain strings that still name an old file are *reported*, not edited.
# See docs/adr/0001-migrate-to-typescript.md.
#
# Exit codes: 0 done or nothing to do · 1 refused (dirty tree, target exists) · 2 usage error
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/ts-rename.sh [--dry-run] <file-or-directory>...

  --dry-run   print the renames, change nothing
  --help, -h  this help
USAGE
}
die() { echo "ts-rename: $2" >&2; exit "$1"; }

DRY=0
PATHS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    -h | --help) usage; exit 0 ;;
    -*) usage >&2; die 2 "unknown option: $1" ;;
    *) PATHS+=("$1") ;;
  esac
  shift
done
[ ${#PATHS[@]} -gt 0 ] || { usage >&2; exit 2; }

command -v node >/dev/null 2>&1 || die 1 "node is required to rewrite the import specifiers"
cd "$(git rev-parse --show-toplevel)" || die 1 "not inside a Git repository"
for p in "${PATHS[@]}"; do
  [ -e "$p" ] || die 2 "no such path: $p"
done

# The new name of a tracked source file, or nothing when it is not ours to rename.
target_of() {
  case "$1" in
    */node_modules/* | */dist/* | */android/* | */ios/* | public/* | */public/* | node_modules/* | dist/*) return 0 ;;
    *.d.js) return 0 ;;
    *.jsx) echo "${1%.jsx}.tsx" ;;
    *.js) echo "${1%.js}.ts" ;;
  esac
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
MOVES="$TMP/moves"
: >"$MOVES"
for p in "${PATHS[@]}"; do
  while IFS= read -r -d '' f; do
    t="$(target_of "$f")"
    [ -n "$t" ] || continue
    [ -e "$t" ] && die 1 "target already exists: $t (from $f)"
    printf '%s\t%s\n' "$f" "$t" >>"$MOVES"
  done < <(git ls-files -z -- "$p")
done
sort -u -o "$MOVES" "$MOVES"

if [ ! -s "$MOVES" ]; then
  echo "ts-rename: nothing to rename"
  exit 0
fi

if [ "$DRY" -eq 1 ]; then
  while IFS="$(printf '\t')" read -r old new; do echo "$old -> $new"; done <"$MOVES"
  exit 0
fi

[ -z "$(git status --porcelain)" ] || die 1 "the working tree must be clean (commit or stash first)"

LABEL="${PATHS[*]}"
while IFS="$(printf '\t')" read -r old new; do git mv "$old" "$new"; done <"$MOVES"
# Every staged change must be a pure rename, or the history would not follow.
if git diff --cached -M100% --name-status | grep -v '^R100' >/dev/null; then
  git reset -q --hard HEAD
  die 1 "internal error: a staged change is not a 100% rename; nothing was committed"
fi
git commit -q -m "chore(ts): rename $LABEL to TypeScript" -m "Rename only (git mv): every file is a 100% similar rename, so history follows. Imports are fixed in the next commit."
RENAME_COMMIT="$(git rev-parse HEAD)"

# Rewrite relative specifiers that point at a renamed file; report what cannot be rewritten safely.
MOVES="$MOVES" node - <<'NODE'
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process')
const moves = new Map(fs.readFileSync(process.env.MOVES, 'utf8').trim().split('\n').filter(Boolean).map(l => l.split('\t')))
const SKIP = /(^|\/)(node_modules|dist|android|ios)\//
const files = cp.execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const source = files.filter(f => /\.(m|c)?[jt]sx?$/.test(f) && !SKIP.test(f))
// from '…', import('…'), import '…', vi.mock('…') with a relative path
const SPECIFIER = /((?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bvi\.(?:do)?[mM]ock\(\s*)(['"]))(\.{1,2}\/[^'"\n]+)\2/g
let changedFiles = 0
for (const file of source) {
  const text = fs.readFileSync(file, 'utf8')
  const out = text.replace(SPECIFIER, (whole, head, quote, spec) => {
    const resolved = path.posix.join(path.posix.dirname(file), spec)
    if (!moves.has(resolved)) return whole
    return head + spec.replace(/\.jsx?$/, m => (m === '.js' ? '.ts' : '.tsx')) + quote
  })
  if (out !== text) { fs.writeFileSync(file, out); changedFiles++ }
}
console.log(`ts-rename: ${moves.size} file(s) renamed, imports updated in ${changedFiles} file(s)`)

// Things a person must look at.
const warn = []
const GLOB = /import\.meta\.glob\(\s*['"][^'"]*\.jsx?['"]/
const names = [...moves.keys()].map(f => path.posix.basename(f))
for (const file of files) {
  if (SKIP.test(file) || /(package-lock\.json|\.lock|CHANGELOG\.md)$|^docs\/superpowers\//.test(file) || !/\.(m?[jt]sx?|md|json|ya?ml|html|sh)$/.test(file)) continue
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch { continue }
  text.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|#|\*|\/\*)/.test(line)) return   // comments explain, they do not break
    if (GLOB.test(line)) warn.push(`${file}:${i + 1}: glob pattern names .js/.jsx files; check it by hand`)
    for (const n of names) {
      const re = new RegExp('(^|[^\\w.-])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w])')
      if (re.test(line) && !GLOB.test(line)) { warn.push(`${file}:${i + 1}: still mentions ${n}`); break }
    }
  })
}
if (warn.length) console.log('ts-rename: please check:\n  ' + warn.slice(0, 40).join('\n  ') + (warn.length > 40 ? `\n  … and ${warn.length - 40} more` : ''))
NODE

IMPORT_COMMIT=""
if [ -n "$(git status --porcelain)" ]; then
  git add -u
  git commit -q -m "chore(ts): update import specifiers for $LABEL" -m "Mechanical: './x.js' becomes './x.ts' wherever x was renamed in the previous commit."
  IMPORT_COMMIT="$(git rev-parse HEAD)"
fi

{
  [ -f .git-blame-ignore-revs ] || printf '# Mechanical commits that `git blame` should skip (see docs/technical/development.md).\n# Enable locally with: git config blame.ignoreRevsFile .git-blame-ignore-revs\n'
  printf '# chore(ts): rename %s\n%s\n' "$LABEL" "$RENAME_COMMIT"
  [ -z "$IMPORT_COMMIT" ] || printf '%s\n' "$IMPORT_COMMIT"
} >>.git-blame-ignore-revs
git add .git-blame-ignore-revs
git commit -q -m "chore(ts): ignore the mechanical rename commits in blame"
echo "ts-rename: rename commit $RENAME_COMMIT"
