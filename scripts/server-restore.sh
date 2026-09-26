#!/usr/bin/env bash
set -euo pipefail
umask 077

CONFIG_DIR="${XD_CONFIG_DIR:-$HOME/.xd}"
BACKUP_DIR=""
ASSUME_YES=0
SAFETY_BACKUP=1

usage() {
  cat <<'EOF'
Usage: server-restore.sh BACKUP_DIR [--config-dir DIR] [--yes] [--no-safety-backup]

Restore is destructive. By default xDrive first creates a pre-restore safety
backup of the current state, then stops the API and pull worker, verifies
SHA-256 checksums, recreates the PostgreSQL database, replaces file-data, runs
an offline consistency verification, and only then reopens the services.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config-dir) CONFIG_DIR="$2"; shift 2 ;;
    --yes) ASSUME_YES=1; shift ;;
    --no-safety-backup) SAFETY_BACKUP=0; shift ;;
    -h|--help) usage; exit 0 ;;
    -*)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [[ -n "$BACKUP_DIR" ]]; then
        echo "only one BACKUP_DIR may be supplied" >&2
        exit 2
      fi
      BACKUP_DIR="$1"
      shift
      ;;
  esac
done

[[ -n "$BACKUP_DIR" ]] || { usage >&2; exit 2; }
[[ -d "$BACKUP_DIR" ]] || { echo "backup directory not found: $BACKUP_DIR" >&2; exit 1; }
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"
COMPOSE_PATH="$CONFIG_DIR/docker-compose.yml"
ENV_PATH="$CONFIG_DIR/.env"
[[ -f "$COMPOSE_PATH" ]] || { echo "missing $COMPOSE_PATH" >&2; exit 1; }
[[ -f "$ENV_PATH" ]] || { echo "missing $ENV_PATH" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum is required" >&2; exit 1; }

for required in database.dump blobs.tar verify.json manifest.json SHA256SUMS.txt; do
  [[ -f "$BACKUP_DIR/$required" ]] || { echo "backup is missing $required" >&2; exit 1; }
done
grep -Eq '"format_version"[[:space:]]*:[[:space:]]*1' "$BACKUP_DIR/manifest.json" || {
  echo "unsupported backup format" >&2
  exit 1
}
(
  cd "$BACKUP_DIR"
  sha256sum -c SHA256SUMS.txt
)

if [[ "$ASSUME_YES" != "1" ]]; then
  if [[ ! -r /dev/tty || ! -w /dev/tty ]]; then
    echo "restore requires --yes in a non-interactive shell" >&2
    exit 2
  fi
  printf 'Restore xDrive from %s? This replaces the current database and all blobs. [y/N] ' "$BACKUP_DIR" >/dev/tty
  read -r answer </dev/tty
  [[ "$answer" =~ ^[Yy]$ ]] || { echo "restore cancelled"; exit 0; }
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "$SAFETY_BACKUP" == "1" ]]; then
  echo "Creating pre-restore safety backup..."
  "$SCRIPT_DIR/server-backup.sh"     --config-dir "$CONFIG_DIR"     --output-dir "$CONFIG_DIR/pre-restore-backups"     --allow-inconsistent
fi

compose() {
  docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@" </dev/null
}

compose_with_stdin() {
  docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@"
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
  echo "xDrive API did not become ready after restore" >&2
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

restore_ok=0
on_exit() {
  if [[ "$restore_ok" != "1" ]]; then
    echo "Restore did not complete successfully; xDrive API and pull worker remain stopped." >&2
    echo "Inspect the error, then retry restore or recover from the pre-restore backup." >&2
  fi
}
trap on_exit EXIT INT TERM

compose up -d postgres >/dev/null
wait_postgres
if [[ "$worker_was_running" == "1" ]]; then
  compose stop worker >/dev/null 2>&1 || true
fi
compose stop server >/dev/null 2>&1 || true

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

compose exec -T postgres psql -U xdrive -d postgres -v ON_ERROR_STOP=1   -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'xdrive' AND pid <> pg_backend_pid();" >/dev/null
compose exec -T postgres dropdb -U xdrive --if-exists xdrive
compose exec -T postgres createdb -U xdrive -O xdrive xdrive
compose_with_stdin exec -T postgres pg_restore -U xdrive -d xdrive --no-owner --no-privileges < "$BACKUP_DIR/database.dump"

docker run --rm --entrypoint sh \
  -v "$data_source:/data" \
  -v "$BACKUP_DIR:/backup:ro" \
  "$postgres_image" \
  -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf {} \; && tar -xf /backup/blobs.tar -C /data' </dev/null

echo "Repairing restored storage ownership..."
compose run -T --rm --no-deps --user 0:0 server storage prepare --force </dev/null

echo "Verifying restored metadata and blobs..."
compose run -T --rm --no-deps server storage verify --json </dev/null

if [[ "$server_was_running" == "1" ]]; then
  compose start server >/dev/null
  wait_server
fi
if [[ "$worker_was_running" == "1" && "$server_was_running" == "1" ]]; then
  compose start worker >/dev/null
fi
restore_ok=1
trap - EXIT INT TERM
echo "xDrive restore completed successfully."
