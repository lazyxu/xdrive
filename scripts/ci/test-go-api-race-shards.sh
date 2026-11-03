#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"
export RACE_TEST_NAMES="$tmp/names" RACE_TEST_EXECUTED="$tmp/executed"
{
  printf '%s\n' TestAlpha TestCharlie TestGolf TestNovember TestZulu ExampleSmoke FuzzInput
  printf 'TestLocalPushFixture%03d\n' {1..151}
  # A prefix-related name in another batch must not run twice.
  printf '%s\n' TestLocalPushFixture049Suffix
} > "$RACE_TEST_NAMES"
cat > "$tmp/bin/go" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *' -list '* ]]; then
  cat "$RACE_TEST_NAMES"
  exit "${RACE_TEST_LIST_STATUS:-0}"
fi
[[ "$*" == *' -race -timeout=30m -count=1 -json -run '* ]]
while [[ "$1" != '-run' ]]; do shift; done
selector="$2"
selected=()
while IFS= read -r name; do
  if [[ "$name" =~ $selector ]]; then selected+=("$name"); fi
done < "$RACE_TEST_NAMES"
if (( ${#selected[@]} > 50 )); then
  echo "oversized API process: ${#selected[@]} tests exceed the fixture's work budget" >&2
  exit 88
fi
(( ${#selected[@]} > 0 ))
printf '%s\n' "$selector" >> "$RACE_TEST_LOG"
printf '%s\n' "${selected[@]}" >> "$RACE_TEST_EXECUTED"
for name in "${selected[@]}"; do
  if [[ "$name" == "${RACE_TEST_FAIL_NAME:-}" ]]; then exit 7; fi
done
exit "${RACE_TEST_STATUS:-0}"
SH
chmod +x "$tmp/bin/go"
export PATH="$tmp/bin:$PATH" RACE_TEST_LOG="$tmp/runs"
unset XD_TEST_DATABASE_URL XDRIVE_API_RACE_SHARD XDRIVE_API_RACE_SHARD_TOTAL
for index in 1 2 3 4 5; do
  XDRIVE_API_RACE_SHARD="$index" XDRIVE_API_RACE_SHARD_TOTAL=5 \
    bash "$ROOT/scripts/ci/test-go-api-race.sh" > "$tmp/output" 2>&1 || {
      cat "$tmp/output" >&2; exit 1;
    }
done
sort "$RACE_TEST_NAMES" > "$tmp/expected"
sort "$RACE_TEST_EXECUTED" > "$tmp/actual"
cmp "$tmp/expected" "$tmp/actual"
cp "$RACE_TEST_LOG" "$tmp/parallel"
: > "$RACE_TEST_LOG"
: > "$RACE_TEST_EXECUTED"
bash "$ROOT/scripts/ci/test-go-api-race.sh" > "$tmp/output" 2>&1
cmp "$tmp/parallel" "$RACE_TEST_LOG"
sort "$RACE_TEST_EXECUTED" > "$tmp/actual"
cmp "$tmp/expected" "$tmp/actual"
for invalid in 0 6 x; do
  if XDRIVE_API_RACE_SHARD="$invalid" XDRIVE_API_RACE_SHARD_TOTAL=5 \
    bash "$ROOT/scripts/ci/test-go-api-race.sh" > "$tmp/output" 2>&1; then
    echo 'invalid shard incorrectly accepted' >&2; exit 1
  fi
done
if XDRIVE_API_RACE_SHARD=1 XDRIVE_API_RACE_SHARD_TOTAL=4 \
  bash "$ROOT/scripts/ci/test-go-api-race.sh" > "$tmp/output" 2>&1; then
  echo 'incomplete CI matrix incorrectly accepted' >&2; exit 1
fi
set +e
RACE_TEST_STATUS=7 XDRIVE_API_RACE_SHARD=2 XDRIVE_API_RACE_SHARD_TOTAL=5 \
  bash "$ROOT/scripts/ci/test-go-api-race.sh" > "$tmp/output" 2>&1
status=$?
set -e
[[ "$status" -eq 7 ]]
: > "$RACE_TEST_LOG"
: > "$RACE_TEST_EXECUTED"
set +e
RACE_TEST_FAIL_NAME=TestLocalPushFixture075 XDRIVE_API_RACE_SHARD=3 XDRIVE_API_RACE_SHARD_TOTAL=5 \
  bash "$ROOT/scripts/ci/test-go-api-race.sh" > "$tmp/output" 2>&1
status=$?
set -e
[[ "$status" -eq 7 ]]
[[ "$(wc -l < "$RACE_TEST_LOG")" -eq 2 ]]
if grep -Fx 'TestLocalPushFixture151' "$RACE_TEST_EXECUTED" >/dev/null; then
  echo 'API batch failure did not stop later work' >&2; exit 1
fi
: > "$RACE_TEST_LOG"
set +e
RACE_TEST_LIST_STATUS=9 bash "$ROOT/scripts/ci/test-go-api-race.sh" > "$tmp/output" 2>&1
status=$?
set -e
[[ "$status" -eq 9 && ! -s "$RACE_TEST_LOG" ]]
: > "$RACE_TEST_NAMES"
if bash "$ROOT/scripts/ci/test-go-api-race.sh" > "$tmp/output" 2>&1; then
  echo 'empty test discovery incorrectly passed' >&2; exit 1
fi
[[ ! -s "$RACE_TEST_LOG" ]]
echo 'Five API shards retain exactly-once coverage in bounded processes; invalid matrix and early/late failures propagate.'
