#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"
cat > "$tmp/bin/go" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *' -list '* ]]; then
  printf '%s\n' TestAlpha TestCharlie TestGolf TestNovember TestZulu ExampleSmoke FuzzInput
else
  [[ "$*" == *' -race -timeout=30m -count=1 -json -run '* ]]
  printf '%s\n' "$*" >> "$RACE_TEST_LOG"
  exit "${RACE_TEST_STATUS:-0}"
fi
SH
chmod +x "$tmp/bin/go"
export PATH="$tmp/bin:$PATH" RACE_TEST_LOG="$tmp/runs"
unset XD_TEST_DATABASE_URL XDRIVE_API_RACE_SHARD XDRIVE_API_RACE_SHARD_TOTAL
for index in 1 2 3 4 5; do
  XDRIVE_API_RACE_SHARD="$index" XDRIVE_API_RACE_SHARD_TOTAL=5 \
    bash "$ROOT/scripts/ci/test-go-api-race.sh" > "$tmp/output" 2>&1
done
[[ "$(wc -l < "$RACE_TEST_LOG")" -eq 5 ]]
[[ "$(sort -u "$RACE_TEST_LOG" | wc -l)" -eq 5 ]]
cp "$RACE_TEST_LOG" "$tmp/parallel"
: > "$RACE_TEST_LOG"
bash "$ROOT/scripts/ci/test-go-api-race.sh" > "$tmp/output" 2>&1
cmp "$tmp/parallel" "$RACE_TEST_LOG"
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
echo 'Five isolated API shards equal default coverage; invalid matrix and real failure propagate.'
