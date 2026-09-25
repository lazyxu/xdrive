#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HELPER="$ROOT/scripts/ci/prepare-go-mod-cache.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM
mkdir -p "$TMP/bin" "$TMP/state" "$TMP/modcache"

cat >"$TMP/bin/go" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$TEST_STATE/go-args"
case "$*" in
  "env GOMODCACHE")
    printf '%s\n' "$TEST_MODCACHE"
    ;;
  "mod download")
    printf 'download\n' >>"$TEST_STATE/events"
    ;;
  "mod verify")
    count_file="$TEST_STATE/verify-count"
    count=0
    [[ -f "$count_file" ]] && count="$(cat "$count_file")"
    count=$((count + 1))
    printf '%s\n' "$count" >"$count_file"
    printf 'verify-%s\n' "$count" >>"$TEST_STATE/events"
    failures="${TEST_VERIFY_FAILURES:-0}"
    if (( count <= failures )); then
      echo "example.invalid/module v1.0.0: dir has been modified" >&2
      exit 1
    fi
    echo "all modules verified"
    ;;
  "clean -modcache")
    printf 'clean\n' >>"$TEST_STATE/events"
    rm -rf "$TEST_MODCACHE"
    ;;
  *)
    echo "unexpected go invocation: $*" >&2
    exit 9
    ;;
esac
SH
chmod +x "$TMP/bin/go"

run_case() {
  local failures="$1" expected_verify="$2" expect_clean="$3"
  : >"$TMP/state/go-args"
  : >"$TMP/state/events"
  rm -f "$TMP/state/verify-count"
  rm -rf "$TMP/modcache"
  mkdir -p "$TMP/modcache"
  TEST_STATE="$TMP/state" TEST_MODCACHE="$TMP/modcache" TEST_VERIFY_FAILURES="$failures"     GOMODCACHE="$TMP/modcache" PATH="$TMP/bin:/usr/bin:/bin"     bash "$HELPER" >"$TMP/out" 2>"$TMP/err"

  test "$(cat "$TMP/state/verify-count")" = "$expected_verify"
  if [[ "$expect_clean" == "1" ]]; then
    grep -q '^clean$' "$TMP/state/events"
    grep -q 'restored Go module cache failed verification; rebuilding it' "$TMP/err"
  else
    if grep -q '^clean$' "$TMP/state/events"; then
      echo "healthy cache was unexpectedly cleaned" >&2
      exit 1
    fi
  fi
}

run_case 0 1 0
run_case 1 2 1

rm -f "$TMP/state/verify-count"
rm -rf "$TMP/modcache"
mkdir -p "$TMP/modcache"
if TEST_STATE="$TMP/state" TEST_MODCACHE="$TMP/modcache" TEST_VERIFY_FAILURES=2   GOMODCACHE="$TMP/modcache" PATH="$TMP/bin:/usr/bin:/bin"   bash "$HELPER" >"$TMP/out" 2>"$TMP/err"; then
  echo "persistently corrupt module cache should fail" >&2
  exit 1
fi
grep -q 'still fails verification after a clean download' "$TMP/err"

echo "Go module cache recovery tests passed"
