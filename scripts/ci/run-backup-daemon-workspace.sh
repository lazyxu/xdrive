#!/usr/bin/env bash
set -euo pipefail

# GitLab's checkout and /tmp belong to the job container, while bind sources
# belong to its sibling Docker daemon. Mount a private volume at its actual
# daemon path so the drill and every backup/restore helper see the SAME bytes.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
command -v docker >/dev/null
docker info >/dev/null
docker compose version >/dev/null
socket="${DOCKER_HOST:-unix:///var/run/docker.sock}"
[[ "$socket" == unix:///* ]] || {
  echo 'backup drill requires the local Unix Docker socket' >&2; exit 1;
}
socket="${socket#unix://}"
[[ -S "$socket" ]] || { echo 'Docker socket is unavailable' >&2; exit 1; }
compose_binary="$(docker info --format '{{range .ClientInfo.Plugins}}{{if eq .Name "compose"}}{{.Path}}{{end}}{{end}}')"
[[ -f "$compose_binary" && -x "$compose_binary" ]] || {
  echo 'Installed Compose plugin path is unavailable' >&2; exit 1;
}

token="xdrive-backup-${CI_JOB_ID:-local}-$(date +%s)-$$-$RANDOM"
[[ "$token" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 1
volume="$token-data"
runner="$token-runner"
project="$token"
label=org.xdrive.ci.backup-workspace
resources_owned=false
exec_pid=""
cleanup() {
  local status=$? ids network failed=0
  trap - EXIT INT TERM
  if [[ "$resources_owned" == true ]]; then
    # Inspect labels instead of relying on assignments after docker create:
    # TERM can arrive after the daemon creates a resource but before it returns.
    ids="$(docker ps -aq --filter "name=^/$runner$" --filter "label=$label=$token")" || failed=1
    if [[ -n "$ids" ]]; then docker rm -f $ids >/dev/null || failed=1; fi
  fi
  if [[ -n "$exec_pid" ]]; then wait "$exec_pid" 2>/dev/null || true; fi
  # An interrupted docker exec can strand drill services. These are exclusively
  # this invocation's fixture project, never the production xdrive project.
  if [[ "$resources_owned" == true ]]; then
    ids="$(docker ps -aq --filter "label=$label=$token")" || failed=1
    if [[ -n "$ids" ]]; then docker rm -f $ids >/dev/null || failed=1; fi
    ids="$(docker ps -aq --filter "label=com.docker.compose.project=$project")" || failed=1
    if [[ -n "$ids" ]]; then docker rm -f $ids >/dev/null || failed=1; fi
    ids="$(docker network ls -q --filter "label=com.docker.compose.project=$project")" || failed=1
    for network in $ids; do docker network rm "$network" >/dev/null || failed=1; done
  fi
  if [[ "$resources_owned" == true ]] && docker volume inspect "$volume" >/dev/null 2>&1; then
    if [[ "$(docker volume inspect --format "{{index .Labels \"$label\"}}" "$volume")" == "$token" ]]; then
      docker volume rm "$volume" >/dev/null || failed=1
    else
      echo 'backup drill volume ownership changed; refusing cleanup' >&2
      failed=1
    fi
  fi
  if (( failed )); then
    echo "backup drill cleanup failed for task $token" >&2
    (( status != 0 )) || status=1
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Refuse collisions before acquiring ownership of any name.
if docker volume inspect "$volume" >/dev/null 2>&1 || docker container inspect "$runner" >/dev/null 2>&1; then
  echo 'backup drill resource name already exists' >&2; exit 1
fi
resources_owned=true
docker volume create --label "$label=$token" "$volume" >/dev/null
[[ "$(docker volume inspect --format "{{index .Labels \"$label\"}}" "$volume")" == "$token" ]] || {
  echo 'backup drill volume ownership mismatch' >&2; exit 1;
}
printf '[backup-drill] task=%s\n' "$token"
workspace="$(docker volume inspect --format '{{.Mountpoint}}' "$volume")"
[[ "$workspace" == /* && "$workspace" != / && "$workspace" != *[,[:space:]]* ]] || {
  echo 'Unsafe Docker volume mountpoint' >&2; exit 1;
}
docker create --name "$runner" --label "$label=$token" \
  --mount "type=volume,src=$volume,dst=$workspace" \
  --mount "type=bind,src=$socket,dst=/var/run/docker.sock" \
  --env DOCKER_HOST=unix:///var/run/docker.sock \
  --env "TEMP=$workspace/tmp" --env "TMP=$workspace/tmp" --env "TMPDIR=$workspace/tmp" \
  --env "DOCKER_CONFIG=$workspace/docker-config" \
  --env "PATH=$workspace/bin:/usr/local/go/bin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  --env "XD_BACKUP_WORKSPACE_TOKEN=$token" \
  --env "COMPOSE_PROJECT_NAME=$project" --env XD_BACKUP_TEST_ISOLATE=1 \
  --env "XD_BACKUP_TEST_IMAGE=${XD_BACKUP_TEST_IMAGE:-xdrive/server:test}" \
  --workdir "$workspace" \
  "${XDRIVE_CI_GO_IMAGE:-golang:1.25-bookworm}" \
  bash -ec 'mkdir -p "$TMPDIR" "$DOCKER_CONFIG/cli-plugins"; exec sleep infinity' >/dev/null
docker start "$runner" >/dev/null
docker exec "$runner" mkdir -p "$workspace/docker-config/cli-plugins" "$workspace/tmp" "$workspace/bin"
docker cp "$ROOT/scripts" "$runner:$workspace/scripts"
docker cp "$ROOT/deploy" "$runner:$workspace/deploy"
docker cp "$(command -v docker)" "$runner:/usr/local/bin/docker"
docker cp "$compose_binary" "$runner:$workspace/docker-config/cli-plugins/docker-compose"
docker exec "$runner" bash -ec '
  install -m 0755 scripts/ci/backup-fixture-docker.sh "$PWD/bin/docker"
  python3 -c '\''import os,tempfile; assert tempfile.gettempdir() == os.environ["TMPDIR"]'\''
  docker compose version
'
if (( $# == 0 )); then set -- bash scripts/test-server-backup-restore.sh; fi
docker exec "$runner" "$@" &
exec_pid=$!
wait "$exec_pid"
