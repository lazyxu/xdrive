#!/usr/bin/env bash
set -euo pipefail

CONFIG_DIR="${XD_CONFIG_DIR:-$HOME/.xd}"
COMPOSE_PATH=""
ENV_PATH=""
ONLINE=0

usage() {
  cat <<'EOF'
Usage: server-verify.sh [--config-dir DIR] [--online]

By default xDrive briefly stops the API service to produce a stable consistency
check. --online avoids the maintenance window but can report transient results
while files are being written.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config-dir) CONFIG_DIR="$2"; shift 2 ;;
    --online) ONLINE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

COMPOSE_PATH="$CONFIG_DIR/docker-compose.yml"
ENV_PATH="$CONFIG_DIR/.env"
[[ -f "$COMPOSE_PATH" ]] || { echo "missing $COMPOSE_PATH" >&2; exit 1; }
[[ -f "$ENV_PATH" ]] || { echo "missing $ENV_PATH" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }

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

if [[ "$ONLINE" == "1" ]]; then
  compose exec -T server xdrive-server storage verify --json </dev/null
  exit $?
fi

server_was_running=0
if compose ps --status running --services | grep -qx server; then
  server_was_running=1
fi

restart_server() {
  if [[ "$server_was_running" == "1" ]]; then
    compose start server >/dev/null 2>&1 || true
  fi
}
trap restart_server EXIT INT TERM

compose up -d postgres >/dev/null
wait_postgres
compose stop server >/dev/null 2>&1 || true
compose run -T --rm --no-deps server storage verify --json </dev/null
