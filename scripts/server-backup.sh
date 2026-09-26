#!/usr/bin/env bash
set -euo pipefail
umask 077

CONFIG_DIR="${XD_CONFIG_DIR:-$HOME/.xd}"
OUTPUT_ROOT=""
ALLOW_INCONSISTENT=0
LEAVE_SERVER_STOPPED=0

usage() {
  cat <<'EOF'
Usage: server-backup.sh [--config-dir DIR] [--output-dir DIR] [--allow-inconsistent] [--leave-server-stopped]

Creates an xDrive backup directory containing:
  database.dump   PostgreSQL custom-format dump
  blobs.tar       uncompressed file-data snapshot
  verify.json     pre-backup consistency report
  manifest.json   backup metadata
  SHA256SUMS.txt  SHA-256 checksums

The API and pull-worker services are stopped for the consistency check and
snapshot so metadata and blobs represent one maintenance-window backup point.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config-dir) CONFIG_DIR="$2"; shift 2 ;;
    --output-dir) OUTPUT_ROOT="$2"; shift 2 ;;
    --allow-inconsistent) ALLOW_INCONSISTENT=1; shift ;;
    --leave-server-stopped) LEAVE_SERVER_STOPPED=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

COMPOSE_PATH="$CONFIG_DIR/docker-compose.yml"
ENV_PATH="$CONFIG_DIR/.env"
[[ -f "$COMPOSE_PATH" ]] || { echo "missing $COMPOSE_PATH" >&2; exit 1; }
[[ -f "$ENV_PATH" ]] || { echo "missing $ENV_PATH" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum is required" >&2; exit 1; }

if [[ -z "$OUTPUT_ROOT" ]]; then
  OUTPUT_ROOT="$CONFIG_DIR/backups"
fi
mkdir -p "$OUTPUT_ROOT"
OUTPUT_ROOT="$(cd "$OUTPUT_ROOT" && pwd)"

compose() {
  docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@" </dev/null
}

wait_postgres() {
  local i
  for i in $(seq 1 60); do
    if compose exec -T postgres pg_isready -h 127.0.0.1 -U xdrive -d xdrive >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "PostgreSQL did not become ready" >&2
  return 1
}

wait_server() {
  local i
  for i in $(seq 1 60); do
    if compose exec -T server xdrive-server healthcheck >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "xDrive API did not become ready after backup" >&2
  return 1
}

server_was_running=0
worker_was_running=0
if compose ps --status running --services | grep -qx server; then
  server_was_running=1
fi
if compose ps --status running --services | grep -qx worker; then
  worker_was_running=1
fi

restart_services() {
  if [[ "$LEAVE_SERVER_STOPPED" == "1" ]]; then
    return
  fi
  if [[ "$server_was_running" == "1" ]]; then
    compose start server >/dev/null 2>&1 || return
    wait_server || return
  fi
  if [[ "$worker_was_running" == "1" && "$server_was_running" == "1" ]]; then
    compose start worker >/dev/null 2>&1 || true
  fi
}
trap restart_services EXIT INT TERM

compose up -d postgres >/dev/null
wait_postgres

server_id="$(compose ps -aq server | head -n1 || true)"
mount_type=""
data_source=""
if [[ -n "$server_id" ]]; then
  mount_type="$(docker inspect "$server_id" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Type}}{{end}}{{end}}' </dev/null)"
  if [[ "$mount_type" == "volume" ]]; then
    data_source="$(docker inspect "$server_id" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' </dev/null)"
  else
    data_source="$(docker inspect "$server_id" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' </dev/null)"
  fi
fi
if [[ -z "$data_source" ]]; then
  data_source="$(docker volume ls -q \
    --filter 'label=com.docker.compose.project=xdrive' \
    --filter 'label=com.docker.compose.volume=file-data' </dev/null | head -n1 || true)"
  [[ -n "$data_source" ]] && mount_type="volume"
fi
[[ -n "$data_source" ]] || {
  echo "cannot resolve xDrive /data mount without creating/recreating the server service" >&2
  exit 1
}
postgres_id="$(compose ps -q postgres | head -n1)"
postgres_image="$(docker inspect "$postgres_id" --format '{{.Config.Image}}' </dev/null)"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
final_dir="$OUTPUT_ROOT/xdrive-backup-$stamp"
partial_dir="$final_dir.partial"
[[ ! -e "$final_dir" && ! -e "$partial_dir" ]] || { echo "backup path already exists: $final_dir" >&2; exit 1; }
mkdir -p "$partial_dir"

if [[ "$worker_was_running" == "1" ]]; then
  compose stop worker >/dev/null 2>&1 || true
fi
compose stop server >/dev/null 2>&1 || true

verify_status=0
compose run -T --rm --no-deps server storage verify --json </dev/null > "$partial_dir/verify.json" || verify_status=$?
if [[ "$verify_status" != "0" && "$ALLOW_INCONSISTENT" != "1" ]]; then
  echo "xDrive consistency verification failed; backup aborted." >&2
  cat "$partial_dir/verify.json" >&2 || true
  rm -rf "$partial_dir"
  exit "$verify_status"
fi

compose exec -T postgres pg_dump -U xdrive -d xdrive -Fc > "$partial_dir/database.dump"

docker run --rm --entrypoint sh \
  -v "$data_source:/data:ro" \
  -v "$partial_dir:/backup" \
  "$postgres_image" \
  -c 'cd /data && tar -cf /backup/blobs.tar .' </dev/null

created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
server_image="$(compose config --images | grep 'xdrive-server' | head -n1 || true)"
web_image="$(compose config --images | grep 'xdrive-web' | head -n1 || true)"
cat > "$partial_dir/manifest.json" <<EOF
{
  "format_version": 1,
  "created_at_utc": "$created_at",
  "database": {"file": "database.dump", "format": "pg_dump_custom"},
  "blobs": {"file": "blobs.tar", "format": "tar"},
  "consistency_verified": $([[ "$verify_status" == "0" ]] && echo true || echo false),
  "server_image": "$server_image",
  "web_image": "$web_image"
}
EOF

(
  cd "$partial_dir"
  sha256sum database.dump blobs.tar verify.json manifest.json > SHA256SUMS.txt
)

mv "$partial_dir" "$final_dir"
printf '%s\n' "$final_dir"
