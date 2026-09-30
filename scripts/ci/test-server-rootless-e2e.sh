#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER_ARTIFACT="${1:-$ROOT/dist/server-image}"
CADDY_ARTIFACT="${2:-$ROOT/dist/caddy-image}"
TAG="${XDRIVE_ROOTLESS_E2E_TAG:-rootless-e2e}"
REGISTRY_PORT="${XDRIVE_ROOTLESS_REGISTRY_PORT:-35000}"
WEB_PORT="${XDRIVE_ROOTLESS_WEB_PORT:-33080}"
TMP_ROOT="$(mktemp -d "$HOME/.xdrive-rootless-e2e.XXXXXX")"
SYSTEMD_RUNTIME_DIR="${XDG_RUNTIME_DIR:-}"
RUNTIME_OWNED=1
if [[ -n "$SYSTEMD_RUNTIME_DIR" && -S "$SYSTEMD_RUNTIME_DIR/bus" ]]; then
  RUNTIME_DIR="$SYSTEMD_RUNTIME_DIR"
  RUNTIME_OWNED=0
else
  RUNTIME_DIR="$TMP_ROOT/runtime"
fi
DOCKER_DATA_ROOT="$TMP_ROOT/docker-data"
DAEMON_EXEC_ROOT="$TMP_ROOT/docker-exec"
DAEMON_PIDFILE="$TMP_ROOT/dockerd.pid"
XDRIVE_HOME="$TMP_ROOT/xdrive-home"
FAKE_BIN="$TMP_ROOT/bin"
DOCKER_LOG="$TMP_ROOT/dockerd-rootless.log"
INSTALL_LOG="$TMP_ROOT/install.log"
DAEMON_PID=""

export XDG_RUNTIME_DIR="$RUNTIME_DIR"
export DOCKER_HOST="unix://$RUNTIME_DIR/docker.sock"
export DOCKER_CONFIG="$TMP_ROOT/docker-config"
export DOCKERD_ROOTLESS_ROOTLESSKIT_FLAGS="${DOCKERD_ROOTLESS_ROOTLESSKIT_FLAGS:---net=slirp4netns}"

cleanup() {
  local status=$?
  set +e
  if docker info >/dev/null 2>&1; then
    if [[ -x "$XDRIVE_HOME/bin/xdrive-server" ]]; then
      XD_CONFIG_DIR="$XDRIVE_HOME" XD_HOST_BIN_DIR="$TMP_ROOT/no-host-bin"         "$XDRIVE_HOME/bin/xdrive-server" uninstall --purge-data --purge-backups --yes >/dev/null 2>&1 || true
    fi
    docker rm -f xdrive-rootless-e2e-registry >/dev/null 2>&1 || true
  fi
  if [[ -n "$DAEMON_PID" ]]; then
    kill "$DAEMON_PID" >/dev/null 2>&1 || true
    wait "$DAEMON_PID" >/dev/null 2>&1 || true
  fi
  if command -v rootlesskit >/dev/null 2>&1; then
    rootlesskit rm -rf "$DOCKER_DATA_ROOT" >/dev/null 2>&1 || true
    rootlesskit rm -rf "$RUNTIME_DIR/dockerd-rootless" >/dev/null 2>&1 || true
  fi
  rm -f "$RUNTIME_DIR/docker.sock" >/dev/null 2>&1 || true
  if [[ "$RUNTIME_OWNED" == "1" ]]; then
    rm -rf "$RUNTIME_DIR" >/dev/null 2>&1 || true
  fi
  rm -rf "$DOCKER_CONFIG" "$FAKE_BIN" "$XDRIVE_HOME" "$TMP_ROOT" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT INT TERM

for cmd in docker dockerd-rootless.sh rootlesskit newuidmap newgidmap slirp4netns; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "rootless E2E prerequisite missing: $cmd" >&2
    exit 1
  }
done
[[ -d "$SERVER_ARTIFACT" ]] || { echo "missing server image artifact: $SERVER_ARTIFACT" >&2; exit 1; }
[[ -d "$CADDY_ARTIFACT" ]] || { echo "missing Caddy/Web image artifact: $CADDY_ARTIFACT" >&2; exit 1; }

user_name="$(id -un)"
subuid_count="$(awk -F: -v u="$user_name" '$1==u {sum += $3} END {print sum+0}' /etc/subuid 2>/dev/null || echo 0)"
subgid_count="$(awk -F: -v u="$user_name" '$1==u {sum += $3} END {print sum+0}' /etc/subgid 2>/dev/null || echo 0)"
if (( subuid_count < 65536 || subgid_count < 65536 )); then
  echo "rootless E2E requires at least 65536 subordinate UIDs/GIDs for $user_name" >&2
  echo "subuid=$subuid_count subgid=$subgid_count" >&2
  exit 1
fi

mkdir -p "$RUNTIME_DIR" "$DOCKER_DATA_ROOT" "$DAEMON_EXEC_ROOT" "$DOCKER_CONFIG" "$FAKE_BIN"
chmod 700 "$RUNTIME_DIR" "$DOCKER_DATA_ROOT" "$DAEMON_EXEC_ROOT" "$DOCKER_CONFIG" "$FAKE_BIN"
if [[ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
  echo "[rootless-e2e] using systemd user bus: $DBUS_SESSION_BUS_ADDRESS"
fi

echo "[rootless-e2e] starting real Rootless Docker daemon"
dockerd-rootless.sh \
  --data-root "$DOCKER_DATA_ROOT" \
  --exec-root "$DAEMON_EXEC_ROOT" \
  --pidfile "$DAEMON_PIDFILE" \
  --storage-driver fuse-overlayfs \
  --insecure-registry "127.0.0.1:$REGISTRY_PORT" \
  >"$DOCKER_LOG" 2>&1 &
DAEMON_PID=$!

ready=0
for _ in $(seq 1 60); do
  if docker info >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$DAEMON_PID" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if [[ "$ready" != "1" ]]; then
  echo "Rootless Docker daemon did not become ready." >&2
  cat "$DOCKER_LOG" >&2 || true
  exit 1
fi

security_options="$(docker info --format '{{json .SecurityOptions}}')"
if ! printf '%s' "$security_options" | grep -qi rootless; then
  echo "E2E connected to a Docker daemon that is not rootless: $security_options" >&2
  exit 1
fi
echo "[rootless-e2e] Docker security options: $security_options"
cgroup_driver="$(docker info --format '{{.CgroupDriver}}')"
if [[ "$cgroup_driver" != "systemd" ]]; then
  echo "Rootless Docker E2E requires systemd cgroup delegation; got CgroupDriver=$cgroup_driver" >&2
  exit 1
fi
echo "[rootless-e2e] Docker cgroup driver: $cgroup_driver"

bash "$ROOT/scripts/ci/import-docker-image.sh" "$SERVER_ARTIFACT" xdrive/server:test
bash "$ROOT/scripts/ci/import-docker-image.sh" "$CADDY_ARTIFACT" xdrive/caddy:test

docker run -d --name xdrive-rootless-e2e-registry \
  --network host \
  -e "REGISTRY_HTTP_ADDR=127.0.0.1:$REGISTRY_PORT" \
  registry:2 >/dev/null

registry="127.0.0.1:$REGISTRY_PORT"
docker tag xdrive/server:test "$registry/xdrive-server:$TAG"
docker tag xdrive/caddy:test "$registry/xdrive-caddy:$TAG"

registry_ready=0
for _ in $(seq 1 30); do
  if docker push "$registry/xdrive-server:$TAG" >/dev/null 2>&1; then
    registry_ready=1
    break
  fi
  sleep 1
done
[[ "$registry_ready" == "1" ]] || {
  echo "local registry did not become reachable from the Rootless Docker daemon" >&2
  docker logs xdrive-rootless-e2e-registry >&2 || true
  exit 1
}
docker push "$registry/xdrive-caddy:$TAG" >/dev/null

REAL_CURL="$(command -v curl)"
cat > "$FAKE_BIN/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
original=("$@")
url=""
out=""
write_out=""
previous=""
for arg in "$@"; do
  case "$previous" in
    -o|--output) out="$arg" ;;
    -w|--write-out) write_out="$arg" ;;
  esac
  case "$arg" in
    https://raw.githubusercontent.com/lazyxu/xdrive/rootless-e2e/*) url="$arg" ;;
  esac
  previous="$arg"
done

if [[ -z "$url" ]]; then
  exec "$TEST_REAL_CURL" "${original[@]}"
fi
[[ -n "$out" ]] || {
  echo "local raw-asset curl shim requires -o" >&2
  exit 9
}
relative="${url#https://raw.githubusercontent.com/lazyxu/xdrive/rootless-e2e/}"
source="$TEST_ROOT/$relative"
[[ -f "$source" ]] || {
  echo "missing local raw asset: $relative" >&2
  exit 9
}
cp "$source" "$out"
if [[ -n "$write_out" ]]; then
  size="$(wc -c < "$source" | tr -d ' ')"
  printf '%s\t%s\t%s' "$size" "$size" "1.0"
fi
SH
chmod +x "$FAKE_BIN/curl"

echo "[rootless-e2e] installing xDrive against the real rootless daemon"
if ! TEST_ROOT="$ROOT" TEST_REAL_CURL="$REAL_CURL" PATH="$FAKE_BIN:$PATH" XD_CONFIG_DIR="$XDRIVE_HOME" XD_HOST_BIN_DIR="$TMP_ROOT/no-host-bin" XD_SOURCE_REF=rootless-e2e XD_IMAGE_TAG="$TAG" XD_BUILT_CHANNEL=master XD_BUILT_COMMIT= XD_BUILT_SOURCE=github XD_IMAGE_REGISTRY="$registry" XD_NONINTERACTIVE=1 XD_KEEP_LOOPBACK_HTTP=1 XD_WEB_BIND=127.0.0.1 XD_WEB_PORT="$WEB_PORT" XD_PULL_ATTEMPTS=1 XD_PULL_RETRY_DELAY_SECONDS=1 bash "$ROOT/deploy/install-server.sh" --source github --channel master >"$INSTALL_LOG" 2>&1; then
  echo "rootless xDrive installer failed; full installer output follows:" >&2
  cat "$INSTALL_LOG" >&2 || true
  echo "---- rootless Docker info ----" >&2
  docker info >&2 || true
  echo "---- rootless containers ----" >&2
  docker ps -a >&2 || true
  if [[ -f "$XDRIVE_HOME/config/.env" && -f "$XDRIVE_HOME/config/docker-compose.yml" ]]; then
    echo "---- xDrive Compose state ----" >&2
    docker compose --env-file "$XDRIVE_HOME/config/.env" -f "$XDRIVE_HOME/config/docker-compose.yml" ps -a >&2 || true
    docker compose --env-file "$XDRIVE_HOME/config/.env" -f "$XDRIVE_HOME/config/docker-compose.yml" logs --tail=120 >&2 || true
  fi
  exit 1
fi

cat "$INSTALL_LOG"
grep -q 'Docker mode: rootless' "$INSTALL_LOG"
grep -q '^xDrive installation environment$' "$INSTALL_LOG"
grep -Eq 'Docker mode[[:space:]]+rootless$' "$INSTALL_LOG"
grep -Fq "$XDRIVE_HOME/data/files" "$INSTALL_LOG"
grep -Fq "$XDRIVE_HOME/data/postgres" "$INSTALL_LOG"

status_log="$TMP_ROOT/status.log"
XD_CONFIG_DIR="$XDRIVE_HOME" XD_HOST_BIN_DIR="$TMP_ROOT/no-host-bin"   "$XDRIVE_HOME/bin/xdrive-server" status >"$status_log"
cat "$status_log"
grep -Eq 'Docker mode[[:space:]]+rootless$' "$status_log"
grep -Fq "$XDRIVE_HOME/data/files" "$status_log"
grep -Fq "$XDRIVE_HOME/data/postgres" "$status_log"
grep -Fq "$XDRIVE_HOME/data/caddy/data" "$status_log"
grep -Fq "$XDRIVE_HOME/data/caddy/config" "$status_log"
grep -Fq "$XDRIVE_HOME/backups" "$status_log"
grep -Eq 'Volumes[[:space:]]+none$' "$status_log"
grep -q '^Services$' "$status_log"

env_path="$XDRIVE_HOME/config/.env"
compose_path="$XDRIVE_HOME/config/docker-compose.yml"
caddy_id="$(docker compose --env-file "$env_path" -f "$compose_path" ps -q caddy)"
caddy_healthy=0
for _ in $(seq 1 45); do
  caddy_health="$(docker inspect "$caddy_id" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null || true)"
  if [[ "$caddy_health" == "healthy" ]]; then
    caddy_healthy=1
    break
  fi
  sleep 1
done
if [[ "$caddy_healthy" != "1" ]]; then
  echo "rootless Caddy/Web container health did not converge to healthy" >&2
  docker inspect "$caddy_id" --format '{{json .State}}' >&2 || true
  docker logs "$caddy_id" >&2 || true
  exit 1
fi

for container in xdrive-postgres xdrive-server xdrive-worker xdrive-caddy; do
  docker inspect "$container" >/dev/null
done
if docker ps -a --format '{{.Names}}' | grep -qx 'xdrive-web-1'; then
  echo "legacy xdrive-web-1 container survived Web -> Caddy migration" >&2
  exit 1
fi

doctor_log="$TMP_ROOT/doctor.log"
if ! XD_CONFIG_DIR="$XDRIVE_HOME" XD_HOST_BIN_DIR="$TMP_ROOT/no-host-bin" "$XDRIVE_HOME/bin/xdrive-server" doctor >"$doctor_log" 2>&1; then
  echo "rootless xDrive doctor command failed:" >&2
  cat "$doctor_log" >&2 || true
  exit 1
fi
cat "$doctor_log"
grep -q '^---- installation environment ----$' "$doctor_log"
grep -Eq 'Docker mode[[:space:]]+rootless$' "$doctor_log"
grep -q 'doctor result: usable' "$doctor_log"

if ! /usr/bin/curl -fsS "http://127.0.0.1:$WEB_PORT/api/v1/readyz" >/dev/null; then
  echo "rootless xDrive Caddy/Web/API readiness endpoint is unreachable" >&2
  exit 1
fi

server_id="$(docker compose --env-file "$env_path" -f "$compose_path" ps -q server)"
postgres_id="$(docker compose --env-file "$env_path" -f "$compose_path" ps -q postgres)"
server_source="$(docker inspect "$server_id" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}')"
postgres_source="$(docker inspect "$postgres_id" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Source}}{{end}}{{end}}')"
[[ "$server_source" == "$XDRIVE_HOME/data/files" ]]
[[ "$postgres_source" == "$XDRIVE_HOME/data/postgres" ]]

server_user="$(docker inspect "$server_id" --format '{{.Config.User}}')"
[[ "$server_user" == "65532:65532" ]]

echo "[rootless-e2e] creating an external-source record before upgrade"
printf '%s\n' 'RootlessE2E-Password-123!' | \
  docker compose --env-file "$env_path" -f "$compose_path" \
    exec -T server xdrive-server admin create --username upgrade-e2e --password-stdin >/dev/null
owner_id="$(docker compose --env-file "$env_path" -f "$compose_path" \
  exec -T postgres psql -U xdrive -d xdrive -Atqc \
  "SELECT id FROM xd_users WHERE username = 'upgrade-e2e'")"
[[ "$owner_id" =~ ^[0-9]+$ ]]

docker compose --env-file "$env_path" -f "$compose_path" \
  exec -T postgres psql -U xdrive -d xdrive -v ON_ERROR_STOP=1 -c \
  "INSERT INTO xd_sources (
     owner_id, name, kind, direction, sync_mode, run_mode, status,
     schedule_type, schedule_expression, schedule_timezone, revision,
     ignore_rules, checkpoint, last_error, created_at, updated_at
   ) VALUES (
     $owner_id, 'rootless-upgrade-source', 'synology_photos', 'pull',
     'backup', 'sync', 'active', 'manual', '', 'UTC', 1, '', '', '',
     NOW(), NOW()
   );" >/dev/null

source_count_before="$(docker compose --env-file "$env_path" -f "$compose_path" \
  exec -T postgres psql -U xdrive -d xdrive -Atqc \
  "SELECT count(*) FROM xd_sources WHERE owner_id = $owner_id AND name = 'rootless-upgrade-source'")"
[[ "$source_count_before" == "1" ]]

UPGRADE_LOG="$TMP_ROOT/upgrade.log"
echo "[rootless-e2e] upgrading the bind-mounted deployment"
if ! TEST_ROOT="$ROOT" TEST_REAL_CURL="$REAL_CURL" PATH="$FAKE_BIN:$PATH" \
  XD_CONFIG_DIR="$XDRIVE_HOME" XD_HOST_BIN_DIR="$TMP_ROOT/no-host-bin" \
  XD_SOURCE_REF=rootless-e2e XD_IMAGE_TAG="$TAG" XD_BUILT_CHANNEL=master \
  XD_BUILT_COMMIT= XD_BUILT_SOURCE=github XD_IMAGE_REGISTRY="$registry" \
  XD_NONINTERACTIVE=1 XD_KEEP_LOOPBACK_HTTP=1 XD_WEB_BIND=127.0.0.1 \
  XD_WEB_PORT="$WEB_PORT" XD_PULL_ATTEMPTS=1 XD_PULL_RETRY_DELAY_SECONDS=1 \
  bash "$ROOT/deploy/install-server.sh" --source github --channel master \
  >"$UPGRADE_LOG" 2>&1; then
  echo "rootless xDrive upgrade failed; full upgrade output follows:" >&2
  cat "$UPGRADE_LOG" >&2 || true
  docker compose --env-file "$env_path" -f "$compose_path" ps -a >&2 || true
  docker compose --env-file "$env_path" -f "$compose_path" logs --tail=120 >&2 || true
  exit 1
fi

cat "$UPGRADE_LOG"
grep -q 'existing deployment detected; entering upgrade maintenance window' "$UPGRADE_LOG"
find "$XDRIVE_HOME/backups/pre-upgrade" -mindepth 1 -maxdepth 1 -type d -name 'xdrive-backup-*' -print -quit | grep -q .

source_count_after="$(docker compose --env-file "$env_path" -f "$compose_path" \
  exec -T postgres psql -U xdrive -d xdrive -Atqc \
  "SELECT count(*) FROM xd_sources WHERE owner_id = $owner_id AND name = 'rootless-upgrade-source'")"
if [[ "$source_count_after" != "1" ]]; then
  echo "external source disappeared across server upgrade: before=$source_count_before after=$source_count_after" >&2
  exit 1
fi

if ! /usr/bin/curl -fsS "http://127.0.0.1:$WEB_PORT/api/v1/readyz" >/dev/null; then
  echo "rootless xDrive readiness endpoint is unreachable after upgrade" >&2
  exit 1
fi

echo "[rootless-e2e] host ownership files=$(stat -c '%u:%g' "$XDRIVE_HOME/data/files") postgres=$(stat -c '%u:%g' "$XDRIVE_HOME/data/postgres")"
echo "real Rootless Docker server install/upgrade/source-preservation E2E passed"
