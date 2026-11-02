#!/usr/bin/env bash
set -euo pipefail

# Run from a Linux job container using a sibling Docker daemon, just like GitLab.
# The original job-local mktemp fixture fails the strict bind below.
if [[ "${1:-}" == --probe ]]; then
  fixture="$(mktemp -d)"
  [[ "$fixture" == "$TMPDIR/"* ]]
  [[ "$TEMP" == "$TMPDIR" && "$TMP" == "$TMPDIR" ]]
  python3 -c 'import os,tempfile; assert tempfile.gettempdir() == os.environ["TMPDIR"]'
  mkdir -p "$fixture/incremental"
  printf 'durable-original-receipt' > "$fixture/incremental/receipt"
  actual="$(docker run --rm --mount "type=bind,src=$fixture/incremental,dst=/probe,readonly" \
    alpine:3.22 cat /probe/receipt)"
  [[ "$actual" == durable-original-receipt ]]
  # Writes by sibling helpers must also be visible to the test runner.
  docker run --rm --mount "type=bind,src=$fixture/incremental,dst=/probe" \
    alpine:3.22 sh -c 'printf sibling-write > /probe/result'
  [[ "$(cat "$fixture/incremental/result")" == sibling-write ]]
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
# Keep a task-owned sentinel outside the runner project to prove cleanup does
# not touch other users' containers, even after a failing drill.
sentinel="$(docker create --label "com.docker.compose.project=xdrive-backup-sentinel-$$" alpine:3.22 true)"
trap 'docker rm -f "$sentinel" >/dev/null' EXIT
output="$(bash scripts/ci/run-backup-daemon-workspace.sh \
  bash scripts/ci/test-backup-daemon-workspace.sh --probe)"
printf '%s\n' "$output"
assert_cleaned() {
  local task
  task="$(sed -n 's/^\[backup-drill\] task=//p' <<<"$1")"
  [[ "$task" == xdrive-backup-* && "$task" != *$'\n'* ]]
  [[ -z "$(docker ps -aq --filter "label=org.xdrive.ci.backup-workspace=$task")" ]]
  [[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$task")" ]]
  [[ -z "$(docker volume ls -q --filter "label=org.xdrive.ci.backup-workspace=$task")" ]]
  [[ -z "$(docker network ls -q --filter "label=com.docker.compose.project=$task")" ]]
  docker container inspect "$sentinel" >/dev/null
}
assert_cleaned "$output"

# Exercise the real Docker cleanup after an error inside the runner, including
# an otherwise orphaned Compose-owned container.
if output="$(bash scripts/ci/run-backup-daemon-workspace.sh bash -ec '
  docker create alpine:3.22 true >/dev/null
  docker create --label "com.docker.compose.project=$COMPOSE_PROJECT_NAME" alpine:3.22 true >/dev/null
  docker network create --label "com.docker.compose.project=$COMPOSE_PROJECT_NAME" "$COMPOSE_PROJECT_NAME-probe" >/dev/null
  exit 37
')"; then
  echo 'runner swallowed the failing test exit status' >&2
  exit 1
else
  [[ "$?" == 37 ]]
fi
assert_cleaned "$output"

# TERM must interrupt docker exec and clean the runner and volume, rather than
# deferring the shell trap until a potentially hung drill eventually returns.
if output="$(timeout --signal=TERM --kill-after=15s 15s \
  bash scripts/ci/run-backup-daemon-workspace.sh docker run --rm alpine:3.22 sleep 300)"; then
  echo 'runner ignored its timeout' >&2; exit 1
else
  [[ "$?" == 124 ]]
fi
assert_cleaned "$output"
echo 'backup daemon workspace regression passed (bind bytes, write visibility, error/TERM cleanup)'
