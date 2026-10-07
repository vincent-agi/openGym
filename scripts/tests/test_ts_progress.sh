#!/usr/bin/env bash
set -u
# shellcheck source=helpers.sh
. "$(dirname "$0")/helpers.sh"
PROG="$REPO_ROOT/scripts/ts-progress.mjs"

# A small tree: some TypeScript, some JavaScript, and things that must not be counted.
T="$(mktemp -d)"
mkdir -p "$T/api/test" "$T/frontend/src/lib" "$T/frontend/src/views" "$T/frontend/src/locales" "$T/frontend/node_modules/x" \
  "$T/frontend/dist" "$T/frontend/android/app" "$T/frontend/public" "$T/shared"
printf 'export const a: number = 1\nexport const b = 2\n' >"$T/api/a.ts"
printf 'const c = 3\n' >"$T/api/c.js"
printf 'it("x", () => {})\n' >"$T/api/test/a.test.ts"
printf 'export const d: string = "d"\n' >"$T/frontend/src/lib/d.ts"
printf 'export const V = () => null\n' >"$T/frontend/src/views/V.jsx"
printf 'export default {}\n' >"$T/frontend/src/locales/fr.js"
printf 'module.exports = 1\n' >"$T/frontend/node_modules/x/i.js"
printf 'bundle\n' >"$T/frontend/dist/b.js"
printf 'native\n' >"$T/frontend/android/app/n.js"
printf 'self.addEventListener\n' >"$T/frontend/public/sw.js"
printf 'export type T = 1\n' >"$T/shared/t.ts"
run() { node "$PROG" --root "$T" "$@"; }

# --- counting --------------------------------------------------------------------------------
assert_exit 0 "the report runs" -- run
assert_contains "api" "$T_OUT" "lists the api package"
assert_contains "frontend" "$T_OUT" "lists the frontend package"
assert_contains "shared" "$T_OUT" "lists the shared package"

assert_exit 0 "json output" -- run --json
J="$T_OUT"
count() { node -e "const j=JSON.parse(process.argv[1]);const p=j.packages.find(p=>p.name===process.argv[2]);console.log(String(p[process.argv[3]]))" "$J" "$1" "$2"; }
assert_eq "1" "$(count api js)" "api has one JavaScript file"
assert_eq "2" "$(count api ts)" "api has two TypeScript files (the test counts)"
assert_eq "1" "$(count frontend js)" "frontend: the .jsx counts, node_modules/dist/android/public/locales do not"
assert_eq "1" "$(count frontend ts)" "frontend has one TypeScript file"
assert_eq "0" "$(count shared js)" "shared is all TypeScript"
assert_eq "1" "$(count shared ts)" "shared has one file"
assert_eq "1" "$(node -e "console.log(String(JSON.parse(process.argv[1]).excluded.data))" "$J")" "the locale file is reported as data, not counted as code"
assert_eq "3" "$(count api tsLines)" "TypeScript lines are summed (2 + 1)"
assert_eq "1" "$(count api jsLines)" "JavaScript lines are summed"

# --- markdown for the job summary --------------------------------------------------------------
assert_exit 0 "markdown output" -- run --markdown
assert_contains "| Package |" "$T_OUT" "has a table header"
assert_contains "| api |" "$T_OUT" "has a row per package"

# --- ratchet ---------------------------------------------------------------------------------
assert_exit 0 "with no ratchet file, --check passes" -- run --check
printf '# directories that are fully TypeScript\n\nshared\napi/test\n' >"$T/ts-migrated.txt"
assert_exit 0 "fully converted directories pass --check" -- run --check
assert_contains "2 director" "$T_OUT" "says how many directories are guarded"

printf 'shared\napi\n' >"$T/ts-migrated.txt"
assert_exit 1 "a JavaScript file in a guarded directory fails --check" -- run --check
assert_contains "api/c.js" "$T_OUT" "names the offending file"
assert_contains "ts-rename.sh" "$T_OUT" "says how to convert it"

printf 'frontend/src/lib\nfrontend/src/views\n' >"$T/ts-migrated.txt"
assert_exit 1 "a .jsx counts too" -- run --check
assert_contains "frontend/src/views/V.jsx" "$T_OUT" "names the jsx file"

printf 'shared\nnot/a/dir\n' >"$T/ts-migrated.txt"
assert_exit 1 "a guarded directory that does not exist is an error (typo)" -- run --check
assert_contains "not/a/dir" "$T_OUT" "names the missing directory"

printf 'shared\n' >"$T/ts-migrated.txt"
assert_exit 2 "unknown flags are a usage error" -- run --bogus

# the real repository must pass its own ratchet
assert_exit 0 "this repository passes its ratchet" -- node "$PROG" --root "$REPO_ROOT" --check

rm -rf "$T"
t_summary
