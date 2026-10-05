#!/usr/bin/env bash
set -euo pipefail
umask 077

REPOSITORY="${XD_REPOSITORY:-lazyxu/xdrive}"
GITLAB_BASE_URL="${XD_GITLAB_BASE_URL:-http://gitlab.t-fluid.com:1080}"
GITLAB_PROJECT="${XD_GITLAB_PROJECT:-xuliang/xdrive}"
GITLAB_LOCAL_FALLBACK_URL="${XD_GITLAB_LOCAL_FALLBACK_URL-http://127.0.0.1:1080}"
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
ENV_PATH="$CONFIG_DIR/.env"
COMPOSE_PATH="$CONFIG_DIR/docker-compose.yml"

usage() {
  cat <<'EOF'
xDrive server host manager

Usage:
  xdrive-server update [--source github|gitlab] [--channel stable|master] [--backup-file-data]
  xdrive-server control <install|start|serve|stop|status>
  xdrive-server doctor [--strict]
  xdrive-server status [--summary-only]
  xdrive-server backup [create] [server-backup.sh options...]
  xdrive-server backup list
  xdrive-server backup verify [BACKUP_DIR]
  xdrive-server backup sources BACKUP_DIR
  xdrive-server restore BACKUP_DIR [server-restore.sh options...]
  xdrive-server verify [--online] [--repair [--dry-run]]
  xdrive-server source verify [--json]
  xdrive-server media verify [--json]
  xdrive-server media repair [--json] [--dry-run]
  xdrive-server migrate-user USER
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

detect_shell_rc() {
  local shell_name
  if [[ -n "${XD_SHELL_RC_PATH:-}" ]]; then
    printf '%s\n' "$XD_SHELL_RC_PATH"
    return
  fi
  shell_name="$(basename "${SHELL:-bash}")"
  case "$shell_name" in
    zsh) printf '%s\n' "$HOME/.zshrc" ;;
    bash) printf '%s\n' "$HOME/.bashrc" ;;
    *) printf '%s\n' "$HOME/.profile" ;;
  esac
}

remove_user_command_path() {
  local rc tmp begin end
  rc="$(detect_shell_rc)"
  [[ -f "$rc" ]] || return 0
  begin="# >>> xDrive server PATH >>>"
  end="# <<< xDrive server PATH <<<"
  tmp="$(mktemp "${TMPDIR:-/tmp}/xdrive-shell-rc.XXXXXX")"
  awk -v begin="$begin" -v end="$end" '
    $0 == begin { skip=1; next }
    $0 == end { skip=0; next }
    !skip { print }
  ' "$rc" > "$tmp"
  cat "$tmp" > "$rc"
  rm -f "$tmp"
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
  docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@" </dev/null
}

compose_with_stdin() {
  docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@"
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
  local source="$1" channel="${2:-master}"
  if [[ -n "$INSTALLER_URL_OVERRIDE" ]]; then
    printf '%s\n' "$INSTALLER_URL_OVERRIDE"
    return
  fi
  case "$source:$channel" in
    github:master)
      # Use the exact installer asset from the fully published rolling release.
      # Downloading raw master can race ahead of the snapshot bundle and create
      # an unsupported "new installer + old maintenance scripts" combination.
      printf 'https://github.com/%s/releases/download/snapshot/xdrive-server-install.sh\n' "$REPOSITORY"
      ;;
    github:stable)
      printf 'https://github.com/%s/releases/latest/download/xdrive-server-install.sh\n' "$REPOSITORY"
      ;;
    gitlab:master|gitlab:stable)
      # GitLab's rolling snapshot commit is carried in release metadata rather
      # than a movable repository tag. Keep the existing bootstrap URL here;
      # the installer resolves and pins the published GitLab release itself.
      printf '%s/%s/-/raw/master/deploy/install-server.sh\n' "${GITLAB_BASE_URL%/}" "${GITLAB_PROJECT#/}"
      ;;
    *)
      echo "xdrive-server: invalid update channel: $channel" >&2
      return 2
      ;;
  esac
}

LAST_DOWNLOAD_TOOL=""

download_installer_url() {
  local installer_url="$1" destination="$2" status
  if command -v curl >/dev/null 2>&1; then
    LAST_DOWNLOAD_TOOL="curl"
    if curl -fsSL --retry 5 --retry-delay 2 --connect-timeout 10 \
      "$installer_url" -o "$destination" </dev/null; then
      return 0
    else
      status=$?
      rm -f "$destination"
      return "$status"
    fi
  elif command -v wget >/dev/null 2>&1; then
    LAST_DOWNLOAD_TOOL="wget"
    if wget -q --tries=5 --timeout=15 -O "$destination" "$installer_url" </dev/null; then
      return 0
    else
      status=$?
      rm -f "$destination"
      return "$status"
    fi
  else
    echo "xdrive-server: curl or wget is required to update." >&2
    return 127
  fi
}

download_failure_is_connectivity() {
  local tool="$1" status="$2"
  case "$tool:$status" in
    curl:5|curl:6|curl:7|curl:28|curl:35|curl:52|curl:55|curl:56|wget:4|wget:5)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

download_installer() {
  local source="$1" destination="$2" channel="${3:-master}" installer_url status fallback_url
  installer_url="$(installer_url_for_source "$source" "$channel")"
  if download_installer_url "$installer_url" "$destination"; then
    return 0
  else
    status=$?
  fi

  if [[ "$source" != "gitlab" || -n "$INSTALLER_URL_OVERRIDE" ||
        -z "$GITLAB_LOCAL_FALLBACK_URL" ||
        "${GITLAB_BASE_URL%/}" == "${GITLAB_LOCAL_FALLBACK_URL%/}" ]]; then
    return "$status"
  fi
  if ! download_failure_is_connectivity "$LAST_DOWNLOAD_TOOL" "$status"; then
    return "$status"
  fi

  fallback_url="${GITLAB_LOCAL_FALLBACK_URL%/}"
  echo "[xDrive] GitLab ${GITLAB_BASE_URL%/} is unreachable; retrying via local fallback $fallback_url..." >&2
  GITLAB_BASE_URL="$fallback_url"
  export XD_GITLAB_BASE_URL="$GITLAB_BASE_URL"
  installer_url="$(installer_url_for_source "$source" "$channel")"
  download_installer_url "$installer_url" "$destination"
}


install_update_lock_busy() {
  local lock="$STATE_DIR/install.lock" owner_pid=""
  command -v flock >/dev/null 2>&1 || return 1
  mkdir -p "$STATE_DIR"
  exec 7<>"$lock"
  if flock -n 7; then
    flock -u 7 >/dev/null 2>&1 || true
    exec 7>&-
    return 1
  fi
  owner_pid="$(head -n1 "$lock" 2>/dev/null | tr -dc '0-9' || true)"
  exec 7>&-
  if [[ "$owner_pid" =~ ^[0-9]+$ ]]; then
    echo "xdrive-server: another install/update is already running for $XDRIVE_HOME (pid $owner_pid)." >&2
  else
    echo "xdrive-server: another install/update is already running for $XDRIVE_HOME." >&2
  fi
  return 0
}

update_cmd() (
  local tmp installer status target_commit audit_target="" previous="" update_source="" update_channel=""

  # Refuse a duplicate update before doing any network I/O. The installer
  # still owns the authoritative lock, so this is only a fast-path check; a
  # race is safely caught again by install-server.sh.
  if install_update_lock_busy; then
    return 75
  fi

  tmp="$(mktemp -d "${TMPDIR:-/tmp}/xdrive-server-update.XXXXXX")"
  installer="$tmp/install-server.sh"
  trap 'rm -rf "$tmp"' EXIT INT TERM

  for arg in "$@"; do
    case "$previous" in
      --channel)
        update_channel="$arg"
        [[ -z "$audit_target" ]] && audit_target="$arg"
        ;;
      --source) update_source="$arg" ;;
    esac
    previous="$arg"
  done
  [[ -n "$audit_target" ]] || audit_target="$(env_value XD_RELEASE_CHANNEL)"
  [[ -n "$update_channel" ]] || update_channel="$(env_value XD_RELEASE_CHANNEL)"
  [[ -n "$update_channel" ]] || update_channel="master"
  case "$update_channel" in
    master|stable) ;;
    *) echo "xdrive-server: invalid update channel: $update_channel (expected stable or master)" >&2; return 2 ;;
  esac
  [[ -n "$update_source" ]] || update_source="$(env_value XD_UPDATE_SOURCE)"
  update_source="$(normalize_update_source "$update_source")"

  echo "[xDrive] downloading $update_channel host installer from $update_source..."
  download_installer "$update_source" "$installer" "$update_channel"
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

control_cmd() {
  local control="$BIN_DIR/server-control.sh"
  [[ -x "$control" ]] || {
    echo "xdrive-server: host control is not installed at $control" >&2
    return 1
  }
  XD_CONFIG_DIR="$XDRIVE_HOME" exec "$control" "$@"
}

doctor_cmd() {
  local doctor="$BIN_DIR/server-doctor.sh"
  [[ -x "$doctor" ]] || {
    echo "xdrive-server: server doctor is not installed at $doctor" >&2
    return 1
  }
  XD_CONFIG_DIR="$XDRIVE_HOME" exec "$doctor" "$@"
}

display_path() {
  local value="$1"
  if [[ "${XD_STATUS_REDACT_HOME:-0}" == "1" && -n "${HOME:-}" && "$value" == "$HOME"* ]]; then
    printf '~%s' "${value#$HOME}"
  else
    printf '%s' "$value"
  fi
}

docker_mode() {
  local security
  if ! docker info </dev/null >/dev/null 2>&1; then
    printf 'unavailable\n'
    return 0
  fi
  security="$(docker info --format '{{json .SecurityOptions}}' </dev/null 2>/dev/null || true)"
  if printf '%s' "$security" | grep -qi rootless; then
    printf 'rootless\n'
  else
    printf 'rootful\n'
  fi
}

disk_usage_for_path() {
  local path="$1" probe="$1"
  command -v df >/dev/null 2>&1 || { printf 'unavailable'; return 0; }
  while [[ ! -e "$probe" && "$probe" != "/" ]]; do
    probe="$(dirname "$probe")"
  done
  df -hP -- "$probe" 2>/dev/null | awk 'NR==2 {
    printf "%s total, %s used, %s free, %s used, fs=%s", $2, $3, $4, $5, $1
  }'
}

configured_path() {
  local key="$1" fallback="$2" value
  value="$(env_value "$key")"
  [[ -n "$value" ]] || value="$fallback"
  printf '%s\n' "$value"
}

active_mount() {
  local service="$1" destination="$2" id info
  [[ -f "$ENV_PATH" && -f "$COMPOSE_PATH" ]] || { printf 'inactive'; return 0; }
  id="$(compose ps -aq "$service" 2>/dev/null | head -n1 || true)"
  [[ -n "$id" ]] || { printf 'inactive'; return 0; }
  info="$(docker inspect "$id" --format "{{range .Mounts}}{{if eq .Destination \"$destination\"}}{{if .Name}}volume={{.Name}}{{else}}bind={{.Source}}{{end}}{{end}}{{end}}" </dev/null 2>/dev/null || true)"
  [[ -n "$info" ]] && printf '%s' "$info" || printf 'missing'
}

status_path_line() {
  local label="$1" path="$2" service="${3:-}" destination="${4:-}" mount="n/a" disk
  disk="$(disk_usage_for_path "$path")"
  if [[ -n "$service" && -n "$destination" ]]; then
    mount="$(active_mount "$service" "$destination")"
  fi
  printf '  %-15s %s\n' "$label" "$(display_path "$path")"
  printf '  %-15s %s; mount=%s\n' "" "${disk:-unavailable}" "$mount"
}

retained_legacy_summary() {
  local value volume exists attached count=0
  if [[ ! -f "$LEGACY_VOLUMES_RECORD" ]]; then
    printf 'none\n'
    return 0
  fi
  while IFS='=' read -r _ value; do
    volume="${value%$'\r'}"
    [[ -n "$volume" ]] || continue
    count=$((count + 1))
    if docker volume inspect "$volume" </dev/null >/dev/null 2>&1; then
      exists="present"
      attached="$(docker ps -aq --filter "volume=$volume" </dev/null 2>/dev/null || true)"
      [[ -n "$attached" ]] && exists="$exists,in-use" || exists="$exists,unused"
    else
      exists="missing"
    fi
    printf '%s (%s)\n' "$volume" "$exists"
  done < "$LEGACY_VOLUMES_RECORD"
  [[ "$count" -gt 0 ]] || printf 'none\n'
}

status_summary() {
  local mode context docker_root source channel commit
  local files_dir postgres_dir caddy_data_dir caddy_config_dir legacy first line

  mode="$(docker_mode)"
  context="$(docker context show </dev/null 2>/dev/null || true)"
  docker_root="$(docker info --format '{{.DockerRootDir}}' </dev/null 2>/dev/null || true)"
  source="$(env_value XD_UPDATE_SOURCE)"
  channel="$(env_value XD_RELEASE_CHANNEL)"
  commit="$(env_value XD_RELEASE_COMMIT)"

  files_dir="$(configured_path XD_FILES_DATA_DIR "$DATA_DIR/files")"
  postgres_dir="$(configured_path XD_POSTGRES_DATA_DIR "$DATA_DIR/postgres")"
  caddy_data_dir="$(configured_path XD_CADDY_DATA_DIR "$DATA_DIR/caddy/data")"
  caddy_config_dir="$(configured_path XD_CADDY_CONFIG_DIR "$DATA_DIR/caddy/config")"

  echo "xDrive installation environment"
  printf '  %-15s %s\n' "Home" "$(display_path "$XDRIVE_HOME")"
  printf '  %-15s %s\n' "Docker mode" "$mode"
  printf '  %-15s %s\n' "Docker context" "${context:-unknown}"
  printf '  %-15s %s\n' "Docker root" "$(display_path "${docker_root:-unknown}")"
  printf '  %-15s %s / %s%s\n' "Update" "${source:-unknown}" "${channel:-unknown}" "${commit:+ / ${commit:0:12}}"
  printf '  %-15s %s\n' "Home disk" "$(disk_usage_for_path "$XDRIVE_HOME")"
  echo "Persistent paths"
  status_path_line "Files" "$files_dir" server /data
  status_path_line "PostgreSQL" "$postgres_dir" postgres /var/lib/postgresql/data
  status_path_line "Caddy data" "$caddy_data_dir" caddy /data
  status_path_line "Caddy config" "$caddy_config_dir" caddy /config
  status_path_line "Backups" "$BACKUP_DIR"

  echo "Retained legacy volumes"
  legacy="$(retained_legacy_summary)"
  first=1
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    if [[ "$first" == "1" ]]; then
      printf '  %-15s %s\n' "Volumes" "$line"
      first=0
    else
      printf '  %-15s %s\n' "" "$line"
    fi
  done <<< "$legacy"
  [[ "$first" == "0" ]] || printf '  %-15s none\n' "Volumes"
}

status_cmd() {
  local summary_only=0 arg
  for arg in "$@"; do
    case "$arg" in
      --summary-only) summary_only=1 ;;
      *) echo "usage: xdrive-server status [--summary-only]" >&2; return 2 ;;
    esac
  done
  [[ -f "$ENV_PATH" && -f "$COMPOSE_PATH" ]] || {
    echo "xdrive-server: no xDrive deployment found in $CONFIG_DIR" >&2
    return 1
  }
  status_summary
  if [[ "$summary_only" != "1" ]]; then
    echo
    echo "Services"
    compose ps
  fi
}

backup_manifest_value() {
  local manifest="$1" key="$2"
  [[ -f "$manifest" ]] || return 0
  sed -nE 's/.*"'"$key"'"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' "$manifest" | head -n1
}

backup_manifest_bool() {
  local manifest="$1" key="$2" fallback="${3:-false}" value
  [[ -f "$manifest" ]] || { printf '%s\n' "$fallback"; return 0; }
  value="$(sed -nE 's/.*"'"$key"'"[[:space:]]*:[[:space:]]*(true|false).*/\1/p' "$manifest" | head -n1)"
  case "$value" in
    true|false) printf '%s\n' "$value" ;;
    *) printf '%s\n' "$fallback" ;;
  esac
}

latest_snapshot_backup() {
  local root="$BACKUP_DIR/snapshots"
  [[ -d "$root" ]] || return 1
  find "$root" -mindepth 1 -maxdepth 1 -type d -name 'xdrive-backup-*' -print | sort -r | head -n1
}

backup_list_cmd() {
  [[ $# -eq 0 ]] || {
    echo "usage: xdrive-server backup list" >&2
    return 2
  }
  local root="$BACKUP_DIR/snapshots" dir name size created channel commit consistent file_data status found=0 required
  if [[ ! -d "$root" ]]; then
    echo "No snapshot backups found in $root"
    return 0
  fi
  printf '%-26s %-20s %-9s %-10s %-14s %s\n' "BACKUP" "CREATED_UTC" "SIZE" "CHANNEL" "COMMIT" "STATUS"
  while IFS= read -r dir; do
    [[ -n "$dir" ]] || continue
    found=1
    name="$(basename "$dir")"
    size="$(du -sh "$dir" 2>/dev/null | awk '{print $1}' || true)"
    created="$(backup_manifest_value "$dir/manifest.json" created_at_utc)"
    channel="$(backup_manifest_value "$dir/manifest.json" release_channel)"
    commit="$(backup_manifest_value "$dir/manifest.json" release_commit)"
    consistent="$(sed -nE 's/.*"consistency_verified"[[:space:]]*:[[:space:]]*(true|false).*/\1/p' "$dir/manifest.json" 2>/dev/null | head -n1 || true)"
    file_data="$(backup_manifest_bool "$dir/manifest.json" file_data_included true)"
    status="complete"
    for required in database.dump verify.json manifest.json SHA256SUMS.txt; do
      if [[ ! -f "$dir/$required" ]]; then
        status="incomplete"
        break
      fi
    done
    if [[ "$status" == "complete" && "$file_data" != "false" && ! -f "$dir/blobs.tar" ]]; then
      status="incomplete"
    fi
    if [[ "$status" == "complete" && "$consistent" == "false" ]]; then
      status="inconsistent"
    elif [[ "$status" == "complete" && "$file_data" == "false" ]]; then
      status="database-only"
    fi
    [[ -n "$created" ]] || created="-"
    [[ -n "$size" ]] || size="-"
    [[ -n "$channel" ]] || channel="-"
    [[ -n "$commit" ]] || commit="-"
    [[ "$commit" == "-" ]] || commit="${commit:0:12}"
    printf '%-26s %-20s %-9s %-10s %-14s %s\n' "$name" "$created" "$size" "$channel" "$commit" "$status"
  done < <(find "$root" -mindepth 1 -maxdepth 1 -type d -name 'xdrive-backup-*' -print | sort -r)
  [[ "$found" == "1" ]] || echo "No snapshot backups found in $root"
}

backup_verify_cmd() {
  [[ $# -le 1 ]] || {
    echo "usage: xdrive-server backup verify [BACKUP_DIR]" >&2
    return 2
  }
  command -v sha256sum >/dev/null 2>&1 || {
    echo "xdrive-server: sha256sum is required to verify backups" >&2
    return 1
  }
  local dir="${1:-}" required created channel commit consistent file_data
  local -a required_files
  if [[ -z "$dir" ]]; then
    dir="$(latest_snapshot_backup || true)"
    [[ -n "$dir" ]] || {
      echo "xdrive-server: no snapshot backup is available to verify" >&2
      return 1
    }
  fi
  [[ -d "$dir" ]] || {
    echo "xdrive-server: backup directory not found: $dir" >&2
    return 1
  }
  dir="$(cd "$dir" && pwd)"
  [[ -f "$dir/manifest.json" ]] || {
    echo "xdrive-server: backup is missing manifest.json: $dir" >&2
    return 1
  }
  grep -Eq '"format_version"[[:space:]]*:[[:space:]]*1' "$dir/manifest.json" || {
    echo "xdrive-server: unsupported backup format: $dir" >&2
    return 1
  }
  file_data="$(backup_manifest_bool "$dir/manifest.json" file_data_included true)"
  required_files=(database.dump verify.json manifest.json SHA256SUMS.txt)
  [[ "$file_data" == "false" ]] || required_files+=(blobs.tar)
  for required in "${required_files[@]}"; do
    [[ -f "$dir/$required" ]] || {
      echo "xdrive-server: backup is missing $required: $dir" >&2
      return 1
    }
  done
  (
    cd "$dir"
    sha256sum -c SHA256SUMS.txt
  )
  created="$(backup_manifest_value "$dir/manifest.json" created_at_utc)"
  channel="$(backup_manifest_value "$dir/manifest.json" release_channel)"
  commit="$(backup_manifest_value "$dir/manifest.json" release_commit)"
  consistent="$(sed -nE 's/.*"consistency_verified"[[:space:]]*:[[:space:]]*(true|false).*/\1/p' "$dir/manifest.json" | head -n1 || true)"
  echo "Backup verified: $dir"
  [[ -n "$created" ]] && echo "  created: $created"
  [[ -n "$channel" ]] && echo "  release: $channel${commit:+ / ${commit:0:12}}"
  if [[ "$file_data" == "false" ]]; then
    echo "  file data: omitted (database-only backup)"
  else
    echo "  file data: included"
  fi
  if [[ "$consistent" == "false" ]]; then
    echo "  warning: this backup was created with consistency_verified=false" >&2
  fi
}


backup_sources_cmd() {
  [[ $# -eq 1 ]] || {
    echo "usage: xdrive-server backup sources BACKUP_DIR" >&2
    return 2
  }
  local dir="$1" created
  [[ -d "$dir" ]] || {
    echo "xdrive-server: backup directory not found: $dir" >&2
    return 1
  }
  dir="$(cd "$dir" && pwd)"
  backup_verify_cmd "$dir" >/dev/null
  [[ -f "$ENV_PATH" && -f "$COMPOSE_PATH" ]] || {
    echo "xdrive-server: active deployment configuration is required to inspect a PostgreSQL backup" >&2
    return 1
  }

  created="$(backup_manifest_value "$dir/manifest.json" created_at_utc)"
  echo "Backup: $dir"
  [[ -n "$created" ]] && echo "Created: $created"
  echo
  printf 'ID\tOWNER_ID\tNAME\tKIND\tDIRECTION\tRUN_MODE\tSTATUS\tUPDATED_AT\n'

  compose_with_stdin exec -T postgres \
    pg_restore --data-only --table=public.xd_sources --file=- \
    < "$dir/database.dump" |
    awk -F '\t' '
      function field(name, n) {
        n=col[name]
        return n > 0 ? $(n) : "-"
      }
      /^COPY public\.xd_sources \(/ {
        header=$0
        sub(/^COPY public\.xd_sources \(/, "", header)
        sub(/\) FROM stdin;$/, "", header)
        count=split(header, columns, /, */)
        for (i=1; i<=count; i++) col[columns[i]]=i
        in_rows=1
        next
      }
      in_rows && $0 == "\\." { in_rows=0; next }
      in_rows {
        found=1
        printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n",
          field("id"),
          field("owner_id"),
          field("name"),
          field("kind"),
          field("direction"),
          field("run_mode"),
          field("status"),
          field("updated_at")
      }
      END {
        if (!found) print "(no external sources)"
      }
    '
}

backup_create_cmd() {
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

backup_cmd() {
  local subcommand="${1:-}"
  case "$subcommand" in
    list)
      shift
      backup_list_cmd "$@"
      ;;
    verify)
      shift
      backup_verify_cmd "$@"
      ;;
    sources)
      shift
      backup_sources_cmd "$@"
      ;;
    create)
      shift
      backup_create_cmd "$@"
      ;;
    *)
      backup_create_cmd "$@"
      ;;
  esac
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

migrate_user_cmd() {
  local script="$BIN_DIR/server-migrate-user.sh"
  [[ -x "$script" ]] || {
    echo "xdrive-server: migration tool is not installed at $script" >&2
    return 1
  }
  if [[ "${EUID:-$(id -u)}" -ne 0 && "${XD_MIGRATE_TEST_ALLOW_NONROOT:-0}" != "1" ]]; then
    echo "xdrive-server: migrate-user must be started by root." >&2
    return 1
  fi
  XD_SOURCE_CONFIG_DIR="$XDRIVE_HOME" exec "$script" "$@"
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

source_cmd() {
  local subcommand="${1:-}"
  case "$subcommand" in
    verify)
      shift
      compose exec -T server xdrive-server source verify "$@"
      ;;
    *)
      echo "usage: xdrive-server source verify [--json]" >&2
      return 2
      ;;
  esac
}

media_cmd() {
  local subcommand="${1:-}"
  case "$subcommand" in
    verify)
      shift
      compose exec -T server xdrive-server media verify "$@"
      ;;
    repair)
      shift
      local dry_run=0 status arg
      for arg in "$@"; do
        [[ "$arg" == "--dry-run" ]] && dry_run=1
      done
      if compose exec -T server xdrive-server media repair "$@"; then status=0; else status=$?; fi
      if [[ "$dry_run" != "1" ]]; then
        if [[ "$status" -eq 0 ]]; then
          record_system_audit system.media_repair success
        else
          record_system_audit system.media_repair failure
        fi
      fi
      return "$status"
      ;;
    *)
      echo "usage: xdrive-server media <verify|repair> [options]" >&2
      return 2
      ;;
  esac
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
      remove_user_command_path
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

  if [[ -x "$BIN_DIR/server-control.sh" ]]; then
    XD_CONFIG_DIR="$XDRIVE_HOME" "$BIN_DIR/server-control.sh" stop || true
    XD_CONFIG_DIR="$XDRIVE_HOME" "$BIN_DIR/server-control.sh" remove-schedule || true
  fi

  if [[ -f "$ENV_PATH" && -f "$COMPOSE_PATH" ]]; then
    echo "[xDrive] stopping and removing xDrive containers and network..."
    compose down --remove-orphans
  else
    echo "[xDrive] no active Compose deployment found; cleaning host control files only."
  fi

  remove_backup_schedule

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
    remove_user_command_path
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
  if ! compose exec -T server xdrive-server version 2>/dev/null; then
    channel="$(env_value XD_RELEASE_CHANNEL)"
    commit="$(env_value XD_RELEASE_COMMIT)"
    printf 'server version: unavailable\n'
    printf 'channel: %s\n' "${channel:-unknown}"
    [[ -n "$commit" ]] && printf 'commit: %s\n' "$commit"
  fi
  image="$(env_value XD_SERVER_IMAGE)"
  [[ -n "$image" ]] && printf 'server image: %s\n' "$image"
}

cmd="${1:-}"
[[ -n "$cmd" ]] || { usage >&2; exit 2; }
shift || true

case "$cmd" in
  update) update_cmd "$@" ;;
  control) control_cmd "$@" ;;
  doctor) doctor_cmd "$@" ;;
  status) status_cmd "$@" ;;
  backup) backup_cmd "$@" ;;
  restore) restore_cmd "$@" ;;
  verify) verify_cmd "$@" ;;
  source) source_cmd "$@" ;;
  media) media_cmd "$@" ;;
  migrate-user) migrate_user_cmd "$@" ;;
  cleanup) cleanup_cmd "$@" ;;
  uninstall) uninstall_cmd "$@" ;;
  admin) admin_cmd "$@" ;;
  version) version_cmd ;;
  -h|--help|help) usage ;;
  *) echo "xdrive-server: unknown command: $cmd" >&2; usage >&2; exit 2 ;;
esac
