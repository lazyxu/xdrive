#!/usr/bin/env bash
set -euo pipefail
umask 077

CONFIG_DIR="${XD_CONFIG_DIR:-$HOME/.xd}"
COMPOSE_PATH="$CONFIG_DIR/docker-compose.yml"
CADDY_PATH="$CONFIG_DIR/Caddyfile"
ENV_PATH="$CONFIG_DIR/.env"
SOURCE_REF="${XD_SOURCE_REF:-@SOURCE_REF@}"
IMAGE_TAG="${XD_IMAGE_TAG:-@IMAGE_TAG@}"
REPOSITORY="${XD_GITHUB_REPOSITORY:-lazyxu/xdrive}"
STAGING_DIR="$CONFIG_DIR/.install-staging"

if [[ "$SOURCE_REF" == "@SOURCE_REF@" ]]; then SOURCE_REF="master"; fi
if [[ "$IMAGE_TAG" == "@IMAGE_TAG@" ]]; then IMAGE_TAG="edge"; fi

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "xDrive server installer: missing required command: $1" >&2
    exit 1
  }
}

case "$(uname -m)" in
  x86_64|amd64) ;;
  *) echo "xDrive server installer: current published images support Linux amd64 only." >&2; exit 1 ;;
esac

need docker
if ! docker compose version >/dev/null 2>&1; then
  echo "xDrive server installer: Docker Compose v2 is required (docker compose)." >&2
  exit 1
fi

mkdir -p "$CONFIG_DIR" "$STAGING_DIR"
chmod 700 "$CONFIG_DIR" "$STAGING_DIR"

fetch() {
  local url="$1" destination="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$destination.tmp"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$destination.tmp" "$url"
  else
    echo "xDrive server installer: curl or wget is required." >&2
    exit 1
  fi
  mv "$destination.tmp" "$destination"
}

raw_base="https://raw.githubusercontent.com/$REPOSITORY/$SOURCE_REF"
fetch "$raw_base/deploy/docker-compose.yml" "$STAGING_DIR/docker-compose.yml"
fetch "$raw_base/deploy/Caddyfile" "$STAGING_DIR/Caddyfile"
for maintenance_script in server-backup.sh server-backup-scheduled.sh server-restore.sh server-verify.sh; do
  fetch "$raw_base/scripts/$maintenance_script" "$STAGING_DIR/$maintenance_script"
  chmod 700 "$STAGING_DIR/$maintenance_script"
done
chmod 600 "$STAGING_DIR/docker-compose.yml" "$STAGING_DIR/Caddyfile"

random_hex() {
  local bytes="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$bytes" <<'PY'
import secrets, sys
print(secrets.token_hex(int(sys.argv[1])))
PY
  else
    od -An -N "$bytes" -tx1 /dev/urandom | tr -d ' \n'
  fi
}

ensure_env() {
  local key="$1" value="$2"
  if ! grep -q "^${key}=" "$ENV_PATH" 2>/dev/null; then printf '%s=%s\n' "$key" "$value" >> "$ENV_PATH"; fi
}

set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_PATH" 2>/dev/null; then
    local tmp="$ENV_PATH.tmp"
    awk -v k="$key" -v v="$value" 'BEGIN{FS="="} $1==k{print k "=" v; next} {print}' "$ENV_PATH" > "$tmp"
    mv "$tmp" "$ENV_PATH"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_PATH"
  fi
}

env_value() {
  local key="$1" value
  value="$(grep "^${key}=" "$ENV_PATH" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
  value="${value%$'\r'}"
  if [[ "$value" == \"*\" && "$value" == *\" && ${#value} -ge 2 ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s\n' "$value"
}

validate_domain() {
  local value="$1"
  if [[ -z "$value" ]]; then
    return 0
  fi
  if [[ "$value" == *"://"* || "$value" == *"/"* || "$value" == *":"* || "$value" == *" "* || "$value" == *".."* ]]; then
    echo "xDrive server installer: XD_DOMAIN must be a hostname only, for example drive.example.com." >&2
    return 1
  fi
  if [[ ! "$value" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; then
    echo "xDrive server installer: invalid XD_DOMAIN: $value" >&2
    return 1
  fi
}

touch "$ENV_PATH"
chmod 600 "$ENV_PATH"
ensure_env POSTGRES_PASSWORD "${POSTGRES_PASSWORD:-$(random_hex 24)}"
ensure_env XD_JWT_SECRET "${XD_JWT_SECRET:-$(random_hex 48)}"
ensure_env XD_ACCESS_TOKEN_TTL "${XD_ACCESS_TOKEN_TTL:-15m}"
ensure_env XD_REFRESH_TOKEN_TTL "${XD_REFRESH_TOKEN_TTL:-720h}"
ensure_env XD_WEB_BIND "${XD_WEB_BIND:-127.0.0.1}"
ensure_env XD_WEB_PORT "${XD_WEB_PORT:-3000}"
ensure_env XD_ALLOWED_ORIGIN "${XD_ALLOWED_ORIGIN:-http://localhost:3000}"
ensure_env XD_MAX_UPLOAD_BYTES "${XD_MAX_UPLOAD_BYTES:-21474836480}"
ensure_env XD_DOMAIN "${XD_DOMAIN:-}"
ensure_env XD_HTTP_BIND "${XD_HTTP_BIND:-0.0.0.0}"
ensure_env XD_HTTPS_BIND "${XD_HTTPS_BIND:-0.0.0.0}"
ensure_env XD_POSTGRES_MEMORY_LIMIT "${XD_POSTGRES_MEMORY_LIMIT:-1g}"
ensure_env XD_POSTGRES_CPU_LIMIT "${XD_POSTGRES_CPU_LIMIT:-1.0}"
ensure_env XD_POSTGRES_PIDS_LIMIT "${XD_POSTGRES_PIDS_LIMIT:-256}"
ensure_env XD_SERVER_MEMORY_LIMIT "${XD_SERVER_MEMORY_LIMIT:-1g}"
ensure_env XD_SERVER_CPU_LIMIT "${XD_SERVER_CPU_LIMIT:-1.0}"
ensure_env XD_SERVER_PIDS_LIMIT "${XD_SERVER_PIDS_LIMIT:-256}"
ensure_env XD_WEB_MEMORY_LIMIT "${XD_WEB_MEMORY_LIMIT:-256m}"
ensure_env XD_WEB_CPU_LIMIT "${XD_WEB_CPU_LIMIT:-0.50}"
ensure_env XD_WEB_PIDS_LIMIT "${XD_WEB_PIDS_LIMIT:-128}"
ensure_env XD_CADDY_MEMORY_LIMIT "${XD_CADDY_MEMORY_LIMIT:-256m}"
ensure_env XD_CADDY_CPU_LIMIT "${XD_CADDY_CPU_LIMIT:-0.50}"
ensure_env XD_CADDY_PIDS_LIMIT "${XD_CADDY_PIDS_LIMIT:-128}"
ensure_env XD_LOG_MAX_SIZE "${XD_LOG_MAX_SIZE:-10m}"
ensure_env XD_LOG_MAX_FILES "${XD_LOG_MAX_FILES:-5}"
ensure_env XD_BACKUP_RETENTION_DAYS "${XD_BACKUP_RETENTION_DAYS:-7}"
ensure_env XD_BACKUP_SCHEDULE "${XD_BACKUP_SCHEDULE:-17 3 * * *}"
domain="$(env_value XD_DOMAIN)"
if [[ -z "$domain" && -r /dev/tty && -w /dev/tty && "${XD_NONINTERACTIVE:-0}" != "1" ]]; then
  read -r -p "Public domain for automatic HTTPS (blank for HTTP/private mode): " input_domain </dev/tty || true
  domain="${input_domain:-}"
  if [[ -n "$domain" ]]; then
    domain="$(printf '%s' "$domain" | tr '[:upper:]' '[:lower:]')"
    validate_domain "$domain"
    set_env XD_DOMAIN "$domain"
  fi
fi

if [[ -n "$domain" ]]; then
  validate_domain "$domain"
  set_env XD_ALLOWED_ORIGIN "https://$domain"
  set_env XD_WEB_BIND "127.0.0.1"
else
  # HTTP/private mode remains directly reachable on XD_WEB_PORT.
  if [[ "$(env_value XD_WEB_BIND)" == "127.0.0.1" && "${XD_KEEP_LOOPBACK_HTTP:-0}" != "1" ]]; then
    set_env XD_WEB_BIND "0.0.0.0"
  fi
fi

# Upgrade safety: take a backup with the currently installed deployment before
# replacing compose/scripts. A failed backup aborts the upgrade.
if [[ -f "$COMPOSE_PATH" && -x "$CONFIG_DIR/server-backup.sh" ]]; then
  if docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" ps -q server 2>/dev/null | grep -q .; then
    echo "Existing xDrive deployment detected; creating pre-upgrade backup..."
    "$CONFIG_DIR/server-backup.sh" --config-dir "$CONFIG_DIR" --output-dir "$CONFIG_DIR/pre-upgrade-backups"
  fi
fi

# Only point at the new release images after the old deployment has been
# backed up successfully. This keeps pre-upgrade verification on the exact
# server/Web version that owns the current database and blob layout.
set_env XD_SERVER_IMAGE "ghcr.io/lazyxu/xdrive-server:$IMAGE_TAG"
set_env XD_WEB_IMAGE "ghcr.io/lazyxu/xdrive-web:$IMAGE_TAG"

install -m 600 "$STAGING_DIR/docker-compose.yml" "$COMPOSE_PATH"
install -m 600 "$STAGING_DIR/Caddyfile" "$CADDY_PATH"
for maintenance_script in server-backup.sh server-backup-scheduled.sh server-restore.sh server-verify.sh; do
  install -m 700 "$STAGING_DIR/$maintenance_script" "$CONFIG_DIR/$maintenance_script"
done
rm -rf "$STAGING_DIR"

compose() {
  if [[ -n "$(env_value XD_DOMAIN)" ]]; then
    docker compose --profile https --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@"
  else
    docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@"
  fi
}

install_backup_schedule() {
  command -v crontab >/dev/null 2>&1 || {
    echo "Backup schedule: crontab is unavailable; run $CONFIG_DIR/server-backup-scheduled.sh from your scheduler."
    return 0
  }
  local schedule existing tmp
  schedule="$(env_value XD_BACKUP_SCHEDULE)"
  [[ -n "$schedule" ]] || return 0
  existing="$(crontab -l 2>/dev/null || true)"
  tmp="$(mktemp)"
  printf '%s\n' "$existing" | grep -v '# xdrive-managed-backup$' > "$tmp" || true
  printf '%s XD_CONFIG_DIR=%q %q >> %q 2>&1 # xdrive-managed-backup\n' \
    "$schedule" "$CONFIG_DIR" "$CONFIG_DIR/server-backup-scheduled.sh" "$CONFIG_DIR/backup.log" >> "$tmp"
  crontab "$tmp"
  rm -f "$tmp"
  echo "Backup schedule installed: $schedule; retention $(env_value XD_BACKUP_RETENTION_DAYS) days."
}

echo "xDrive compose: $COMPOSE_PATH"
echo "xDrive env:     $ENV_PATH"

if [[ "${XD_INSTALL_NO_START:-0}" == "1" ]]; then
  echo "Files installed without starting containers."
  exit 0
fi

if ! compose pull; then
  cat >&2 <<'MSG'
xDrive server installer: container pull failed.
Make the xdrive-server and xdrive-web packages Public in GitHub package settings,
or authenticate first with: docker login ghcr.io
MSG
  exit 1
fi
compose up -d --remove-orphans

healthy=0
for _ in $(seq 1 60); do
  if compose exec -T server xdrive-server healthcheck >/dev/null 2>&1; then healthy=1; break; fi
  sleep 2
done
if [[ "$healthy" != "1" ]]; then
  echo "xDrive server did not become healthy. Recent logs:" >&2
  compose logs --tail=100 postgres server web >&2 || true
  exit 1
fi

wait_https() {
  local domain="$1" attempt
  local bind probe_ip
  bind="$(env_value XD_HTTPS_BIND)"
  probe_ip="127.0.0.1"
  if [[ -n "$bind" && "$bind" != "0.0.0.0" && "$bind" != "::" ]]; then
    probe_ip="$bind"
  fi

  echo "Waiting for automatic HTTPS certificate and reverse proxy readiness..."
  for attempt in $(seq 1 90); do
    if command -v curl >/dev/null 2>&1; then
      if curl -fsS --max-time 8 --resolve "$domain:443:$probe_ip" "https://$domain/api/v1/healthz" >/dev/null 2>&1; then
        echo "HTTPS ready: https://$domain"
        return 0
      fi
    elif command -v wget >/dev/null 2>&1; then
      if wget -q --timeout=8 --spider "https://$domain/api/v1/healthz" >/dev/null 2>&1; then
        echo "HTTPS ready: https://$domain"
        return 0
      fi
    fi
    sleep 2
  done

  echo "xDrive HTTPS did not become ready." >&2
  echo "Confirm the domain resolves to this server and inbound TCP 80/443 reaches it." >&2
  compose logs --tail=120 caddy web server >&2 || true
  return 1
}

if [[ -n "$(env_value XD_DOMAIN)" ]]; then
  wait_https "$(env_value XD_DOMAIN)"
fi

compose ps
install_backup_schedule

if ! compose exec -T server xdrive-server admin exists >/dev/null 2>&1; then
  echo
  echo "xDrive requires an administrator account before users can sign in."
  if [[ -r /dev/tty && -w /dev/tty ]]; then
    admin_username="admin"
    read -r -p "Administrator username [admin]: " input_username </dev/tty || true
    [[ -n "${input_username:-}" ]] && admin_username="$input_username"
    while true; do
      read -r -s -p "Administrator password: " admin_password </dev/tty || true; printf '\n' >/dev/tty
      read -r -s -p "Confirm administrator password: " admin_password_confirm </dev/tty || true; printf '\n' >/dev/tty
      if [[ "$admin_password" == "$admin_password_confirm" && -n "$admin_password" ]]; then break; fi
      echo "Passwords did not match; try again." >/dev/tty
    done
    printf '%s\n' "$admin_password" | compose exec -T server xdrive-server admin create --username "$admin_username" --password-stdin
    unset admin_password admin_password_confirm
  else
    echo "Create the first administrator with:"
    echo "  read -s -p 'Admin password: ' P; echo; printf '%s\\n' \"\$P\" | docker compose --env-file '$ENV_PATH' -f '$COMPOSE_PATH' exec -T server xdrive-server admin create --username admin --password-stdin; unset P"
  fi
fi

echo
if [[ -n "$(env_value XD_DOMAIN)" ]]; then
  echo "xDrive is running at: https://$(env_value XD_DOMAIN)"
  echo "DNS must resolve that domain to this server and TCP 80/443 must reach it."
else
  echo "xDrive is running in HTTP/private mode on port $(env_value XD_WEB_PORT)."
fi
echo "Backup now:      $CONFIG_DIR/server-backup.sh"
echo "Restore:         $CONFIG_DIR/server-restore.sh"
echo "Verify storage:  $CONFIG_DIR/server-verify.sh"
echo "Manage: docker compose --env-file '$ENV_PATH' -f '$COMPOSE_PATH' <command>"
