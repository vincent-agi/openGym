#!/usr/bin/env bash
set -u
# shellcheck source=helpers.sh
. "$(dirname "$0")/helpers.sh"
OG="$REPO_ROOT/scripts/opengym"

new_sandbox
export OPENGYM_ROOT="$REPO_ROOT"
want="$("$OG" --version | cut -d' ' -f2)"

MOCK_OUT_DOCKER_COMPOSE_VERSION="v2.29.0" MOCK_OUT_CURL="curl 8.4.0 (mock)" assert_exit 0 "version command runs" -- "$OG" version
assert_contains "$want" "$T_OUT" "shows opengym version"
assert_contains "v2.29.0" "$T_OUT" "shows docker compose version"
assert_contains "curl 8.4.0" "$T_OUT" "shows curl version"
assert_contains "jq" "$T_OUT" "shows jq line"

# missing tools are reported as n/a, never an error
P="$(MOCKS="" limited_path bash sed head cut tr date basename dirname cat wc sort)"
assert_exit 0 "version works with docker/jq/curl absent" -- env PATH="$P" "$BASH" "$OG" version
assert_contains "n/a" "$T_OUT" "absent tools are n/a"

# the command template is a runnable, documented skeleton
assert_exit 0 "TEMPLATE --help exits 0" -- bash "$REPO_ROOT/scripts/TEMPLATE.sh" --help
for flag in --dry-run --yes --json --help; do
  assert_contains "$flag" "$T_OUT" "template documents $flag"
done
assert_exit 2 "TEMPLATE rejects unknown flags" -- bash "$REPO_ROOT/scripts/TEMPLATE.sh" --bogus
assert_exit 0 "TEMPLATE runs with --dry-run" -- bash "$REPO_ROOT/scripts/TEMPLATE.sh" --dry-run

t_summary
