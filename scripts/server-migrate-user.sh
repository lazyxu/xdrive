#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

usage() {
  cat <<'EOF'
Migrate an xDrive server deployment from root to a normal Linux user.

Usage:
  server-migrate-user.sh USER

Typical:
  /root/.xd/bin/xdrive-server migrate-user alice

Defaults:
  source: /root/.xd (or the current xDrive home when invoked via xdrive-server)
  target: /home/USER/.xd

The source deployment is retained after success as a rollback copy. It is not
deleted automatically.
EOF
}

[[ $# -eq 1 ]] || { usage >&2; exit 2; }
TARGET_USER="$1"

if [[ "${EUID:-$(id -u)}" -ne 0 && "${XD_MIGRATE_TEST_ALLOW_NONROOT:-0}" != "1" ]]; then
  echo "xDrive migration must be started by root because it reads the root deployment and changes file ownership." >&2
  exit 1
fi

command -v getent >/dev/null 2>&1 || { echo "xDrive migration: getent is required." >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "xDrive migration: docker is required." >&2; exit 1; }

format_bytes() {
  awk -v bytes="${1:-0}" 'BEGIN {
    split("B KiB MiB GiB TiB PiB EiB", unit, " ");
    n = bytes + 0; i = 1;
    while (n >= 1024 && i < 7) { n /= 1024; i++ }
    if (i == 1) printf "%.0f %s", n, unit[i]; else printf "%.1f %s", n, unit[i]
  }'
}

passwd_line="$(getent passwd "$TARGET_USER" || true)"
[[ -n "$passwd_line" ]] || { echo "xDrive migration: user '$TARGET_USER' does not exist." >&2; exit 1; }
TARGET_UID="$(id -u "$TARGET_USER")"
TARGET_GID="$(id -g "$TARGET_USER")"
[[ "$TARGET_UID" -ne 0 ]] || { echo "xDrive migration: target must be a non-root user." >&2; exit 1; }
TARGET_LOGIN_HOME="$(printf '%s\n' "$passwd_line" | cut -d: -f6)"
TARGET_SHELL="$(printf '%s\n' "$passwd_line" | cut -d: -f7)"
[[ -n "$TARGET_LOGIN_HOME" && "$TARGET_LOGIN_HOME" == /* ]] || {
  echo "xDrive migration: target user has no usable home directory." >&2
  exit 1
}

SOURCE_HOME="${XD_SOURCE_CONFIG_DIR:-${XD_CONFIG_DIR:-/root/.xd}}"
TARGET_HOME="${XD_TARGET_CONFIG_DIR:-$TARGET_LOGIN_HOME/.xd}"
SOURCE_CONFIG="$SOURCE_HOME/config"
SOURCE_ENV="$SOURCE_CONFIG/.env"
SOURCE_COMPOSE="$SOURCE_CONFIG/docker-compose.yml"
TARGET_CONFIG="$TARGET_HOME/config"
TARGET_ENV="$TARGET_CONFIG/.env"
TARGET_COMPOSE="$TARGET_CONFIG/docker-compose.yml"
TARGET_BIN="$TARGET_HOME/bin"
TARGET_MANAGER="$TARGET_BIN/xdrive-server"
TARGET_STATE="$TARGET_HOME/state"
TARGET_LOG="$TARGET_HOME/logs"
TARGET_RUNTIME_DIR="/run/user/$TARGET_UID"
TARGET_DOCKER_HOST=""
TARGET_DOCKER_ENDPOINT=""
TARGET_DOCKER_SECURITY=""
TARGET_CREATED=0
SOURCE_STOPPED=0
TARGET_STARTED=0
MIGRATION_COMMITTED=0
CRON_CHANGED=0
ROOT_CRON_SNAPSHOT=""
TARGET_CRON_SNAPSHOT=""

[[ "$SOURCE_HOME" == /* && "$TARGET_HOME" == /* ]] || {
  echo "xDrive migration: source and target xDrive homes must be absolute paths." >&2
  exit 1
}
[[ "$SOURCE_HOME" != "$TARGET_HOME" ]] || {
  echo "xDrive migration: source and target xDrive homes are identical." >&2
  exit 1
}
[[ -f "$SOURCE_ENV" && -f "$SOURCE_COMPOSE" ]] || {
  echo "xDrive migration: no active xDrive deployment found at $SOURCE_HOME." >&2
  exit 1
}

command -v flock >/dev/null 2>&1 || {
  echo "xDrive migration: flock is required for migration/update locking." >&2
  exit 1
}
mkdir -p "$SOURCE_HOME/state"
exec 9>"$SOURCE_HOME/state/install.lock"
if ! flock -n 9; then
  echo "xDrive migration: another install/update/migration is already running for $SOURCE_HOME." >&2
  exit 75
fi
printf '%s\n' "${BASHPID:-unknown}" 1>&9

if [[ -e "$TARGET_HOME" ]]; then
  if find "$TARGET_HOME" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null | grep -q .; then
    echo "xDrive migration: target $TARGET_HOME already contains files; refusing to overwrite it." >&2
    exit 1
  fi
else
  TARGET_CREATED=1
fi

run_as_target() {
  local -a clean_env=(
    env
    -u DOCKER_HOST
    -u DOCKER_CONTEXT
    -u DOCKER_CONFIG
    -u DOCKER_TLS_VERIFY
    -u DOCKER_CERT_PATH
    -u DOCKER_API_VERSION
    HOME="$TARGET_LOGIN_HOME"
    USER="$TARGET_USER"
    LOGNAME="$TARGET_USER"
    XDG_RUNTIME_DIR="$TARGET_RUNTIME_DIR"
  )

  if [[ "$(id -u)" -eq "$TARGET_UID" ]]; then
    "${clean_env[@]}" "$@"
  else
    command -v runuser >/dev/null 2>&1 || {
      echo "xDrive migration: runuser is required to execute Docker as $TARGET_USER." >&2
      return 1
    }
    runuser -u "$TARGET_USER" -- "${clean_env[@]}" "$@"
  fi
}

target_docker_with_host() {
  local docker_host="$1"
  shift
  if [[ -n "$docker_host" ]]; then
    run_as_target env DOCKER_HOST="$docker_host" docker "$@"
  else
    run_as_target docker "$@"
  fi
}

target_docker() {
  target_docker_with_host "$TARGET_DOCKER_HOST" "$@"
}

select_target_docker() {
  local rootless_host="unix://$TARGET_RUNTIME_DIR/docker.sock"
  local rootful_host="unix:///var/run/docker.sock"

  # First use the target user's own Docker config/context, but never inherit
  # root's Docker connection overrides.
  if target_docker_with_host "" info </dev/null >/dev/null 2>&1; then
    TARGET_DOCKER_HOST=""
    TARGET_DOCKER_ENDPOINT="target-user default/context"
  elif target_docker_with_host "$rootless_host" info </dev/null >/dev/null 2>&1; then
    TARGET_DOCKER_HOST="$rootless_host"
    TARGET_DOCKER_ENDPOINT="$rootless_host"
  elif target_docker_with_host "$rootful_host" info </dev/null >/dev/null 2>&1; then
    TARGET_DOCKER_HOST="$rootful_host"
    TARGET_DOCKER_ENDPOINT="$rootful_host"
  else
    return 1
  fi

  TARGET_DOCKER_SECURITY="$(target_docker info --format '{{json .SecurityOptions}}' </dev/null 2>/dev/null || true)"
  [[ -n "$TARGET_DOCKER_SECURITY" ]] || TARGET_DOCKER_SECURITY='[]'
}

source_compose() {
  docker compose --env-file "$SOURCE_ENV" -f "$SOURCE_COMPOSE" "$@" </dev/null
}

target_compose() {
  target_docker compose --env-file "$TARGET_ENV" -f "$TARGET_COMPOSE" "$@" </dev/null
}

if ! select_target_docker; then
  echo "xDrive migration: user '$TARGET_USER' cannot access a Docker daemon." >&2
  echo "Checked the target user's clean Docker context, $TARGET_RUNTIME_DIR/docker.sock, and /var/run/docker.sock." >&2
  echo "Configure Docker Rootless Mode or grant this user Docker access, then retry." >&2
  exit 1
fi
if ! target_docker compose version </dev/null >/dev/null 2>&1; then
  echo "xDrive migration: Docker Compose v2 is unavailable to user '$TARGET_USER'." >&2
  exit 1
fi
if printf '%s' "$TARGET_DOCKER_SECURITY" | grep -qi rootless; then
  TARGET_DOCKER_MODE="rootless"
else
  TARGET_DOCKER_MODE="rootful"
fi

source_bytes="$(du -sb "$SOURCE_HOME" 2>/dev/null | awk '{print $1}' || true)"
available_bytes="$(df -PB1 "$TARGET_LOGIN_HOME" 2>/dev/null | awk 'NR==2 {print $4}' || true)"
if [[ "$source_bytes" =~ ^[0-9]+$ && "$available_bytes" =~ ^[0-9]+$ ]]; then
  required_bytes=$(( source_bytes + source_bytes / 10 + 64 * 1024 * 1024 ))
  if (( available_bytes < required_bytes )); then
    echo "xDrive migration: insufficient free space to make a safe copy." >&2
    echo "required approximately $(format_bytes "$required_bytes"); available $(format_bytes "$available_bytes")." >&2
    exit 1
  fi
fi

if command -v crontab >/dev/null 2>&1; then
  ROOT_CRON_SNAPSHOT="$(mktemp "${TMPDIR:-/tmp}/xdrive-root-cron.XXXXXX")"
  TARGET_CRON_SNAPSHOT="$(mktemp "${TMPDIR:-/tmp}/xdrive-target-cron.XXXXXX")"
  crontab -l > "$ROOT_CRON_SNAPSHOT" 2>/dev/null || :
  run_as_target crontab -l > "$TARGET_CRON_SNAPSHOT" 2>/dev/null || :
  chown "$TARGET_UID:$TARGET_GID" "$TARGET_CRON_SNAPSHOT"
fi

rollback() {
  local status=$?
  [[ "$MIGRATION_COMMITTED" == "1" ]] && return "$status"
  trap - EXIT INT TERM
  set +e
  if [[ "$TARGET_STARTED" == "1" && -f "$TARGET_ENV" && -f "$TARGET_COMPOSE" ]]; then
    echo "[xDrive] migration rollback: stopping target-user deployment..." >&2
    target_compose down --remove-orphans >/dev/null 2>&1 || true
  fi
  if [[ "$SOURCE_STOPPED" == "1" ]]; then
    echo "[xDrive] migration rollback: restarting original root deployment..." >&2
    source_compose up -d --remove-orphans >/dev/null 2>&1 || true
  fi
  if [[ "$CRON_CHANGED" == "1" && -n "$ROOT_CRON_SNAPSHOT" && -f "$ROOT_CRON_SNAPSHOT" ]]; then
    echo "[xDrive] migration rollback: restoring backup schedules..." >&2
    crontab "$ROOT_CRON_SNAPSHOT" >/dev/null 2>&1 || true
    if [[ -n "$TARGET_CRON_SNAPSHOT" && -f "$TARGET_CRON_SNAPSHOT" ]]; then
      run_as_target crontab "$TARGET_CRON_SNAPSHOT" >/dev/null 2>&1 || true
    fi
  fi
  if [[ "$TARGET_CREATED" == "1" && -e "$TARGET_HOME" ]]; then
    rm -rf -- "$TARGET_HOME"
  fi
  echo "[xDrive] migration failed; the original deployment remains at $SOURCE_HOME." >&2
  exit "$status"
}
trap rollback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

set_env_file() {
  local file="$1" key="$2" value="$3" tmp
  tmp="$file.tmp"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    awk -v k="$key" -v v="$value" 'BEGIN{FS="="} $1==k{print k "=" v; next} {print}' "$file" > "$tmp"
  else
    cat "$file" > "$tmp"
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  mv "$tmp" "$file"
}

env_value() {
  local file="$1" key="$2"
  grep "^${key}=" "$file" 2>/dev/null | tail -n1 | cut -d= -f2- || true
}

rewrite_data_path() {
  local key="$1" value
  value="$(env_value "$TARGET_ENV" "$key")"
  case "$value" in
    "$SOURCE_HOME") set_env_file "$TARGET_ENV" "$key" "$TARGET_HOME" ;;
    "$SOURCE_HOME"/*) set_env_file "$TARGET_ENV" "$key" "$TARGET_HOME${value#$SOURCE_HOME}" ;;
  esac
}

detect_target_shell_rc() {
  if [[ -n "${XD_TARGET_SHELL_RC:-}" ]]; then
    printf '%s\n' "$XD_TARGET_SHELL_RC"
    return
  fi
  case "$(basename "$TARGET_SHELL")" in
    zsh) printf '%s\n' "$TARGET_LOGIN_HOME/.zshrc" ;;
    bash) printf '%s\n' "$TARGET_LOGIN_HOME/.bashrc" ;;
    *) printf '%s\n' "$TARGET_LOGIN_HOME/.profile" ;;
  esac
}

write_target_path() {
  local rc tmp begin end
  rc="$(detect_target_shell_rc)"
  begin="# >>> xDrive server PATH >>>"
  end="# <<< xDrive server PATH <<<"
  mkdir -p "$(dirname "$rc")"
  touch "$rc"
  chown "$TARGET_UID:$TARGET_GID" "$rc"
  tmp="$(mktemp "$(dirname "$rc")/.xdrive-shell-rc.XXXXXX")"
  awk -v begin="$begin" -v end="$end" '
    $0 == begin { skip=1; next }
    $0 == end { skip=0; next }
    !skip { print }
  ' "$rc" > "$tmp"
  {
    printf '\n%s\n' "$begin"
    printf 'export PATH=%q:$PATH\n' "$TARGET_BIN"
    printf '%s\n' "$end"
  } >> "$tmp"
  chmod --reference="$rc" "$tmp" 2>/dev/null || chmod 600 "$tmp"
  chown "$TARGET_UID:$TARGET_GID" "$tmp"
  mv "$tmp" "$rc"
  TARGET_SHELL_RC="$rc"
}

remove_root_backup_schedule() {
  command -v crontab >/dev/null 2>&1 || return 0
  local existing tmp
  existing="$(crontab -l 2>/dev/null || true)"
  tmp="$(mktemp)"
  printf '%s\n' "$existing" | grep -v '# xdrive-managed-backup$' > "$tmp" || true
  crontab "$tmp"
  rm -f "$tmp"
}

install_target_backup_schedule() {
  command -v crontab >/dev/null 2>&1 || {
    echo "[xDrive] warning: crontab is unavailable; scheduled backups were not migrated." >&2
    return 0
  }
  local schedule existing tmp runtime_env="" docker_host_env=""
  schedule="$(env_value "$TARGET_ENV" XD_BACKUP_SCHEDULE)"
  [[ -n "$schedule" ]] || return 0
  existing="$(run_as_target crontab -l 2>/dev/null || true)"
  tmp="$(mktemp)"
  printf '%s\n' "$existing" | grep -v '# xdrive-managed-backup$' > "$tmp" || true
  if [[ "$TARGET_DOCKER_MODE" == "rootless" ]]; then
    runtime_env="XDG_RUNTIME_DIR=$TARGET_RUNTIME_DIR "
  fi
  if [[ -n "$TARGET_DOCKER_HOST" ]]; then
    docker_host_env="DOCKER_HOST=$TARGET_DOCKER_HOST "
  fi
  printf '%s %s%sXD_CONFIG_DIR=%q %q >> %q 2>&1 # xdrive-managed-backup\n' \
    "$schedule" "$runtime_env" "$docker_host_env" "$TARGET_HOME" "$TARGET_BIN/server-backup-scheduled.sh" "$TARGET_LOG/backup.log" >> "$tmp"
  chown "$TARGET_UID:$TARGET_GID" "$tmp"
  run_as_target crontab "$tmp"
  rm -f "$tmp"
}

echo "[xDrive] migrating server ownership"
echo "  source:      $SOURCE_HOME (root)"
echo "  target:      $TARGET_HOME ($TARGET_USER uid=$TARGET_UID gid=$TARGET_GID)"
echo "  target Docker mode: $TARGET_DOCKER_MODE"
echo "  target Docker endpoint: $TARGET_DOCKER_ENDPOINT"
echo
echo "[xDrive] stopping the original deployment..."
source_compose down --remove-orphans
SOURCE_STOPPED=1

mkdir -p "$TARGET_HOME"
TARGET_CREATED=1
echo "[xDrive] copying xDrive home; the root copy is retained for rollback..."
if cp --help 2>/dev/null | grep -q -- '--reflink'; then
  cp -a --reflink=auto "$SOURCE_HOME/." "$TARGET_HOME/"
else
  cp -a "$SOURCE_HOME/." "$TARGET_HOME/"
fi

[[ -f "$TARGET_ENV" && -f "$TARGET_COMPOSE" ]] || {
  echo "xDrive migration: copied deployment is incomplete." >&2
  exit 1
}
for key in XD_FILES_DATA_DIR XD_POSTGRES_DATA_DIR XD_CADDY_DATA_DIR XD_CADDY_CONFIG_DIR; do
  rewrite_data_path "$key"
done
set_env_file "$TARGET_ENV" XD_DOCKER_MODE "$TARGET_DOCKER_MODE"

chown "$TARGET_UID:$TARGET_GID" "$TARGET_HOME" "$TARGET_HOME/data" 2>/dev/null || true
for owned_path in "$TARGET_CONFIG" "$TARGET_BIN" "$TARGET_HOME/backups" "$TARGET_LOG" "$TARGET_STATE"; do
  [[ -e "$owned_path" ]] && chown -R "$TARGET_UID:$TARGET_GID" "$owned_path"
done
if [[ "$TARGET_DOCKER_MODE" == "rootless" && -d "$TARGET_HOME/data" ]]; then
  # Rootless Docker must be able to traverse the copied bind mounts. Container
  # entrypoints/storage-init will normalize service-specific mapped ownership.
  chown -R "$TARGET_UID:$TARGET_GID" "$TARGET_HOME/data"
fi
chmod 700 "$TARGET_HOME" "$TARGET_CONFIG" "$TARGET_BIN" "$TARGET_STATE" "$TARGET_LOG" 2>/dev/null || true
chmod 600 "$TARGET_ENV"

echo "[xDrive] starting the copied deployment as $TARGET_USER..."
target_compose up -d --remove-orphans
TARGET_STARTED=1

healthy=0
for _ in $(seq 1 60); do
  if target_compose exec -T server xdrive-server healthcheck >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 2
done
if [[ "$healthy" != "1" ]]; then
  echo "xDrive migration: target-user deployment did not become healthy." >&2
  exit 1
fi

legacy_link="/usr/local/bin/xdrive-server"
if [[ -L "$legacy_link" ]]; then
  legacy_target="$(readlink -f "$legacy_link" 2>/dev/null || true)"
  if [[ "$legacy_target" == "$SOURCE_HOME/bin/xdrive-server" || "$legacy_target" == "$TARGET_MANAGER" ]]; then
    rm -f "$legacy_link"
    echo "[xDrive] removed legacy system-wide xdrive-server link: $legacy_link"
  fi
fi

mkdir -p "$TARGET_STATE"
cat > "$TARGET_STATE/migrated-from-root" <<EOF
source_home=$SOURCE_HOME
target_home=$TARGET_HOME
target_user=$TARGET_USER
migrated_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
chown "$TARGET_UID:$TARGET_GID" "$TARGET_STATE/migrated-from-root"
chmod 600 "$TARGET_STATE/migrated-from-root"

CRON_CHANGED=1
install_target_backup_schedule
remove_root_backup_schedule
write_target_path

MIGRATION_COMMITTED=1
rm -f "${ROOT_CRON_SNAPSHOT:-}" "${TARGET_CRON_SNAPSHOT:-}" 2>/dev/null || true
trap - EXIT INT TERM

echo
echo "[xDrive] migration completed successfully."
echo "Active deployment: $TARGET_HOME"
echo "Original root copy retained: $SOURCE_HOME"
echo "Command path was added to: $TARGET_SHELL_RC"
echo
echo "Open a new login shell as $TARGET_USER, or in an already-open target-user shell run:"
printf '  source %q\n' "$TARGET_SHELL_RC"
echo
echo "Then verify:"
echo "  xdrive-server status"
echo "  xdrive-server doctor"
echo
echo "After you have verified the migrated deployment and backups, remove the old root copy manually if desired:"
printf '  rm -rf -- %q\n' "$SOURCE_HOME"
