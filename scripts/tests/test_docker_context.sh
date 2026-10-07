#!/usr/bin/env bash
set -u
# shellcheck source=helpers.sh
. "$(dirname "$0")/helpers.sh"
cd "$REPO_ROOT" || exit 1

# Both images are built from the repository root: the API and the frontend import ./shared, which
# lives outside either package. These checks catch the mistakes a Docker build only reveals minutes later.

# --- build contexts -------------------------------------------------------------------------------
compose="$(cat docker-compose.yml)"
assert_contains "dockerfile: api/Dockerfile" "$compose" "compose builds the API from api/Dockerfile"
assert_contains "dockerfile: web/Dockerfile" "$compose" "compose builds the web image from web/Dockerfile"
api_block="$(awk '/^  api:/{f=1;next} /^  [a-z]+:/{f=0} f' docker-compose.yml)"
assert_contains "context: ." "$api_block" "the API build context is the repository root"
publish="$(cat .github/workflows/publish.yml)"
api_pub="$(awk '/- name: api/{f=1;next} /- name: web/{f=0} f' .github/workflows/publish.yml)"
assert_contains "context: ." "$api_pub" "the published API image is built from the root too"
assert_contains "dockerfile: ./api/Dockerfile" "$api_pub" "from api/Dockerfile"
assert_not_contains "context: ./api" "$publish" "no job still builds from ./api"

# --- every COPY source exists, and .dockerignore does not hide it -----------------------------------
ignored() { # path -> 0 if .dockerignore would exclude it (prefix match, enough for our rules)
  local path="$1" pat
  [ -f .dockerignore ] || return 1
  while IFS= read -r pat; do
    pat="${pat%%#*}"; pat="${pat// /}"; pat="${pat%/}"
    [ -z "$pat" ] && continue
    case "$pat" in '!'*) continue ;; esac
    case "$path" in "$pat" | "$pat"/* ) return 0 ;; esac
  done <.dockerignore
  return 1
}
for df in api/Dockerfile web/Dockerfile; do
  while read -r _ src _; do
    case "$src" in --*) continue ;; esac
    base="${src%%\**}"                     # up to the first wildcard
    base="${base%/}"
    [ -z "$base" ] && base="."
    if [ -e "$base" ] || ls $src >/dev/null 2>&1; then _t_ok; else _t_fail "$df: COPY source '$src' does not exist"; fi
    if ignored "$base"; then _t_fail "$df: COPY source '$src' is excluded by .dockerignore"; else _t_ok; fi
  done < <(grep -E '^COPY ' "$df" | grep -v -- '--from')
done

# --- the API image carries the shared contract and its sources ---------------------------------------
api_df="$(cat api/Dockerfile)"
assert_contains "COPY shared/" "$api_df" "the API image copies shared/"
assert_contains "api/package.json" "$api_df" "dependencies are installed from api/package.json"
web_df="$(cat web/Dockerfile)"
assert_contains "COPY shared/" "$web_df" "the web build copies shared/"

# --- what must never be sent to the daemon -----------------------------------------------------------
for must in node_modules .git media data docs frontend/android frontend/ios; do
  assert_contains "$must" "$(cat .dockerignore 2>/dev/null)" ".dockerignore excludes $must"
done
for never in api shared frontend web; do
  if ignored "$never"; then _t_fail ".dockerignore hides $never, which a Dockerfile needs"; else _t_ok; fi
done

t_summary
