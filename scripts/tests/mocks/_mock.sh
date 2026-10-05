# shellcheck shell=bash
# shellcheck disable=SC2154
# Shared body for every mock: log the call, honour MOCK_EXIT_* / MOCK_OUT_* overrides.
# Lookup order (NAME = upper-cased command, - becomes _): NAME_ARG1_ARG2, NAME_ARG1, NAME.
name="$(basename "$0")"
key="$(printf '%s' "$name" | tr 'a-z-' 'A-Z_')"
a1="$(printf '%s' "${1:-}" | tr 'a-z-' 'A-Z_')"
a2="$(printf '%s' "${2:-}" | tr 'a-z-' 'A-Z_')"
[ -n "${MOCK_LOG:-}" ] && printf '%s %s\n' "$name" "$*" >>"$MOCK_LOG"
# Record stdin when the caller pipes a body (sendmail, curl --data @-).
if [ ! -t 0 ] && [ -n "${MOCK_LOG:-}" ] && [ "${MOCK_READ_STDIN:-0}" = 1 ]; then
  cat >"$MOCK_LOG.stdin" 2>/dev/null || true
fi
for suffix in "${key}_${a1}_${a2}" "${key}_${a1}" "${key}"; do
  eval "out=\${MOCK_OUT_${suffix}-__unset__}"
  if [ "$out" != "__unset__" ]; then printf '%s\n' "$out"; break; fi
done
for suffix in "${key}_${a1}_${a2}" "${key}_${a1}" "${key}"; do
  eval "code=\${MOCK_EXIT_${suffix}-__unset__}"
  if [ "$code" != "__unset__" ]; then exit "$code"; fi
done
exit 0
