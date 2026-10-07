#!/usr/bin/env bash
set -u
# shellcheck source=helpers.sh
. "$(dirname "$0")/helpers.sh"

# mk_tree: sandbox repo with the real dispatcher + libs and fake commands.
mk_tree() {
  new_sandbox
  mkdir -p "$SB/scripts/user" "$SB/scripts/ops" "$SB/scripts/stats"
  cp "$REPO_ROOT/scripts/gymme" "$SB/scripts/gymme"
  cp -R "$REPO_ROOT/scripts/lib" "$SB/scripts/lib"
  printf '#!/usr/bin/env bash\n# desc: say hello\necho "hello args=$*"\n' >"$SB/scripts/user/hello.sh"
  printf '#!/usr/bin/env bash\n# desc: always critical\nexit 20\n' >"$SB/scripts/ops/boom.sh"
  printf '#!/usr/bin/env bash\n# desc: last one\n:\n' >"$SB/scripts/user/zeta.sh"
  printf '#!/usr/bin/env bash\n# desc: first one\n:\n' >"$SB/scripts/user/alpha.sh"
  OG="$SB/scripts/gymme"
}

mk_tree
assert_exit 0 "runs a command" -- "$OG" hello
assert_contains "hello args=" "$T_OUT" "command output shown"
assert_exit 20 "propagates exit code" -- "$OG" boom
assert_exit 0 "args forwarded" -- "$OG" hello a --b "c d"
assert_contains "hello args=a --b c d" "$T_OUT" "all args reach the script"
assert_exit 0 "--help is passed through to the script" -- "$OG" hello --help
assert_contains "args=--help" "$T_OUT" "script owns --help"

# help
assert_exit 0 "help exits 0" -- "$OG" help
help_out="$T_OUT"
assert_contains "hello" "$help_out" "help lists hello"
assert_contains "say hello" "$help_out" "help shows description"
assert_contains "always critical" "$help_out" "help lists ops commands"
assert_contains "user" "$help_out" "help groups by suite (user)"
assert_contains "ops" "$help_out" "help groups by suite (ops)"
a="$(printf '%s\n' "$help_out" | grep -n 'alpha' | head -1 | cut -d: -f1)"
z="$(printf '%s\n' "$help_out" | grep -n 'zeta' | head -1 | cut -d: -f1)"
if [ -n "$a" ] && [ -n "$z" ] && [ "$a" -lt "$z" ]; then _t_ok; else _t_fail "help sorted alphabetically within a suite"; fi
assert_exit 0 "no args = help" -- "$OG"
assert_contains "Usage" "$T_OUT" "no args prints usage"
assert_exit 0 "-h = help" -- "$OG" -h
assert_exit 0 "--help = help" -- "$OG" --help

# unknown command
assert_exit 2 "unknown command exits 2" -- "$OG" hell
assert_contains "unknown command: hell" "$T_OUT" "names the unknown command"
assert_contains "hello" "$T_OUT" "suggests prefix match"
assert_exit 2 "unknown without suggestion exits 2" -- "$OG" qqqq
assert_contains "gymme help" "$T_OUT" "points to help"

# version
printf '{".":"1.2.3"}\n' >"$SB/.release-please-manifest.json"
assert_exit 0 "--version exits 0" -- "$OG" --version
assert_eq "gymme 1.2.3" "$T_OUT" "version from release-please manifest"
rm "$SB/.release-please-manifest.json"
assert_exit 0 "--version without manifest exits 0" -- "$OG" --version
assert_eq "gymme unknown" "$T_OUT" "version falls back to unknown"

# symlink invocation (absolute and relative)
mkdir -p "$SB/elsewhere"
ln -s "$OG" "$SB/elsewhere/gymme"
assert_exit 0 "absolute symlink" -- "$SB/elsewhere/gymme" hello
assert_contains "hello args=" "$T_OUT" "found scripts via symlink"
mkdir -p "$SB/rel"
ln -s ../scripts/gymme "$SB/rel/og"
assert_exit 0 "relative symlink" -- "$SB/rel/og" hello

# works from another cwd
assert_exit 0 "other cwd" -- bash -c "cd /tmp && '$OG' hello"

# ambiguity fails loudly
mk_tree
printf '#!/usr/bin/env bash\n# desc: dup\n:\n' >"$SB/scripts/ops/hello.sh"
assert_exit 1 "duplicate command name exits 1" -- "$OG" hello
assert_contains "ambiguous" "$T_OUT" "ambiguity message"
assert_exit 1 "help --check flags duplicates" -- "$OG" help --check

# help --check: missing desc
mk_tree
assert_exit 0 "help --check passes when all have desc" -- "$OG" help --check
printf '#!/usr/bin/env bash\necho nodesc\n' >"$SB/scripts/user/nodesc.sh"
assert_exit 1 "help --check flags missing desc" -- "$OG" help --check
assert_contains "nodesc" "$T_OUT" "names the offending script"

# real repo: every shipped command has a description
assert_exit 0 "real tree passes help --check" -- "$REPO_ROOT/scripts/gymme" help --check

t_summary
