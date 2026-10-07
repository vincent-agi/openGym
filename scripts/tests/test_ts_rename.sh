#!/usr/bin/env bash
set -u
# shellcheck source=helpers.sh
. "$(dirname "$0")/helpers.sh"
TS="$REPO_ROOT/scripts/ts-rename.sh"

# A throw-away repository with a few modules that import each other, a component and a test.
make_repo() {
  R="$(mktemp -d)"
  (
    cd "$R" || exit 1
    git init -q . && git config user.email t@t && git config user.name t
    mkdir -p lib views other node_modules/pkg
    printf "export const b = 1\n" >lib/b.js
    printf "import { b } from './b.js'\nimport React from 'react'\nexport const a = b + 1\n" >lib/a.js
    printf "import { a } from './a.js'\ntest('a', () => { expect(a).toBe(2) })\n" >lib/a.test.js
    printf "import { b } from '../lib/b.js'\nexport const C = () => <i>{b}</i>\nconst x = import('../lib/a.js')\n" >views/C.jsx
    printf "const packs = import.meta.glob('../lib/*.js')\nexport const o = 1\n" >other/glob.js
    printf "module.exports = 1\n" >node_modules/pkg/index.js
    printf '{ "a": 1 }\n' >lib/data.json
    git add -A -f && git commit -q -m init
  )
  echo "$R"
}

# --- usage and refusals ----------------------------------------------------------------------
R="$(make_repo)"
assert_exit 2 "no argument is a usage error" -- bash -c "cd '$R' && '$TS'"
assert_exit 2 "an unknown path is a usage error" -- bash -c "cd '$R' && '$TS' nope.js"
assert_exit 2 "an unknown flag is a usage error" -- bash -c "cd '$R' && '$TS' --bogus lib"
printf 'dirty\n' >>"$R/lib/b.js"
assert_exit 1 "a dirty working tree is refused" -- bash -c "cd '$R' && '$TS' lib"
assert_contains "clean" "$T_OUT" "says why"
assert_file "$R/lib/a.js" "nothing was renamed"
git -C "$R" checkout -q -- lib/b.js

# --- dry run ---------------------------------------------------------------------------------
assert_exit 0 "dry run succeeds" -- bash -c "cd '$R' && '$TS' --dry-run lib views"
assert_contains "lib/a.js -> lib/a.ts" "$T_OUT" "dry run lists a rename"
assert_contains "lib/a.test.js -> lib/a.test.ts" "$T_OUT" "tests keep their .test infix"
assert_contains "views/C.jsx -> views/C.tsx" "$T_OUT" "jsx becomes tsx"
assert_file "$R/lib/a.js" "dry run renamed nothing"
assert_eq "init" "$(git -C "$R" log -1 --format=%s)" "dry run committed nothing"

# --- the real thing --------------------------------------------------------------------------
assert_exit 0 "a batch is renamed" -- bash -c "cd '$R' && '$TS' lib views"
assert_no_file "$R/lib/a.js" "old name is gone"
assert_file "$R/lib/a.ts" ".js became .ts"
assert_file "$R/lib/a.test.ts" ".test.js became .test.ts"
assert_file "$R/views/C.tsx" ".jsx became .tsx"
assert_file "$R/lib/data.json" "non-source files are left alone"
assert_file "$R/node_modules/pkg/index.js" "node_modules is never touched"
assert_file "$R/other/glob.js" "files outside the given paths are left alone"

# import specifiers follow, packages and patterns do not
assert_contains "from './b.ts'" "$(cat "$R/lib/a.ts")" "relative import updated"
assert_contains "from 'react'" "$(cat "$R/lib/a.ts")" "package import untouched"
assert_contains "from './a.ts'" "$(cat "$R/lib/a.test.ts")" "test import updated"
assert_contains "from '../lib/b.ts'" "$(cat "$R/views/C.tsx")" "cross-directory import updated"
assert_contains "import('../lib/a.ts')" "$(cat "$R/views/C.tsx")" "dynamic import updated"
assert_contains "import.meta.glob('../lib/*.js')" "$(cat "$R/other/glob.js")" "glob patterns are never rewritten"
assert_contains "glob" "$T_OUT" "a glob that may need a manual edit is reported"

# history: the rename commit is pure (100 % similar), and blame ignores the mechanical commits
subjects="$(git -C "$R" log --format=%s)"
assert_contains "chore(ts): rename" "$subjects" "rename commit"
assert_contains "chore(ts): update import specifiers" "$subjects" "specifier commit"
assert_contains "chore(ts): ignore" "$subjects" "blame-ignore commit"
rename_commit="$(git -C "$R" log --format=%H --grep='^chore(ts): rename' -1)"
status="$(git -C "$R" diff -M100% --name-status "$rename_commit~1" "$rename_commit")"
assert_eq "4" "$(printf '%s\n' "$status" | grep -c '^R100')" "four files, all renamed with 100% similarity"
assert_eq "0" "$(printf '%s\n' "$status" | grep -vc '^R100')" "nothing else in the rename commit"
ignore="$(cat "$R/.git-blame-ignore-revs")"
assert_contains "$rename_commit" "$ignore" "the rename commit is in .git-blame-ignore-revs"
assert_eq "2" "$(grep -c '^[0-9a-f]\{40\}' "$R/.git-blame-ignore-revs")" "both mechanical commits are listed"
assert_eq "2" "$(git -C "$R" log --follow --format=%h -- lib/b.ts | wc -l | tr -d ' ')" "git log --follow reaches the original file"
assert_exit 0 "the working tree is clean afterwards" -- bash -c "cd '$R' && test -z \"\$(git status --porcelain)\""

# --- idempotent -------------------------------------------------------------------------------
before="$(git -C "$R" rev-parse HEAD)"
assert_exit 0 "running again is harmless" -- bash -c "cd '$R' && '$TS' lib views"
assert_contains "nothing to rename" "$T_OUT" "says so"
assert_eq "$before" "$(git -C "$R" rev-parse HEAD)" "and commits nothing"

# --- a single file, and a file whose target name exists ----------------------------------------
R2="$(make_repo)"
assert_exit 0 "one file can be renamed" -- bash -c "cd '$R2' && '$TS' lib/b.js"
assert_file "$R2/lib/b.ts" "that file was renamed"
assert_file "$R2/lib/a.js" "its neighbours were not"
assert_contains "from './b.ts'" "$(cat "$R2/lib/a.js")" "yet the importer follows"
R3="$(make_repo)"
printf 'x\n' >"$R3/lib/b.ts" && git -C "$R3" add lib/b.ts && git -C "$R3" commit -q -m "ts twin"
assert_exit 1 "an existing target is refused" -- bash -c "cd '$R3' && '$TS' lib/b.js"
assert_file "$R3/lib/b.js" "and nothing moved"

rm -rf "$R" "$R2" "$R3"
t_summary
