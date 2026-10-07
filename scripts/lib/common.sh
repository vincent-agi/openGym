# shellcheck shell=bash
# gymme common helpers. Source it; do not execute it.
# bash 3.2 compatible (macOS default): no mapfile, no associative arrays, no readlink -f.

set -euo pipefail

# --- paths ------------------------------------------------------------------

# Resolve a path through symlinks without readlink -f (absent on macOS).
resolve_symlinks() { # path
  local p="$1" dir target
  while [ -L "$p" ]; do
    dir="$(cd "$(dirname "$p")" && pwd)"
    target="$(readlink "$p")"
    case "$target" in
      /*) p="$target" ;;
      *) p="$dir/$target" ;;
    esac
  done
  printf '%s/%s\n' "$(cd "$(dirname "$p")" && pwd)" "$(basename "$p")"
}

if [ -z "${GYMME_ROOT:-}" ]; then
  _og_self="$(resolve_symlinks "${BASH_SOURCE[0]}")"
  GYMME_ROOT="$(cd "$(dirname "$_og_self")/../.." && pwd)"
  unset _og_self
fi
export GYMME_ROOT

# --- colours ----------------------------------------------------------------

C_RED='' C_YELLOW='' C_GREEN='' C_DIM='' C_RESET=''
if { [ -t 2 ] || [ "${GYMME_FORCE_TTY:-}" = 1 ]; } && [ -z "${NO_COLOR:-}" ]; then
  C_RED=$'\033[31m' C_YELLOW=$'\033[33m' C_GREEN=$'\033[32m' C_DIM=$'\033[2m' C_RESET=$'\033[0m'
fi

export C_RED C_YELLOW C_GREEN C_DIM C_RESET

# --- messages (stderr: stdout stays clean for data / --json) ------------------

info() { printf '%s\n' "$*" >&2; }
ok() { printf '%s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*" >&2; }
warn() { printf '%swarning:%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
die() { printf '%serror:%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }
die_usage() { printf '%susage error:%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 2; }

# --- environment ----------------------------------------------------------------

os_name() {
  case "${OSTYPE:-}" in
    darwin*) echo macos ;;
    linux*) echo linux ;;
    *) echo other ;;
  esac
}

require_cmd() { # cmd
  command -v "$1" >/dev/null 2>&1 && return 0
  case "$(os_name)" in
    macos) die "missing required command '$1'. Install it with: brew install $1" ;;
    linux) die "missing required command '$1'. Install it with your package manager, e.g. apt install $1" ;;
    *) die "missing required command '$1'." ;;
  esac
}

# Octal permission bits of a file (e.g. 600). BSD stat on macOS, GNU stat on Linux.
file_mode() { # path
  stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"
}

# Restrictive permissions for anything that may hold user data.
secure_umask() { umask 077; }

# Ask a yes/no question. ASSUME_YES=1 answers yes; no TTY answers no.
# GYMME_FORCE_TTY=1 is a test hook that lets stdin act as the terminal.
confirm() { # question
  [ "${ASSUME_YES:-}" = 1 ] && return 0
  if [ ! -t 0 ] && [ "${GYMME_FORCE_TTY:-}" != 1 ]; then
    return 1
  fi
  local reply=''
  printf '%s [y/N] ' "$1" >&2
  read -r reply || true
  case "$reply" in
    y | Y | yes | YES | Yes) return 0 ;;
    *) return 1 ;;
  esac
}

# run_with_timeout <seconds> <command...>: run, kill after <seconds>. Exit code of the command (143 when killed).
# Portable: macOS has no `timeout`.
run_with_timeout() {
  local secs="$1" pid watcher rc=0
  shift
  "$@" &
  pid=$!
  ( sleep "$secs"; kill "$pid" ) </dev/null >/dev/null 2>&1 &
  watcher=$!
  wait "$pid" 2>/dev/null || rc=$?
  kill "$watcher" 2>/dev/null || true
  wait "$watcher" 2>/dev/null || true
  return "$rc"
}
