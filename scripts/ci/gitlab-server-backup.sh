#!/usr/bin/env bash
set -euo pipefail

command -v docker >/dev/null
docker info >/dev/null

bash scripts/ci/import-docker-image.sh dist/server-image xdrive/server:test
# Install the same pinned Compose plugin used elsewhere if this job's
# docker-only before_script has not already made it available.
if ! docker compose version >/dev/null 2>&1; then
  bash scripts/ci/install-docker-cli.sh
fi
# Keep the fixture pinned to the imported immutable image even if another
# job retags the shared CI build reference while this drill is running.
image_id="$(tr -d '\r\n' < dist/server-image/image.id)"
test_image="xdrive-ci-backup:job-${CI_JOB_ID:-local}-$(date +%s)-$$-$RANDOM"
helper_pid=""
cleanup_image() {
  local status=$?
  trap - EXIT
  if [[ -n "$helper_pid" ]]; then
    kill -TERM "$helper_pid" 2>/dev/null || true
    wait "$helper_pid" 2>/dev/null || true
  fi
  if [[ "$(docker image inspect --format '{{.Id}}' "$test_image" 2>/dev/null || true)" == "$image_id" ]]; then
    docker image rm "$test_image" >/dev/null || { (( status != 0 )) || status=1; }
  fi
  exit "$status"
}
docker tag "$image_id" "$test_image"
trap cleanup_image EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
XD_BACKUP_TEST_IMAGE="$test_image" bash scripts/ci/run-backup-daemon-workspace.sh &
helper_pid=$!
wait "$helper_pid"
