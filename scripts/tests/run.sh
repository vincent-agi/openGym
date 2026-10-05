#!/usr/bin/env bash
# Run every scripts/tests/test_*.sh in its own bash. Exit 1 if any assertion failed.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
files=0 pass=0 fail=0 broken=0
for t in "$here"/test_*.sh; do
  [ -e "$t" ] || continue
  files=$((files + 1))
  echo "== $(basename "$t")"
  out="$("$BASH" "$t" 2>&1)"
  rc=$?
  printf '%s\n' "$out" | grep -v '^T_RESULT ' || true
  res="$(printf '%s\n' "$out" | grep '^T_RESULT ' | tail -1)"
  if [ -z "$res" ]; then
    echo "  BROKEN: $(basename "$t") produced no T_RESULT (exit $rc)" >&2
    broken=$((broken + 1))
    continue
  fi
  # shellcheck disable=SC2086
  set -- $res
  pass=$((pass + $2))
  fail=$((fail + $3))
  [ "$rc" -ne 0 ] && [ "$3" -eq 0 ] && broken=$((broken + 1))
done
echo "$files files, $((pass + fail)) assertions, $fail failed, $broken broken"
[ "$fail" -eq 0 ] && [ "$broken" -eq 0 ]
