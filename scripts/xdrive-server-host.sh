#!/usr/bin/env bash
set -euo pipefail
umask 077

REPOSITORY="${XD_REPOSITORY:-lazyxu/xdrive}"
GITLAB_BASE_URL="${XD_GITLAB_BASE_URL:-http://gitlab.t-fluid.com:1080}"
GITLAB_PROJECT="${XD_GITLAB_PROJECT:-xuliang/xdrive}"
INSTALLER_URL_OVERRIDE="${XD_INSTALLER_URL:-}"

resolve_self() {
  if command -v readlink >/dev/null 2>&1; then
    readlink -f "${BASH_SOURCE[0]}" 2>/dev/null && return 0
  fi
  printf '%s\n' "${BASH_SOURCE[0]}"
}

SELF_PATH="$(resolve_self)"
SELF_DIR="$(cd "$(dirname "$SELF_PATH")" && pwd)"
if [[ "$(basename "$SELF_DIR")" == "bin" ]]; then
  DEFAULT_XDRIVE_HOME="$(cd "$SELF_DIR/.." && pwd)"
else
  # Legacy flat installs placed xdrive-server directly in ~/.xd.
  DEFAULT_XDRIVE_HOME="$SELF_DIR"
fi
XDRIVE_HOME="${XD_CONFIG_DIR:-$DEFAULT_XDRIVE_HOME}"
CONFIG_DIR="$XDRIVE_HOME/config"
BIN_DIR="$XDRIVE_HOME/bin"
DATA_DIR="$XDRIVE_HOME/data"
BACKUP_DIR="$XDRIVE_HOME/backups"
LOG_DIR="$XDRIVE_HOME/logs"
STATE_DIR="$XDRIVE_HOME/state"
LEGACY_VOLUMES_RECORD="$STATE_DIR/legacy-volumes-retained"
HOST_BIN_DIR="${XD_HOST_BIN_DIR:-/usr/local/bin}"
HOST_MANAGER_LINK="$HOST_BIN_DIR/xdrive-server"
ENV_PATH="$CONFIG_DIR/.env"
COMPOSE_PATH="$CONFIG_DIR/docker-compose.yml"

usage() {
  cat <<'EOF'
xDrive server host manager

Usage:
  xdrive-server update [--source github|gitlab] [--channel stable|master|commit] [--commit SHA]
  xdrive-server doctor [--strict]
  xdrive-server status
  xdrive-server backup [server-backup.sh options...]
  xdrive-server restore BACKUP_DIR [server-restore.sh options...]
  xdrive-server verify [--online] [--repair [--dry-run]]
  xdrive-server cleanup legacy-volumes [--yes]
  xdrive-server uninstall [--purge-data] [--purge-backups] --yes
  xdrive-server admin list
  xdrive-server admin reset-password USER [--no-must-change]
  xdrive-server admin reset-password USER --password-stdin [--no-must-change]
  xdrive-server admin enable USER
  xdrive-server admin disable USER
  xdrive-server version

This command runs on the Docker host. It manages the xDrive home (default
~/.xd) and the xDrive containers; it is not the xdrive-server API daemon
inside the container.
EOF
}

env_value() {
  local key="$1" value
  [[ -f "$ENV_PATH" ]] || return 0
  value="$(grep "^$key=" "$ENV_PATH" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
  value="${value%$'\r'}"
  if [[ "$value" == \"*\" && "$value" == *\" && ${#value} -ge 2 ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s\n' "$value"
}

compose() {
  local domain
  domain="$(env_value XD_DOMAIN)"
  if [[ -n "$domain" ]]; then
    docker compose --profile https --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@" </dev/null
  else
    docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@" </dev/null
  fi
}

compose_with_stdin() {
  local domain
  domain="$(env_value XD_DOMAIN)"
  if [[ -n "$domain" ]]; then
    docker compose --profile https --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@"
  else
    docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@"
  fi
}

record_system_audit() {
  local action="$1" result="$2" target_id="${3:-}"
  [[ -f "$ENV_PATH" && -f "$COMPOSE_PATH" ]] || return 0

  local args=(audit record --action "$action" --result "$result")
  if [[ -n "$target_id" ]]; then
    args+=(--target-id "$target_id")
  fi

  if compose exec -T server xdrive-server "${args[@]}" >/dev/null 2>&1; then
    return 0
  fi
  if compose run --rm -T --no-deps server "${args[@]}" >/dev/null 2>&1; then
    return 0
  fi
  echo "xdrive-server: warning: could not persist audit event $action/$result" >&2
  return 0
}

normalize_update_source() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    ""|github) printf '%s\n' github ;;
    gitlab) printf '%s\n' gitlab ;;
    *) echo "xdrive-server: invalid update source: $1 (expected github or gitlab)" >&2; return 2 ;;
  esac
}

installer_url_for_source() {
  local source="$1"
  if [[ -n "$INSTALLER_URL_OVERRIDE" ]]; then
    printf '%s\n' "$INSTALLER_URL_OVERRIDE"
    return
  fi
  case "$source" in
    github) printf 'https://raw.githubusercontent.com/%s/master/deploy/install-server.sh\n' "$REPOSITORY" ;;
    gitlab) printf '%s/%s/-/raw/master/deploy/install-server.sh\n' "${GITLAB_BASE_URL%/}" "${GITLAB_PROJECT#/}" ;;
  esac
}

download_installer() {
  local source="$1" destination="$2" installer_url
  installer_url="$(installer_url_for_source "$source")"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 5 --retry-delay 2 --connect-timeout 10 \
      "$installer_url" -o "$destination" </dev/null
  elif command -v wget >/dev/null 2>&1; then
    wget -q --tries=5 --timeout=15 -O "$destination" "$installer_url" </dev/null
  else
    echo "xdrive-server: curl or wget is required to update." >&2
    return 1
  fi
}

update_cmd() (
  local tmp installer status target_commit audit_target="" previous="" update_source=""
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/xdrive-server-update.XXXXXX")"
  installer="$tmp/install-server.sh"
  trap 'rm -rf "$tmp"' EXIT INT TERM

  for arg in "$@"; do
    case "$previous" in
      --commit) audit_target="$arg" ;;
      --channel) [[ -z "$audit_target" ]] && audit_target="$arg" ;;
      --source) update_source="$arg" ;;
    esac
    previous="$arg"
  done
  [[ -n "$audit_target" ]] || audit_target="$(env_value XD_RELEASE_CHANNEL)"
  [[ -n "$update_source" ]] || update_source="$(env_value XD_UPDATE_SOURCE)"
  update_source="$(normalize_update_source "$update_source")"

  echo "[xDrive] downloading host installer from $update_source..."
  download_installer "$update_source" "$installer"
  chmod 700 "$installer"
  bash -n "$installer"
  echo "[xDrive] installer downloaded and syntax-checked."

  if [[ -t 0 && -r /dev/tty && -w /dev/tty ]]; then
    if XD_CONFIG_DIR="$XDRIVE_HOME" bash "$installer" "$@" </dev/tty; then status=0; else status=$?; fi
  else
    if XD_CONFIG_DIR="$XDRIVE_HOME" XD_NONINTERACTIVE=1 bash "$installer" "$@" </dev/null; then status=0; else status=$?; fi
  fi

  target_commit="$(env_value XD_RELEASE_COMMIT)"
  if [[ "$status" -eq 0 ]]; then
    [[ -n "$target_commit" ]] && audit_target="$target_commit"
    record_system_audit system.update success "$audit_target"
  else
    record_system_audit system.update failure "$audit_target"
  fi
  return "$status"
)

doctor_cmd() {
  local doctor="$BIN_DIR/server-doctor.sh"
  [[ -x "$doctor" ]] || {
    echo "xdrive-server: server doctor is not installed at $doctor" >&2
    return 1
  }
  XD_CONFIG_DIR="$XDRIVE_HOME" exec "$doctor" "$@"
}

status_cmd() {
  [[ -f "$ENV_PATH" && -f "$COMPOSE_PATH" ]] || {
    echo "xdrive-server: no xDrive deployment found in $CONFIG_DIR" >&2
    return 1
  }
  compose ps
}

backup_cmd() {
  local script="$BIN_DIR/server-backup.sh" status
  [[ -x "$script" ]] || {
    echo "xdrive-server: backup tool is not installed at $script" >&2
    return 1
  }
  if XD_CONFIG_DIR="$XDRIVE_HOME" "$script" "$@"; then status=0; else status=$?; fi
  if [[ "$status" -eq 0 ]]; then
    record_system_audit system.backup success
  else
    record_system_audit system.backup failure
  fi
  return "$status"
}

restore_cmd() {
  local script="$BIN_DIR/server-restore.sh" status
  [[ -x "$script" ]] || {
    echo "xdrive-server: restore tool is not installed at $script" >&2
    return 1
  }
  if XD_CONFIG_DIR="$XDRIVE_HOME" "$script" "$@"; then status=0; else status=$?; fi
  if [[ "$status" -eq 0 ]]; then
    record_system_audit system.restore success
  else
    record_system_audit system.restore failure
  fi
  return "$status"
}

verify_cmd() {
  local script="$BIN_DIR/server-verify.sh" status repair=0 dry_run=0 arg
  [[ -x "$script" ]] || {
    echo "xdrive-server: verify tool is not installed at $script" >&2
    return 1
  }
  for arg in "$@"; do
    [[ "$arg" == "--repair" ]] && repair=1
    [[ "$arg" == "--dry-run" ]] && dry_run=1
  done
  if XD_CONFIG_DIR="$XDRIVE_HOME" "$script" "$@"; then status=0; else status=$?; fi
  if [[ "$repair" == "1" && "$dry_run" != "1" ]]; then
    if [[ "$status" -eq 0 ]]; then
      record_system_audit system.storage_repair success
    else
      record_system_audit system.storage_repair failure
    fi
  fi
  return "$status"
}

remove_backup_schedule() {
  command -v crontab >/dev/null 2>&1 || return 0
  local current tmp
  current="$(crontab -l 2>/dev/null || true)"
  [[ -n "$current" ]] || return 0
  tmp="$(mktemp "${TMPDIR:-/tmp}/xdrive-crontab.XXXXXX")"
  printf '%s\n' "$current" | grep -v '# xdrive-managed-backup$' > "$tmp" || true
  crontab "$tmp"
  rm -f "$tmp"
}

legacy_volume_candidates() {
  [[ -f "$LEGACY_VOLUMES_RECORD" ]] || return 0
  awk -F= '
    $1 ~ /^(files|postgres|caddy_data|caddy_config)$/ && length($2) > 0 {
      print $2
    }
  ' "$LEGACY_VOLUMES_RECORD" | awk 'NF && !seen[$0]++'
}

cleanup_legacy_volumes_cmd() {
  local confirm=0 arg volume attached remaining=0
  for arg in "$@"; do
    case "$arg" in
      --yes) confirm=1 ;;
      *) echo "usage: xdrive-server cleanup legacy-volumes [--yes]" >&2; return 2 ;;
    esac
  done

  mapfile -t volumes < <(legacy_volume_candidates)
  if [[ "${#volumes[@]}" -eq 0 ]]; then
    echo "No retained legacy xDrive volumes are recorded."
    rm -f "$LEGACY_VOLUMES_RECORD"
    return 0
  fi

  echo "Retained legacy Docker volumes:"
  printf '  %s\n' "${volumes[@]}"
  if [[ "$confirm" != "1" ]]; then
    echo "No changes made. Rerun with --yes after confirming the bind-mounted deployment and backups are healthy."
    return 2
  fi

  for volume in "${volumes[@]}"; do
    if ! docker volume inspect "$volume" </dev/null >/dev/null 2>&1; then
      echo "[xDrive] legacy volume already absent: $volume"
      continue
    fi
    attached="$(docker ps -aq --filter "volume=$volume" </dev/null 2>/dev/null || true)"
    if [[ -n "$attached" ]]; then
      echo "xdrive-server: refusing to remove legacy volume $volume because container(s) still reference it: $attached" >&2
      remaining=1
      continue
    fi
    echo "[xDrive] removing retained legacy volume: $volume"
    if ! docker volume rm "$volume" </dev/null; then
      remaining=1
    fi
  done

  for volume in "${volumes[@]}"; do
    if docker volume inspect "$volume" </dev/null >/dev/null 2>&1; then
      remaining=1
    fi
  done
  if [[ "$remaining" == "0" ]]; then
    rm -f "$LEGACY_VOLUMES_RECORD"
    echo "Legacy xDrive volumes cleaned up."
    if [[ -f "$STATE_DIR/runtime-uninstalled" ]]; then
      local purge_all=0
      grep -q '^purge_all=1$' "$STATE_DIR/runtime-uninstalled" && purge_all=1
      rm -f "$STATE_DIR/runtime-uninstalled"
      rm -f "$BIN_DIR/xdrive-server"
      rmdir "$BIN_DIR" "$STATE_DIR" 2>/dev/null || true
      if [[ "$purge_all" == "1" ]]; then
        rm -f "$ENV_PATH"
        rmdir "$CONFIG_DIR" "$DATA_DIR/caddy" "$DATA_DIR" "$BACKUP_DIR" "$LOG_DIR" "$XDRIVE_HOME" 2>/dev/null || true
        echo "xDrive fully uninstalled after legacy-volume cleanup."
      else
        echo "Retained cleanup manager removed."
      fi
    fi
    return 0
  fi
  echo "xdrive-server: one or more retained legacy volumes remain; the record was kept at $LEGACY_VOLUMES_RECORD" >&2
  return 1
}

cleanup_cmd() {
  local target="${1:-}"
  [[ -n "$target" ]] || {
    echo "usage: xdrive-server cleanup legacy-volumes [--yes]" >&2
    return 2
  }
  shift || true
  case "$target" in
    legacy-volumes) cleanup_legacy_volumes_cmd "$@" ;;
    *) echo "xdrive-server: unknown cleanup target: $target" >&2; return 2 ;;
  esac
}

canonical_path() {
  local path="$1"
  if command -v readlink >/dev/null 2>&1; then
    readlink -m "$path" 2>/dev/null && return 0
  fi
  printf '%s\n' "$path"
}

validate_purge_path() {
  local label="$1" path="$2" resolved home_resolved
  [[ -n "$path" && "$path" == /* ]] || {
    echo "xdrive-server: refusing to purge $label because its path is not absolute: $path" >&2
    return 1
  }
  resolved="$(canonical_path "$path")"
  home_resolved="$(canonical_path "$XDRIVE_HOME")"
  case "$resolved" in
    /|/home|/root|/usr|/etc|/var|/var/lib|/opt|"$HOME"|"$home_resolved"|"$CONFIG_DIR"|"$BACKUP_DIR"|"$BIN_DIR"|"$LOG_DIR"|"$STATE_DIR")
      echo "xdrive-server: refusing dangerous purge path for $label: $resolved" >&2
      return 1
      ;;
  esac
}

purge_container_owned_dir() {
  local label="$1" path="$2" helper_image
  [[ -e "$path" ]] || return 0
  validate_purge_path "$label" "$path"
  helper_image="$(env_value XD_POSTGRES_IMAGE)"
  [[ -n "$helper_image" ]] || helper_image="postgres:17-alpine"
  echo "[xDrive] purging $label: $path"
  docker run --rm --entrypoint sh \
    -v "$path:/xdrive-purge" \
    "$helper_image" \
    -ec 'find /xdrive-purge -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +' </dev/null
  rmdir "$path" 2>/dev/null || true
}

remove_host_manager_link() {
  [[ -L "$HOST_MANAGER_LINK" ]] || return 0
  local target
  target="$(readlink -f "$HOST_MANAGER_LINK" 2>/dev/null || true)"
  if [[ "$target" != "$SELF_PATH" && "$target" != "$(canonical_path "$BIN_DIR/xdrive-server")" ]]; then
    echo "xdrive-server: leaving unrelated symlink $HOST_MANAGER_LINK -> $target" >&2
    return 0
  fi
  if [[ -w "$HOST_BIN_DIR" ]]; then
    rm -f "$HOST_MANAGER_LINK"
  else
    echo "xdrive-server: warning: cannot remove $HOST_MANAGER_LINK without write permission; remove that symlink manually." >&2
  fi
}

uninstall_cmd() {
  local purge_data=0 purge_backups=0 confirm=0 arg
  local files_dir postgres_dir caddy_data_dir caddy_config_dir
  for arg in "$@"; do
    case "$arg" in
      --purge-data) purge_data=1 ;;
      --purge-backups) purge_backups=1 ;;
      --yes) confirm=1 ;;
      *) echo "usage: xdrive-server uninstall [--purge-data] [--purge-backups] --yes" >&2; return 2 ;;
    esac
  done
  if [[ "$confirm" != "1" ]]; then
    echo "xdrive-server: uninstall requires --yes. Data and backups are preserved unless their purge flags are also supplied." >&2
    return 2
  fi

  files_dir="$(env_value XD_FILES_DATA_DIR)"
  postgres_dir="$(env_value XD_POSTGRES_DATA_DIR)"
  caddy_data_dir="$(env_value XD_CADDY_DATA_DIR)"
  caddy_config_dir="$(env_value XD_CADDY_CONFIG_DIR)"
  [[ -n "$files_dir" ]] || files_dir="$DATA_DIR/files"
  [[ -n "$postgres_dir" ]] || postgres_dir="$DATA_DIR/postgres"
  [[ -n "$caddy_data_dir" ]] || caddy_data_dir="$DATA_DIR/caddy/data"
  [[ -n "$caddy_config_dir" ]] || caddy_config_dir="$DATA_DIR/caddy/config"

  if [[ "$purge_data" == "1" ]]; then
    validate_purge_path "file data" "$files_dir"
    validate_purge_path "PostgreSQL data" "$postgres_dir"
    validate_purge_path "Caddy data" "$caddy_data_dir"
    validate_purge_path "Caddy config" "$caddy_config_dir"
  fi

  if [[ -f "$ENV_PATH" && -f "$COMPOSE_PATH" ]]; then
    echo "[xDrive] stopping and removing xDrive containers and network..."
    compose down --remove-orphans
  else
    echo "[xDrive] no active Compose deployment found; cleaning host control files only."
  fi

  remove_backup_schedule
  remove_host_manager_link

  if [[ "$purge_data" == "1" ]]; then
    purge_container_owned_dir "file data" "$files_dir"
    purge_container_owned_dir "PostgreSQL data" "$postgres_dir"
    purge_container_owned_dir "Caddy data" "$caddy_data_dir"
    purge_container_owned_dir "Caddy config" "$caddy_config_dir"
    rmdir "$DATA_DIR/caddy" "$DATA_DIR" 2>/dev/null || true
  fi
  if [[ "$purge_backups" == "1" ]]; then
    echo "[xDrive] purging backups: $BACKUP_DIR"
    rm -rf "$BACKUP_DIR"
  fi

  rm -f "$CONFIG_DIR/docker-compose.yml" "$CONFIG_DIR/Caddyfile"
  rm -rf "$LOG_DIR"

  if [[ -f "$LEGACY_VOLUMES_RECORD" ]]; then
    local retained_tmp manager_tmp purge_all=0
    [[ "$purge_data" == "1" && "$purge_backups" == "1" ]] && purge_all=1
    retained_tmp="$(mktemp "${TMPDIR:-/tmp}/xdrive-legacy-volumes.XXXXXX")"
    manager_tmp="$(mktemp "${TMPDIR:-/tmp}/xdrive-manager.XXXXXX")"
    cp "$LEGACY_VOLUMES_RECORD" "$retained_tmp"
    cp "$BIN_DIR/xdrive-server" "$manager_tmp"
    rm -rf "$STATE_DIR" "$BIN_DIR"
    mkdir -p "$STATE_DIR" "$BIN_DIR"
    chmod 700 "$STATE_DIR" "$BIN_DIR"
    mv "$retained_tmp" "$LEGACY_VOLUMES_RECORD"
    mv "$manager_tmp" "$BIN_DIR/xdrive-server"
    chmod 600 "$LEGACY_VOLUMES_RECORD"
    chmod 700 "$BIN_DIR/xdrive-server"
    printf 'purge_all=%s\n' "$purge_all" > "$STATE_DIR/runtime-uninstalled"
    chmod 600 "$STATE_DIR/runtime-uninstalled"
    echo "[xDrive] retained legacy-volume record: $LEGACY_VOLUMES_RECORD"
    echo "[xDrive] cleanup-only manager retained at $BIN_DIR/xdrive-server"
    echo "[xDrive] run '$BIN_DIR/xdrive-server cleanup legacy-volumes --yes' when you are ready to remove the old volumes."
  else
    rm -rf "$STATE_DIR" "$BIN_DIR"
  fi

  if [[ "$purge_data" == "1" && "$purge_backups" == "1" && ! -f "$LEGACY_VOLUMES_RECORD" ]]; then
    rm -f "$ENV_PATH"
    rmdir "$CONFIG_DIR" "$DATA_DIR/caddy" "$DATA_DIR" "$BACKUP_DIR" "$LOG_DIR" "$XDRIVE_HOME" 2>/dev/null || true
    echo "xDrive fully uninstalled; runtime, data, backups, and retained configuration were removed."
    return 0
  fi

  echo "xDrive runtime uninstalled."
  [[ -f "$ENV_PATH" ]] && echo "Retained configuration/secrets: $ENV_PATH"
  [[ "$purge_data" != "1" ]] && echo "Retained data: $files_dir, $postgres_dir, $caddy_data_dir, $caddy_config_dir"
  [[ "$purge_backups" != "1" ]] && echo "Retained backups: $BACKUP_DIR"
}

admin_cmd() {
  [[ -f "$ENV_PATH" && -f "$COMPOSE_PATH" ]] || {
    echo "xdrive-server: no xDrive deployment found in $CONFIG_DIR" >&2
    return 1
  }

  local subcommand="${1:-}"
  [[ -n "$subcommand" ]] || {
    echo "usage: xdrive-server admin <list|reset-password|enable|disable>" >&2
    return 2
  }
  shift || true

  case "$subcommand" in
    list)
      compose exec -T server xdrive-server admin list "$@"
      ;;
    enable|disable)
      compose exec -T server xdrive-server admin "$subcommand" "$@"
      ;;
    reset-password)
      local password_stdin=0 arg password confirm
      for arg in "$@"; do
        case "$arg" in
          --password-stdin)
            password_stdin=1
            ;;
          --password|--password=*)
            echo "xdrive-server: --password is not supported; use the interactive prompt or --password-stdin." >&2
            return 2
            ;;
        esac
      done

      if [[ "$password_stdin" == "1" ]]; then
        compose_with_stdin exec -T server xdrive-server admin reset-password "$@"
        return
      fi

      if [[ ! -r /dev/tty || ! -w /dev/tty ]]; then
        echo "xdrive-server: no interactive terminal; pass --password-stdin and provide the password on stdin." >&2
        return 2
      fi
      read -r -s -p "New password: " password </dev/tty
      printf '\n' >/dev/tty
      read -r -s -p "Confirm password: " confirm </dev/tty
      printf '\n' >/dev/tty
      if [[ -z "$password" ]]; then
        echo "xdrive-server: password is empty." >&2
        return 2
      fi
      if [[ "$password" != "$confirm" ]]; then
        echo "xdrive-server: passwords do not match." >&2
        return 2
      fi
      printf '%s\n' "$password" |
        compose_with_stdin exec -T server xdrive-server admin reset-password "$@" --password-stdin
      unset password confirm
      ;;
    *)
      echo "usage: xdrive-server admin <list|reset-password|enable|disable>" >&2
      return 2
      ;;
  esac
}

version_cmd() {
  local channel commit image
  channel="$(env_value XD_RELEASE_CHANNEL)"
  commit="$(env_value XD_RELEASE_COMMIT)"
  image="$(env_value XD_SERVER_IMAGE)"
  printf 'channel: %s\n' "${channel:-unknown}"
  [[ -n "$commit" ]] && printf 'commit: %s\n' "${commit:0:12}"
  [[ -n "$image" ]] && printf 'server image: %s\n' "$image"
}

cmd="${1:-}"
[[ -n "$cmd" ]] || { usage >&2; exit 2; }
shift || true

case "$cmd" in
  update) update_cmd "$@" ;;
  doctor) doctor_cmd "$@" ;;
  status) status_cmd "$@" ;;
  backup) backup_cmd "$@" ;;
  restore) restore_cmd "$@" ;;
  verify) verify_cmd "$@" ;;
  cleanup) cleanup_cmd "$@" ;;
  uninstall) uninstall_cmd "$@" ;;
  admin) admin_cmd "$@" ;;
  version) version_cmd ;;
  -h|--help|help) usage ;;
  *) echo "xdrive-server: unknown command: $cmd" >&2; usage >&2; exit 2 ;;
esac
