#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

XDRIVE_HOME="${XD_CONFIG_DIR:-$HOME/.xd}"
CONFIG_DIR="$XDRIVE_HOME/config"
BIN_DIR="$XDRIVE_HOME/bin"
DATA_DIR="$XDRIVE_HOME/data"
BACKUP_ROOT="$XDRIVE_HOME/backups"
SNAPSHOT_BACKUP_DIR="$BACKUP_ROOT/snapshots"
PRE_UPGRADE_BACKUP_DIR="$BACKUP_ROOT/pre-upgrade"
PRE_RESTORE_BACKUP_DIR="$BACKUP_ROOT/pre-restore"
LOG_DIR="$XDRIVE_HOME/logs"
STATE_DIR="$XDRIVE_HOME/state"
COMPOSE_PATH="$CONFIG_DIR/docker-compose.yml"
CADDY_PATH="$CONFIG_DIR/Caddyfile"
ENV_PATH="$CONFIG_DIR/.env"
LEGACY_ENV_PATH="$XDRIVE_HOME/.env"
LEGACY_COMPOSE_PATH="$XDRIVE_HOME/docker-compose.yml"
LEGACY_CADDY_PATH="$XDRIVE_HOME/Caddyfile"
SOURCE_REF="${XD_SOURCE_REF:-@SOURCE_REF@}"
IMAGE_TAG="${XD_IMAGE_TAG:-@IMAGE_TAG@}"
BUILT_CHANNEL="${XD_BUILT_CHANNEL:-@RELEASE_CHANNEL@}"
BUILT_COMMIT="${XD_BUILT_COMMIT:-@RELEASE_COMMIT@}"
BUILT_SOURCE="${XD_BUILT_SOURCE:-@UPDATE_SOURCE@}"
REPOSITORY="${XD_GITHUB_REPOSITORY:-lazyxu/xdrive}"
GITLAB_BASE_URL="${XD_GITLAB_BASE_URL:-http://gitlab.t-fluid.com:1080}"
GITLAB_PROJECT="${XD_GITLAB_PROJECT:-xuliang/xdrive}"
IMAGE_REGISTRY="${XD_IMAGE_REGISTRY:-@IMAGE_REGISTRY@}"
STAGING_DIR="$STATE_DIR/install-staging"
UPGRADE_STATE_DIR="$STATE_DIR/upgrade-transaction"
INSTALL_LOCK_PATH="$STATE_DIR/install.lock"
PULL_LOG="$LOG_DIR/install-pull.log"
HOST_MANAGER_PATH="$BIN_DIR/xdrive-server"
SHELL_RC_PATH=""

is_template_placeholder() {
  [[ "$1" =~ ^@[A-Z_]+@$ ]]
}

STAGE_TOTAL=9
STAGE_NO=0
CURRENT_STAGE="startup"
LAST_ERROR_COMMAND=""
ROLLBACK_ARMED=0
ROLLBACK_RUNNING=0
UPGRADE_EXISTING=0
DATABASE_ROLLBACK_REQUIRED=0
PRE_UPGRADE_BACKUP=""
PULL_MONITOR_PID=""
DOCKER_MODE=""
SERVER_UID=65532
SERVER_GID=65532
LEGACY_VOLUME_MIGRATION=0
LEGACY_FILES_VOLUME=""
LEGACY_POSTGRES_VOLUME=""
LEGACY_CADDY_DATA_VOLUME=""
LEGACY_CADDY_CONFIG_VOLUME=""

stage() {
  STAGE_NO="$1"
  CURRENT_STAGE="$2"
  printf '\n[xDrive] [%s/%s] %s\n' "$STAGE_NO" "$STAGE_TOTAL" "$CURRENT_STAGE"
}

stop_pull_monitor() {
  if [[ -n "${PULL_MONITOR_PID:-}" ]]; then
    kill "$PULL_MONITOR_PID" >/dev/null 2>&1 || true
    wait "$PULL_MONITOR_PID" 2>/dev/null || true
    PULL_MONITOR_PID=""
  fi
}

trap 'LAST_ERROR_COMMAND="${BASH_COMMAND:-unknown}"' ERR
on_exit() {
  local status=$?
  local final_status="$status"
  local rollback_status=0
  stop_pull_monitor

  if [[ "$ROLLBACK_ARMED" == "1" && "$ROLLBACK_RUNNING" != "1" ]]; then
    trap - EXIT ERR INT TERM
    set +e
    if [[ "$status" -eq 0 ]]; then
      printf '\n[xDrive] UPGRADE INCOMPLETE at stage %s/%s: transaction exited before commit; forcing rollback.\n' \
        "$STAGE_NO" "$STAGE_TOTAL" "$CURRENT_STAGE" >&2
      final_status=70
    else
      printf '\n[xDrive] UPGRADE FAILED at stage %s/%s: %s (exit %s)\n' \
        "$STAGE_NO" "$STAGE_TOTAL" "$CURRENT_STAGE" "$status" >&2
    fi

    ROLLBACK_ARMED=0
    rollback_upgrade
    rollback_status=$?
    if [[ "$rollback_status" -eq 0 ]]; then
      echo "[xDrive] UPGRADE FAILED -> ROLLBACK SUCCESS" >&2
    else
      echo "[xDrive] ROLLBACK FAILED" >&2
      echo "[xDrive] rollback state preserved at: $UPGRADE_STATE_DIR" >&2
      final_status=71
    fi
    exit "$final_status"
  fi

  if [[ "$status" -ne 0 ]]; then
    if [[ "$UPGRADE_EXISTING" == "1" ]]; then
      printf '\n[xDrive] UPGRADE FAILED at stage %s/%s: %s (exit %s)\n' \
        "$STAGE_NO" "$STAGE_TOTAL" "$CURRENT_STAGE" "$status" >&2
    else
      printf '\n[xDrive] FAILED at stage %s/%s: %s (exit %s)\n' \
        "$STAGE_NO" "$STAGE_TOTAL" "$CURRENT_STAGE" "$status" >&2
    fi
  fi
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

prepare_host_layout() {
  mkdir -p \
    "$XDRIVE_HOME" "$CONFIG_DIR" "$BIN_DIR" "$DATA_DIR" \
    "$SNAPSHOT_BACKUP_DIR" "$PRE_UPGRADE_BACKUP_DIR" "$PRE_RESTORE_BACKUP_DIR" \
    "$LOG_DIR" "$STATE_DIR"
  chmod 700 "$XDRIVE_HOME" "$CONFIG_DIR" "$BIN_DIR" "$DATA_DIR" "$BACKUP_ROOT" \
    "$SNAPSHOT_BACKUP_DIR" "$PRE_UPGRADE_BACKUP_DIR" "$PRE_RESTORE_BACKUP_DIR" \
    "$LOG_DIR" "$STATE_DIR"

  if [[ ! -f "$ENV_PATH" && -f "$LEGACY_ENV_PATH" ]]; then
    cp -p "$LEGACY_ENV_PATH" "$ENV_PATH"
    chmod 600 "$ENV_PATH"
  fi
  if [[ ! -f "$COMPOSE_PATH" && -f "$LEGACY_COMPOSE_PATH" ]]; then
    cp -p "$LEGACY_COMPOSE_PATH" "$COMPOSE_PATH"
    chmod 600 "$COMPOSE_PATH"
  fi
  if [[ ! -f "$CADDY_PATH" && -f "$LEGACY_CADDY_PATH" ]]; then
    cp -p "$LEGACY_CADDY_PATH" "$CADDY_PATH"
    chmod 600 "$CADDY_PATH"
  fi
  for legacy_tool in xdrive-server server-backup.sh server-backup-scheduled.sh server-restore.sh server-verify.sh server-doctor.sh server-migrate-user.sh; do
    if [[ ! -f "$BIN_DIR/$legacy_tool" && -f "$XDRIVE_HOME/$legacy_tool" ]]; then
      cp -p "$XDRIVE_HOME/$legacy_tool" "$BIN_DIR/$legacy_tool"
      chmod 700 "$BIN_DIR/$legacy_tool"
    fi
  done
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

escape_double_quoted_shell_value() {
  printf '%s' "$1" | sed 's/[\\$"`]/\\&/g'
}

configure_user_command_path() {
  local rc tmp escaped begin end
  rc="$(detect_shell_rc)"
  begin="# >>> xDrive server PATH >>>"
  end="# <<< xDrive server PATH <<<"
  mkdir -p "$(dirname "$rc")"
  touch "$rc"
  tmp="$(mktemp "${TMPDIR:-/tmp}/xdrive-shell-rc.XXXXXX")"
  awk -v begin="$begin" -v end="$end" '
    $0 == begin { skip=1; next }
    $0 == end { skip=0; next }
    !skip { print }
  ' "$rc" > "$tmp"
  escaped="$(escape_double_quoted_shell_value "$BIN_DIR")"
  {
    printf '\n%s\n' "$begin"
    printf 'export PATH="%s:$PATH"\n' "$escaped"
    printf '%s\n' "$end"
  } >> "$tmp"
  cat "$tmp" > "$rc"
  rm -f "$tmp"
  SHELL_RC_PATH="$rc"

  case ":${PATH:-}:" in
    *":$BIN_DIR:"*) ;;
    *) export PATH="$BIN_DIR:${PATH:-}" ;;
  esac
}

remove_legacy_system_manager_link() {
  local legacy="/usr/local/bin/xdrive-server" target=""
  [[ -L "$legacy" ]] || return 0
  target="$(readlink -f "$legacy" 2>/dev/null || true)"
  [[ "$target" == "$HOST_MANAGER_PATH" ]] || return 0
  if [[ -w "$(dirname "$legacy")" ]]; then
    rm -f "$legacy"
    echo "[xDrive] removed legacy system-wide command link: $legacy"
  else
    echo "[xDrive] legacy system-wide command link remains at $legacy; it is no longer used." >&2
    echo "[xDrive] remove it later with an account that can write /usr/local/bin: rm -f '$legacy'" >&2
  fi
}

acquire_install_lock() {
  prepare_host_layout
  command -v flock >/dev/null 2>&1 || {
    echo "xDrive server installer: flock is required for transactional install/update locking." >&2
    exit 1
  }
  exec 9>"$INSTALL_LOCK_PATH"
  if ! flock -n 9; then
    echo "xDrive server installer: another install/update is already running for $XDRIVE_HOME." >&2
    exit 75
  fi
  printf '%s\n' "$$" 1>&9
}

usage() {
  cat <<'USAGE'
xDrive server installer

Usage:
  install-server.sh [--source github|gitlab] [--channel stable|master]

Channels:
  stable  Latest successful vMAJOR.MINOR.PATCH release.
  master  Latest fully successful rolling master snapshot.

The selected source and channel are persisted in ~/.xd/config/.env and reused on later updates.
USAGE
}

requested_source="${XD_INSTALL_SOURCE:-}"
requested_channel="${XD_INSTALL_CHANNEL:-}"
requested_commit=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)
      [[ $# -ge 2 ]] || { echo "--source requires github or gitlab" >&2; exit 2; }
      requested_source="$2"; shift 2 ;;
    --channel)
      [[ $# -ge 2 ]] || { echo "--channel requires a value" >&2; exit 2; }
      requested_channel="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2 ;;
  esac
done

acquire_install_lock

existing_env_value() {
  local key="$1"
  [[ -f "$ENV_PATH" ]] || return 0
  grep "^$key=" "$ENV_PATH" 2>/dev/null | tail -n1 | cut -d= -f2- || true
}

if [[ -z "$requested_source" ]]; then
  requested_source="$(existing_env_value XD_UPDATE_SOURCE)"
fi
if [[ -z "$requested_source" ]]; then
  if [[ -n "$BUILT_SOURCE" ]] && ! is_template_placeholder "$BUILT_SOURCE"; then
    requested_source="$BUILT_SOURCE"
  else
    requested_source="github"
  fi
fi
requested_source="$(printf '%s' "$requested_source" | tr '[:upper:]' '[:lower:]')"
case "$requested_source" in
  github|gitlab) ;;
  *) echo "invalid update source: $requested_source (expected github or gitlab)" >&2; exit 2 ;;
esac

if [[ -z "$requested_channel" ]]; then
  requested_channel="$(existing_env_value XD_RELEASE_CHANNEL)"
fi
if [[ -z "$requested_channel" ]]; then
  legacy_image="$(existing_env_value XD_SERVER_IMAGE)"
  case "$legacy_image" in
    *:edge|*:sha-*) requested_channel="master" ;;
    *:v[0-9]*|*:latest) requested_channel="stable" ;;
  esac
fi
if [[ -z "$requested_channel" ]]; then
  if [[ -n "$BUILT_CHANNEL" ]] && ! is_template_placeholder "$BUILT_CHANNEL"; then
    requested_channel="$BUILT_CHANNEL"
  else
    # The raw master bootstrap is a template, not a stable release artifact.
    # Follow the latest fully successful published master snapshot so the
    # canonical one-line install works before the first vMAJOR.MINOR.PATCH.
    requested_channel="master"
  fi
fi
requested_channel="$(printf '%s' "$requested_channel" | tr '[:upper:]' '[:lower:]')"
case "$requested_channel" in
  stable|master) ;;
  snapshot) requested_channel="master" ;;
  *) echo "invalid channel: $requested_channel (expected stable or master)" >&2; exit 2 ;;
esac

format_bytes() {
  awk -v bytes="${1:-0}" 'BEGIN {
    split("B KiB MiB GiB TiB", unit, " ");
    n = bytes + 0; i = 1;
    while (n >= 1024 && i < 5) { n /= 1024; i++ }
    if (i == 1) printf "%.0f %s", n, unit[i]; else printf "%.1f %s", n, unit[i]
  }'
}

host_rx_bytes() {
  [[ -r /proc/net/dev ]] || return 1
  awk 'NR > 2 {
    iface=$1; gsub(":", "", iface);
    if (iface != "lo") total += $2
  } END { printf "%.0f\n", total + 0 }' /proc/net/dev
}

monitor_host_rx() {
  local label="$1" interval="${2:-2}" start prev now current delta elapsed
  [[ -t 2 ]] || return 0
  prev="$(host_rx_bytes 2>/dev/null || true)"
  [[ -n "$prev" ]] || return 0
  start="$(date +%s)"
  while true; do
    sleep "$interval"
    current="$(host_rx_bytes 2>/dev/null || true)"
    [[ -n "$current" ]] || return 0
    now="$(date +%s)"
    delta=$(( current - prev ))
    (( delta < 0 )) && delta=0
    elapsed=$(( now - start ))
    printf '[xDrive] %s | current host RX: %s/s | elapsed: %ss\n' \
      "$label" "$(format_bytes $(( delta / interval )))" "$elapsed" >&2
    prev="$current"
  done
}

pull_process_running() {
  local pid_file="$1" pid=""
  [[ -s "$pid_file" ]] || return 1
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

terminate_pull_process() {
  local pid_file="$1" pid=""
  [[ -s "$pid_file" ]] || return 0
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    sleep 1
  fi
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
}

render_pull_json() {
  local service="$1" pid_file="$2" line id text current total
  local now sum_current sum_total rate pct elapsed started
  local last_print=0 previous_time previous_current=0
  local last_progress_at last_progress_current=0 last_stall_print=0 stalled_for
  declare -A layer_current=()
  declare -A layer_total=()

  started="$(date +%s)"
  previous_time="$started"
  last_progress_at="$started"

  while true; do
    line=""
    if ! IFS= read -r -t 1 line; then
      now="$(date +%s)"
      stalled_for=$(( now - last_progress_at ))
      if pull_process_running "$pid_file"; then
        if (( stalled_for >= pull_stall_timeout )); then
          echo "[xDrive] pull $service stalled: no download progress for ${stalled_for}s; terminating this Docker pull so it can retry." >&2
          terminate_pull_process "$pid_file"
          return 75
        fi
        if (( stalled_for >= pull_stall_log_interval && now - last_stall_print >= pull_stall_log_interval )); then
          echo "[xDrive] pull $service waiting: no byte progress for ${stalled_for}s; retry threshold ${pull_stall_timeout}s." >&2
          last_stall_print="$now"
        fi
        continue
      fi
      break
    fi

    id="$(printf '%s\n' "$line" | sed -n 's/.*"id":[[:space:]]*"\([^"]*\)".*/\1/p')"
    text="$(printf '%s\n' "$line" | sed -n 's/.*"text":[[:space:]]*"\([^"]*\)".*/\1/p')"
    current="$(printf '%s\n' "$line" | sed -n 's/.*"current":[[:space:]]*\([0-9][0-9]*\).*/\1/p')"
    total="$(printf '%s\n' "$line" | sed -n 's/.*"total":[[:space:]]*\([0-9][0-9]*\).*/\1/p')"

    [[ -n "$id" ]] || continue
    case "$text" in
      Downloading)
        if [[ -n "$total" && "$total" -gt 0 ]]; then
          layer_total["$id"]="$total"
          layer_current["$id"]="${current:-0}"
        fi
        ;;
      "Download complete"|"Pull complete"|"Already exists")
        if [[ -n "${layer_total[$id]:-}" ]]; then
          layer_current["$id"]="${layer_total[$id]}"
        fi
        ;;
      *) continue ;;
    esac

    sum_current=0
    sum_total=0
    for id in "${!layer_total[@]}"; do
      sum_total=$(( sum_total + layer_total[$id] ))
      sum_current=$(( sum_current + ${layer_current[$id]:-0} ))
    done
    (( sum_total > 0 )) || continue

    now="$(date +%s)"
    if (( sum_current > last_progress_current )); then
      last_progress_current="$sum_current"
      last_progress_at="$now"
      last_stall_print=0
    fi
    stalled_for=$(( now - last_progress_at ))

    if (( stalled_for >= pull_stall_timeout && sum_current < sum_total )); then
      echo "[xDrive] pull $service stalled at $(format_bytes "$sum_current") / $(format_bytes "$sum_total"): no byte progress for ${stalled_for}s; terminating this Docker pull so it can retry." >&2
      terminate_pull_process "$pid_file"
      return 75
    fi

    if (( sum_current == previous_current && sum_current < sum_total )); then
      if (( stalled_for < pull_stall_log_interval || now - last_stall_print < pull_stall_log_interval )); then
        continue
      fi
      elapsed=$(( now - started ))
      pct=$(( sum_current * 100 / sum_total ))
      printf '[xDrive] pull %-8s | %s / %s (%d%%) | stalled %ss | elapsed %ss\n' \
        "$service" "$(format_bytes "$sum_current")" "$(format_bytes "$sum_total")" "$pct" "$stalled_for" "$elapsed"
      last_stall_print="$now"
      last_print="$now"
      previous_time="$now"
      continue
    fi

    if (( now - last_print < 2 && sum_current < sum_total )); then
      continue
    fi
    pct=$(( sum_current * 100 / sum_total ))
    elapsed=$(( now - started ))
    rate=0
    if (( now > previous_time && sum_current >= previous_current )); then
      rate=$(( (sum_current - previous_current) / (now - previous_time) ))
    fi
    printf '[xDrive] pull %-8s | %s / %s (%d%%) | %s/s | elapsed %ss\n' \
      "$service" "$(format_bytes "$sum_current")" "$(format_bytes "$sum_total")" "$pct" "$(format_bytes "$rate")" "$elapsed"
    last_print="$now"
    previous_time="$now"
    previous_current="$sum_current"
  done
}

pull_json_supported() {
  compose --progress json version </dev/null >/dev/null 2>&1
}

pull_service_json() {
  local service="$1" statuses pid_file
  pid_file="$LOG_DIR/.pull-${service}-pid"
  rm -f "$pid_file"

  (
    printf '%s\n' "$BASHPID" > "$pid_file"
    if [[ -n "$(env_value XD_DOMAIN)" ]]; then
      exec docker compose --profile https --env-file "$ENV_PATH" -f "$COMPOSE_PATH" --progress json pull "$service" </dev/null
    else
      exec docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" --progress json pull "$service" </dev/null
    fi
  ) 2>&1 |
    tee -a "$PULL_LOG" |
    render_pull_json "$service" "$pid_file"

  statuses=("${PIPESTATUS[@]}")
  rm -f "$pid_file"
  if [[ "${statuses[2]:-0}" -ne 0 ]]; then
    return "${statuses[2]}"
  fi
  return "${statuses[0]}"
}

pull_service_plain() {
  local service="$1" rc
  monitor_host_rx "container pull $service" 5 &
  PULL_MONITOR_PID=$!
  if compose --progress plain pull "$service" >>"$PULL_LOG" 2>&1; then
    rc=0
  else
    rc=$?
  fi
  stop_pull_monitor
  return "$rc"
}

pull_service_with_retry() {
  local service="$1" attempt retry_wait pull_rc
  for attempt in $(seq 1 "$pull_attempts"); do
    printf '[xDrive] pull %s attempt %s/%s...\n' "$service" "$attempt" "$pull_attempts"
    printf '\n===== pull %s attempt %s/%s at %s =====\n' \
      "$service" "$attempt" "$pull_attempts" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$PULL_LOG"

    if [[ "$pull_progress_mode" == "json" ]]; then
      if pull_service_json "$service"; then
        printf '[xDrive] pull %s complete.\n' "$service"
        return 0
      else
        pull_rc=$?
        if [[ "$pull_rc" -eq 75 ]]; then
          echo "[xDrive] pull $service attempt $attempt stalled; retry will reuse completed Docker layers." >&2
        fi
      fi
    else
      if pull_service_plain "$service"; then
        printf '[xDrive] pull %s complete.\n' "$service"
        return 0
      fi
    fi

    if (( attempt < pull_attempts )); then
      retry_wait=$(( pull_retry_delay * attempt ))
      echo "[xDrive] pull $service failed; retrying in ${retry_wait}s (completed layers are reused)." >&2
      sleep "$retry_wait"
    fi
  done

  echo "xDrive server installer: pull $service failed after $pull_attempts attempts. Last Docker pull messages:" >&2
  tail -n 40 "$PULL_LOG" >&2 || true
  echo "xDrive server installer: repeated registry failures usually mean Docker daemon connectivity is poor." >&2
  echo "Shell HTTPS_PROXY may not affect Docker pulls; configure the Docker daemon proxy or set XD_IMAGE_REGISTRY to an alternate registry mirror." >&2
  return 1
}
fetch() {
  local url="$1" destination="$2" label="${3:-$(basename "$2")}" tmp="$2.tmp"
  local stats size speed seconds monitor_pid=""
  rm -f "$tmp"
  printf '[xDrive] download: %s\n' "$label"
  if command -v curl >/dev/null 2>&1; then
    monitor_host_rx "download $label" &
    monitor_pid=$!
    if ! stats="$(curl -fsSL --retry 5 --retry-delay 2 --connect-timeout 10 \
      --write-out '%{size_download}\t%{speed_download}\t%{time_total}' \
      "$url" -o "$tmp" </dev/null)"; then
      [[ -n "$monitor_pid" ]] && kill "$monitor_pid" >/dev/null 2>&1 || true
      [[ -n "$monitor_pid" ]] && wait "$monitor_pid" 2>/dev/null || true
      rm -f "$tmp"
      return 1
    fi
    [[ -n "$monitor_pid" ]] && kill "$monitor_pid" >/dev/null 2>&1 || true
    [[ -n "$monitor_pid" ]] && wait "$monitor_pid" 2>/dev/null || true
    IFS=$'\t' read -r size speed seconds <<< "$stats"
    if [[ -n "${size:-}" && -n "${speed:-}" && -n "${seconds:-}" ]]; then
      printf '[xDrive] downloaded: %s | %s | avg %s/s | %ss\n'         "$label" "$(format_bytes "$size")" "$(format_bytes "$speed")" "$seconds"
    else
      printf '[xDrive] downloaded: %s\n' "$label"
    fi
  elif command -v wget >/dev/null 2>&1; then
    if ! wget --progress=bar:force:noscroll -O "$tmp" "$url" </dev/null; then
      rm -f "$tmp"
      return 1
    fi
    printf '[xDrive] downloaded: %s\n' "$label"
  else
    echo "xDrive server installer: curl or wget is required." >&2
    return 1
  fi
  mv "$tmp" "$destination"
}

fetch_stdout() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 5 --retry-delay 2 --connect-timeout 10 "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -q --tries=5 --timeout=15 -O- "$url"
  else
    echo "xDrive server installer: curl or wget is required." >&2
    exit 1
  fi
}

gitlab_project_key() {
  local project="${GITLAB_PROJECT#/}"
  printf '%s\n' "${project//\//%2F}"
}

gitlab_api_base() {
  printf '%s/api/v4/projects/%s\n' "${GITLAB_BASE_URL%/}" "$(gitlab_project_key)"
}

resolve_gitlab_ref_commit() {
  local ref="$1" json full
  [[ -n "$ref" ]] || {
    echo "xDrive server installer: GitLab ref is required." >&2
    return 1
  }
  if ! json="$(fetch_stdout "$(gitlab_api_base)/repository/commits/$ref")"; then
    echo "xDrive server installer: could not resolve GitLab ref $ref." >&2
    return 1
  fi
  full="$(printf '%s\n' "$json" | grep -oE '"id"[[:space:]]*:[[:space:]]*"[0-9a-fA-F]{40}"' | head -n1 | grep -oE '[0-9a-fA-F]{40}' | tr '[:upper:]' '[:lower:]' || true)"
  [[ ${#full} -eq 40 ]] || {
    echo "xDrive server installer: GitLab ref $ref did not resolve to a full commit SHA." >&2
    return 1
  }
  printf '%s\n' "$full"
}

gitlab_release_tags() {
  local json
  if ! json="$(fetch_stdout "$(gitlab_api_base)/releases?per_page=100&order_by=released_at&sort=desc")"; then
    echo "xDrive server installer: could not query GitLab releases." >&2
    return 1
  fi
  printf '%s\n' "$json" | grep -oE '"tag_name"[[:space:]]*:[[:space:]]*"[^"]+"' | sed -E 's/^.*"([^"]+)"$/\1/' || true
}

resolve_gitlab_latest_stable_tag() {
  local tag
  tag="$(gitlab_release_tags | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+([+-].*)?$' | sort -V | tail -n1)"
  [[ -n "$tag" ]] || {
    echo "xDrive server installer: no stable GitLab release is available." >&2
    return 1
  }
  printf '%s\n' "$tag"
}

verify_gitlab_release() {
  local tag="$1"
  fetch_stdout "$(gitlab_api_base)/releases/$tag" >/dev/null
}

resolve_gitlab_registry() {
  local json registry
  if ! json="$(fetch_stdout "$(gitlab_api_base)")"; then
    echo "xDrive server installer: could not query GitLab project metadata for the Container Registry." >&2
    return 1
  fi
  registry="$(printf '%s\n' "$json" | grep -oE '"container_registry_image_prefix"[[:space:]]*:[[:space:]]*"[^"]+"' | head -n1 | sed -E 's/^.*"([^"]+)"$/\1/' || true)"
  [[ -n "$registry" && "$registry" != "null" ]] || {
    echo "xDrive server installer: GitLab did not report container_registry_image_prefix; set XD_IMAGE_REGISTRY explicitly." >&2
    return 1
  }
  printf '%s\n' "$registry"
}

resolve_published_master() {
  local json full
  if ! json="$(fetch_stdout "https://api.github.com/repos/$REPOSITORY/git/ref/tags/snapshot")"; then
    echo "xDrive server installer: could not resolve the rolling master snapshot." >&2
    return 1
  fi
  full="$(printf '%s\n' "$json" | sed -nE 's/^[[:space:]]*"sha":[[:space:]]*"([0-9a-fA-F]{40})".*/\1/p' | head -n1 | tr '[:upper:]' '[:lower:]')"
  [[ ${#full} -eq 40 ]] || {
    echo "xDrive server installer: rolling snapshot did not resolve to a commit." >&2
    return 1
  }
  if ! fetch_stdout "https://api.github.com/repos/$REPOSITORY/releases/tags/snapshot" >/dev/null; then
    echo "xDrive server installer: rolling snapshot release is not fully published yet; retry after the master build completes." >&2
    return 1
  fi
  printf '%s\n' "$full"
}

resolve_latest_stable_tag() {
  local json tag
  if [[ "$requested_source" == "gitlab" ]]; then
    resolve_gitlab_latest_stable_tag
    return
  fi
  if ! json="$(fetch_stdout "https://api.github.com/repos/$REPOSITORY/releases/latest")"; then
    echo "xDrive server installer: no stable release is available." >&2
    return 1
  fi
  tag="$(printf '%s\n' "$json" | sed -nE 's/^[[:space:]]*"tag_name":[[:space:]]*"([^"]+)".*/\1/p' | head -n1)"
  [[ -n "$tag" ]] || {
    echo "xDrive server installer: latest stable release has no tag." >&2
    return 1
  }
  printf '%s\n' "$tag"
}

resolve_install_source() {
  local channel="$1" full tag
  case "$channel" in
    master)
      if [[ "$requested_source" == "gitlab" ]]; then
        verify_gitlab_release snapshot || {
          echo "xDrive server installer: rolling GitLab snapshot is not fully published yet." >&2
          return 1
        }
        full="$(resolve_gitlab_ref_commit snapshot)"
        SOURCE_REF="$full"
        IMAGE_TAG="sha-${full:0:12}"
        BUILT_CHANNEL="master"
        BUILT_COMMIT="$full"
        requested_commit="$full"
        echo "Resolved latest fully published GitLab master snapshot: ${full:0:12}"
      else
        full="$(resolve_published_master)"
        SOURCE_REF="$full"
        IMAGE_TAG="sha-${full:0:12}"
        BUILT_CHANNEL="master"
        BUILT_COMMIT="$full"
        requested_commit="$full"
        echo "Resolved latest fully published master snapshot: ${full:0:12}"
      fi
      ;;
    stable)
      tag="$(resolve_latest_stable_tag)"
      SOURCE_REF="$tag"
      IMAGE_TAG="$tag"
      BUILT_CHANNEL="stable"
      BUILT_COMMIT=""
      requested_commit=""
      echo "Resolved stable release: $tag"
      ;;
  esac
}

artifact_is_template=false
if is_template_placeholder "$SOURCE_REF" || is_template_placeholder "$IMAGE_TAG" || is_template_placeholder "$BUILT_SOURCE"; then
  artifact_is_template=true
fi

stage 1 "resolve release channel"
needs_source_resolution=false
if [[ "$artifact_is_template" == "true" || "$requested_channel" != "$BUILT_CHANNEL" || "$requested_source" != "$BUILT_SOURCE" ]]; then
  needs_source_resolution=true
fi

if [[ "$needs_source_resolution" == "true" ]]; then
  resolve_install_source "$requested_channel"
else
  if [[ "$requested_channel" == "master" && -z "$requested_commit" && -n "$BUILT_COMMIT" ]] && ! is_template_placeholder "$BUILT_COMMIT"; then
    requested_commit="$BUILT_COMMIT"
  fi
  echo "Using packaged release source: $SOURCE_REF"
fi

if is_template_placeholder "$SOURCE_REF" || is_template_placeholder "$IMAGE_TAG"; then
  echo "xDrive server installer: release source resolution left template placeholders unresolved." >&2
  exit 1
fi
echo "Update source: $requested_source"
echo "Release source: $SOURCE_REF"
echo "Container image tag: $IMAGE_TAG"
need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "xDrive server installer: missing required command: $1" >&2
    exit 1
  }
}

interactive_tty_available() {
  [[ "${XD_NONINTERACTIVE:-0}" != "1" ]] || return 1
  [[ -r /dev/tty && -w /dev/tty ]] || return 1
  ( exec 3<>/dev/tty ) 2>/dev/null
}

stage 2 "validate host prerequisites"
case "$(uname -m)" in
  x86_64|amd64) ;;
  *) echo "xDrive server installer: current published images support Linux amd64 only." >&2; exit 1 ;;
esac

need docker
if ! docker info </dev/null >/dev/null 2>&1; then
  echo "xDrive server installer: the current user cannot access the Docker daemon." >&2
  echo "Use Docker Rootless Mode or grant this user Docker access; the installer does not invoke sudo." >&2
  exit 1
fi
docker_security_options="$(docker info --format '{{json .SecurityOptions}}' </dev/null 2>/dev/null || true)"
if printf '%s' "$docker_security_options" | grep -qi rootless; then
  DOCKER_MODE="rootless"
else
  DOCKER_MODE="rootful"
fi
echo "Docker mode: $DOCKER_MODE (installer uid=$(id -u), server uid=$SERVER_UID gid=$SERVER_GID)"
if ! docker compose version </dev/null >/dev/null 2>&1; then
  echo "xDrive server installer: Docker Compose v2 is required (docker compose)." >&2
  exit 1
fi

stage 3 "download deployment assets"
mkdir -p "$CONFIG_DIR" "$STAGING_DIR"
chmod 700 "$CONFIG_DIR" "$STAGING_DIR"
if [[ "$requested_source" == "gitlab" ]]; then
  raw_base="${GITLAB_BASE_URL%/}/${GITLAB_PROJECT#/}/-/raw/$SOURCE_REF"
else
  raw_base="https://raw.githubusercontent.com/$REPOSITORY/$SOURCE_REF"
fi
fetch "$raw_base/deploy/docker-compose.yml" "$STAGING_DIR/docker-compose.yml" "1/8 docker-compose.yml"
asset_no=1
for maintenance_script in server-backup.sh server-backup-scheduled.sh server-restore.sh server-verify.sh server-doctor.sh server-migrate-user.sh; do
  asset_no=$((asset_no + 1))
  fetch "$raw_base/scripts/$maintenance_script" "$STAGING_DIR/$maintenance_script" "$asset_no/8 $maintenance_script"
  chmod 700 "$STAGING_DIR/$maintenance_script"
done
asset_no=$((asset_no + 1))
fetch "$raw_base/scripts/xdrive-server-host.sh" "$STAGING_DIR/xdrive-server" "$asset_no/8 xdrive-server"
chmod 700 "$STAGING_DIR/xdrive-server"
chmod 600 "$STAGING_DIR/docker-compose.yml"

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

unset_env() {
  local key="$1" tmp="$ENV_PATH.tmp"
  [[ -f "$ENV_PATH" ]] || return 0
  awk -v k="$key" 'BEGIN{FS="="} $1!=k{print}' "$ENV_PATH" > "$tmp"
  mv "$tmp" "$ENV_PATH"
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

configure_data_path() {
  local key="$1" default_path="$2" value
  value="$(printenv "$key" 2>/dev/null || true)"
  [[ -n "$value" ]] || value="$(env_value "$key")"
  [[ -n "$value" ]] || value="$default_path"
  case "$value" in
    /*) ;;
    *) echo "xDrive server installer: $key must be an absolute host path; got $value" >&2; return 1 ;;
  esac
  mkdir -p "$value"
  set_env "$key" "$value"
}

rootless_low_port_allowed() {
  local port="$1" limit rootlesskit_path caps
  limit="$(sysctl -n net.ipv4.ip_unprivileged_port_start 2>/dev/null || echo 1024)"
  if [[ "$limit" =~ ^[0-9]+$ ]] && (( port >= limit )); then
    return 0
  fi
  rootlesskit_path="$(command -v rootlesskit 2>/dev/null || true)"
  if [[ -n "$rootlesskit_path" ]] && command -v getcap >/dev/null 2>&1; then
    caps="$(getcap "$rootlesskit_path" 2>/dev/null || true)"
    [[ "$caps" == *cap_net_bind_service* ]] && return 0
  fi
  return 1
}

validate_rootless_port() {
  local name="$1" port="$2"
  [[ "$DOCKER_MODE" == "rootless" ]] || return 0
  if (( port < 1024 )) && ! rootless_low_port_allowed "$port"; then
    echo "xDrive server installer: Rootless Docker cannot bind $name port $port with the current host policy." >&2
    echo "Use an unprivileged port (recommended: Web 3000, HTTPS 8443) or explicitly enable low-port binding for RootlessKit." >&2
    return 1
  fi
}

managed_container_id() {
  local service="$1" conventional legacy id
  conventional="xdrive-${service}"
  legacy="xdrive-${service}-1"

  # Current deployments use explicit stable container names.
  if docker inspect "$conventional" </dev/null >/dev/null 2>&1; then
    printf '%s\n' "$conventional"
    return 0
  fi

  # Upgrades from the historical Compose naming scheme still use -1.
  if docker inspect "$legacy" </dev/null >/dev/null 2>&1; then
    printf '%s\n' "$legacy"
    return 0
  fi

  # Fall back to Compose discovery when neither conventional name is available.
  if [[ -f "$COMPOSE_PATH" ]]; then
    id="$(docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" ps -aq "$service" </dev/null 2>/dev/null | head -n1 || true)"
    if [[ -n "$id" ]]; then
      printf '%s\n' "$id"
      return 0
    fi
  fi

  docker ps -aq \
    --filter "label=com.docker.compose.project=xdrive" \
    --filter "label=com.docker.compose.service=$service" </dev/null 2>/dev/null | head -n1
}

container_env_value() {
  local container_id="$1" key="$2"
  [[ -n "$container_id" ]] || return 0
  docker inspect "$container_id" --format '{{range .Config.Env}}{{println .}}{{end}}' </dev/null 2>/dev/null \
    | sed -n "s/^${key}=//p" | tail -n1
}

wait_existing_postgres() {
  local container_id="$1" i
  if [[ "$(docker inspect "$container_id" --format '{{.State.Running}}' </dev/null 2>/dev/null || true)" != "true" ]]; then
    docker start "$container_id" </dev/null >/dev/null
  fi
  for i in $(seq 1 30); do
    if docker exec "$container_id" pg_isready -h 127.0.0.1 -U xdrive -d xdrive </dev/null >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "xDrive server installer: existing PostgreSQL container did not become ready." >&2
  return 1
}

postgres_password_works() {
  local container_id="$1" password="$2"
  [[ -n "$password" ]] || return 1

  # Do not probe 127.0.0.1 here: an old pg_hba.conf can trust loopback while
  # still requiring SCRAM on the Docker bridge, which would make a bad password
  # look valid. Connect to the container's bridge address instead, matching the
  # authentication path used by the xDrive server container.
  docker exec -e "PGPASSWORD=$password" "$container_id" sh -ec '
    set -- $(hostname -i)
    [ "$#" -gt 0 ]
    exec psql -h "$1" -U xdrive -d xdrive -Atqc "SELECT 1"
  ' </dev/null >/dev/null 2>&1
}

repair_postgres_password_via_local_socket() {
  local container_id="$1" password="$2"
  [[ -n "$password" ]] || return 1
  docker exec "$container_id" psql -U xdrive -d xdrive -Atqc 'SELECT 1' </dev/null >/dev/null 2>&1 || return 1
  docker exec -i "$container_id" \
    psql -U xdrive -d xdrive -v ON_ERROR_STOP=1 -v "password_value=$password" >/dev/null <<'SQL'
ALTER ROLE xdrive WITH PASSWORD :'password_value';
SQL
}

recover_existing_runtime_secrets() {
  [[ -f "$COMPOSE_PATH" ]] || return 0

  local postgres_id server_id configured_pg runtime_pg candidate configured_jwt runtime_jwt
  local configured_connector_keys runtime_connector_keys configured_connector_active runtime_connector_active
  local configured_connector_legacy runtime_connector_legacy
  postgres_id="$(managed_container_id postgres)"
  server_id="$(managed_container_id server)"

  if [[ -n "$postgres_id" ]]; then
    wait_existing_postgres "$postgres_id"
    configured_pg="$(env_value POSTGRES_PASSWORD)"
    runtime_pg="$(container_env_value "$postgres_id" POSTGRES_PASSWORD)"

    if postgres_password_works "$postgres_id" "$configured_pg"; then
      :
    elif postgres_password_works "$postgres_id" "$runtime_pg"; then
      set_env POSTGRES_PASSWORD "$runtime_pg"
      echo "Recovered PostgreSQL password from the existing xDrive container and verified Docker-network authentication."
    else
      candidate="$configured_pg"
      [[ -n "$candidate" ]] || candidate="$runtime_pg"
      if [[ -z "$candidate" ]]; then
        candidate="$(random_hex 24)"
      fi

      if repair_postgres_password_via_local_socket "$postgres_id" "$candidate" \
          && postgres_password_works "$postgres_id" "$candidate"; then
        set_env POSTGRES_PASSWORD "$candidate"
        echo "Repaired the managed PostgreSQL role password to match xDrive configuration and verified Docker-network authentication."
      else
        cat >&2 <<'MSG'
xDrive server installer: existing PostgreSQL credentials cannot be reconciled safely.
The database volume was left untouched. Repair the xdrive role password or restore the
previous POSTGRES_PASSWORD in ~/.xd/config/.env, then rerun the installer.
MSG
        return 1
      fi
    fi
  fi

  configured_jwt="$(env_value XD_JWT_SECRET)"
  if [[ -z "$configured_jwt" && -n "$server_id" ]]; then
    runtime_jwt="$(container_env_value "$server_id" XD_JWT_SECRET)"
    if [[ -n "$runtime_jwt" ]]; then
      set_env XD_JWT_SECRET "$runtime_jwt"
      echo "Recovered JWT secret from the existing xDrive server container."
    fi
  fi

  if [[ -n "$server_id" ]]; then
    configured_connector_keys="$(env_value XD_CONNECTOR_SECRET_KEYS)"
    configured_connector_active="$(env_value XD_CONNECTOR_SECRET_ACTIVE_VERSION)"
    configured_connector_legacy="$(env_value XD_CONNECTOR_SECRET_KEY)"

    if [[ -z "$configured_connector_keys" ]]; then
      runtime_connector_keys="$(container_env_value "$server_id" XD_CONNECTOR_SECRET_KEYS || true)"
      if [[ -n "$runtime_connector_keys" ]]; then
        set_env XD_CONNECTOR_SECRET_KEYS "$runtime_connector_keys"
        configured_connector_keys="$runtime_connector_keys"
        echo "Recovered connector credential keyring from the existing xDrive server container."
      fi
    fi
    if [[ -n "$configured_connector_keys" && -z "$configured_connector_active" ]]; then
      runtime_connector_active="$(container_env_value "$server_id" XD_CONNECTOR_SECRET_ACTIVE_VERSION || true)"
      if [[ -n "$runtime_connector_active" ]]; then
        set_env XD_CONNECTOR_SECRET_ACTIVE_VERSION "$runtime_connector_active"
      fi
    fi
    if [[ -z "$configured_connector_keys" && -z "$configured_connector_legacy" ]]; then
      runtime_connector_legacy="$(container_env_value "$server_id" XD_CONNECTOR_SECRET_KEY || true)"
      if [[ -n "$runtime_connector_legacy" ]]; then
        set_env XD_CONNECTOR_SECRET_KEY "$runtime_connector_legacy"
        echo "Recovered legacy connector credential key from the existing xDrive server container."
      fi
    fi
  fi
}


validate_image_registry() {
  local value="$1"
  if [[ -z "$value" || "$value" == *"://"* || "$value" == *" "* || "$value" == *$'\t'* ]]; then
    echo "xDrive server installer: XD_IMAGE_REGISTRY must be a registry namespace without a URL scheme, for example ghcr.io/lazyxu." >&2
    return 1
  fi
  if [[ ! "$value" =~ ^[A-Za-z0-9._:-]+(/[A-Za-z0-9._-]+)*$ ]]; then
    echo "xDrive server installer: invalid XD_IMAGE_REGISTRY: $value" >&2
    return 1
  fi
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

validate_port() {
  local value="$1"
  if [[ ! "$value" =~ ^[0-9]+$ ]] || (( value < 1 || value > 65535 )); then
    echo "xDrive server installer: XD_HTTPS_PORT must be an integer from 1 to 65535." >&2
    return 1
  fi
}

https_url() {
  local domain="$1" port="$2"
  if [[ "$port" == "443" ]]; then
    printf 'https://%s\n' "$domain"
  else
    printf 'https://%s:%s\n' "$domain" "$port"
  fi
}

set_env_in_file() {
  local file="$1" key="$2" value="$3" tmp
  tmp="$file.tmp"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    awk -v k="$key" -v v="$value" 'BEGIN{FS="="} $1==k{print k "=" v; next} {print}' "$file" > "$tmp"
    mv "$tmp" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

snapshot_transaction_file() {
  local name="$1" path="$2" mode="$3"
  if [[ -e "$path" ]]; then
    install -m "$mode" "$path" "$UPGRADE_STATE_DIR/files/$name"
  else
    : > "$UPGRADE_STATE_DIR/absent-$name"
  fi
}

restore_transaction_file() {
  local name="$1" path="$2" mode="$3"
  if [[ -f "$UPGRADE_STATE_DIR/absent-$name" ]]; then
    rm -f "$path"
  elif [[ -f "$UPGRADE_STATE_DIR/files/$name" ]]; then
    install -m "$mode" "$UPGRADE_STATE_DIR/files/$name" "$path"
  else
    echo "[xDrive] rollback state is missing $name" >&2
    return 1
  fi
}

prepare_upgrade_transaction() {
  rm -rf "$UPGRADE_STATE_DIR"
  mkdir -p "$UPGRADE_STATE_DIR/files"
  chmod 700 "$UPGRADE_STATE_DIR" "$UPGRADE_STATE_DIR/files"

  snapshot_transaction_file ".env" "$ENV_PATH" 600
  snapshot_transaction_file "docker-compose.yml" "$COMPOSE_PATH" 600
  snapshot_transaction_file "Caddyfile" "$CADDY_PATH" 600
  snapshot_transaction_file "server-backup.sh" "$BIN_DIR/server-backup.sh" 700
  snapshot_transaction_file "server-backup-scheduled.sh" "$BIN_DIR/server-backup-scheduled.sh" 700
  snapshot_transaction_file "server-restore.sh" "$BIN_DIR/server-restore.sh" 700
  snapshot_transaction_file "server-verify.sh" "$BIN_DIR/server-verify.sh" 700
  # The read-only doctor and host-side xdrive-server manager are intentionally
  # outside the runtime rollback set. Once published control-plane tools are
  # installed they remain available to diagnose and retry a rolled-back
  # deployment.
  install -m 700 "$STAGING_DIR/server-restore.sh" "$UPGRADE_STATE_DIR/rollback-restore.sh"

  cat > "$UPGRADE_STATE_DIR/state" <<EOF
pid=$$
target_source=$SOURCE_REF
target_image_tag=$IMAGE_TAG
started_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
  chmod 600 "$UPGRADE_STATE_DIR/state"
}

rollback_compose() {
  docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@" </dev/null
}

rollback_upgrade() {
  local ok=1 i
  ROLLBACK_RUNNING=1
  echo "[xDrive] rollback: stopping partially upgraded application containers..." >&2
  docker stop xdrive-caddy xdrive-server xdrive-worker xdrive-postgres \
    xdrive-caddy-1 xdrive-web-1 xdrive-server-1 xdrive-worker-1 xdrive-postgres-1 \
    </dev/null >/dev/null 2>&1 || true

  echo "[xDrive] rollback: restoring previous deployment files..." >&2
  restore_transaction_file ".env" "$ENV_PATH" 600 || ok=0
  restore_transaction_file "docker-compose.yml" "$COMPOSE_PATH" 600 || ok=0
  restore_transaction_file "Caddyfile" "$CADDY_PATH" 600 || ok=0
  restore_transaction_file "server-backup.sh" "$BIN_DIR/server-backup.sh" 700 || ok=0
  restore_transaction_file "server-backup-scheduled.sh" "$BIN_DIR/server-backup-scheduled.sh" 700 || ok=0
  restore_transaction_file "server-restore.sh" "$BIN_DIR/server-restore.sh" 700 || ok=0
  restore_transaction_file "server-verify.sh" "$BIN_DIR/server-verify.sh" 700 || ok=0

  # Keep the newly installed read-only doctor and host manager across an
  # application rollback. The runtime deployment is restored, but the control
  # plane must stay available so an operator can run
  # xdrive-server update/status/doctor without bootstrapping again.
  if [[ -f "$BIN_DIR/server-doctor.sh" ]]; then
    chmod 700 "$BIN_DIR/server-doctor.sh" || ok=0
  fi
  if [[ -f "$HOST_MANAGER_PATH" ]]; then
    chmod 700 "$HOST_MANAGER_PATH" || ok=0
    echo "[xDrive] rollback: retaining host manager and doctor for retry/recovery." >&2
  fi
  if [[ "$ok" != "1" ]]; then
    ROLLBACK_RUNNING=0
    return 1
  fi

  if [[ "$DATABASE_ROLLBACK_REQUIRED" == "1" && "$LEGACY_VOLUME_MIGRATION" != "1" ]]; then
    if [[ -z "$PRE_UPGRADE_BACKUP" || ! -d "$PRE_UPGRADE_BACKUP" ]]; then
      echo "[xDrive] rollback: pre-upgrade backup is unavailable; refusing to reopen the API." >&2
      ROLLBACK_RUNNING=0
      return 1
    fi
    echo "[xDrive] rollback: restoring database and blobs from $PRE_UPGRADE_BACKUP ..." >&2
    if ! "$UPGRADE_STATE_DIR/rollback-restore.sh" "$PRE_UPGRADE_BACKUP" \
        --config-dir "$XDRIVE_HOME" --yes --no-safety-backup </dev/null >&2; then
      echo "[xDrive] rollback: data restore failed; API remains stopped." >&2
      ROLLBACK_RUNNING=0
      return 1
    fi
  elif [[ "$LEGACY_VOLUME_MIGRATION" == "1" ]]; then
    echo "[xDrive] rollback: legacy named volumes were left untouched; database restore is not required." >&2
  else
    echo "[xDrive] rollback: database restore not required for this failure point." >&2
  fi

  echo "[xDrive] rollback: starting previous deployment..." >&2
  if ! rollback_compose up -d --remove-orphans >&2; then
    ROLLBACK_RUNNING=0
    return 1
  fi

  for i in $(seq 1 60); do
    if rollback_compose exec -T server xdrive-server healthcheck >/dev/null 2>&1; then
      echo "[xDrive] rollback: previous server is healthy." >&2
      rm -rf "$UPGRADE_STATE_DIR"
      ROLLBACK_RUNNING=0
      return 0
    fi
    sleep 2
  done

  echo "[xDrive] rollback: previous server did not become healthy." >&2
  rollback_compose logs --tail=100 postgres server >&2 || true
  ROLLBACK_RUNNING=0
  return 1
}

commit_upgrade_transaction() {
  if [[ "$ROLLBACK_ARMED" == "1" ]]; then
    ROLLBACK_ARMED=0
    rm -rf "$UPGRADE_STATE_DIR"
    echo "[xDrive] transaction committed; automatic rollback is no longer armed."
  fi
}

existing_mount_info() {
  local service="$1" destination="$2" id type source
  id="$(docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" ps -aq "$service" </dev/null 2>/dev/null | head -n1 || true)"
  [[ -n "$id" ]] || return 0
  type="$(docker inspect "$id" --format "{{range .Mounts}}{{if eq .Destination \"$destination\"}}{{.Type}}{{end}}{{end}}" </dev/null 2>/dev/null || true)"
  if [[ "$type" == "volume" ]]; then
    source="$(docker inspect "$id" --format "{{range .Mounts}}{{if eq .Destination \"$destination\"}}{{.Name}}{{end}}{{end}}" </dev/null 2>/dev/null || true)"
  else
    source="$(docker inspect "$id" --format "{{range .Mounts}}{{if eq .Destination \"$destination\"}}{{.Source}}{{end}}{{end}}" </dev/null 2>/dev/null || true)"
  fi
  if [[ -n "$type" && -n "$source" ]]; then
    printf '%s|%s\n' "$type" "$source"
  fi
  return 0
}

legacy_volume_by_label() {
  local volume_key="$1"
  docker volume ls -q \
    --filter 'label=com.docker.compose.project=xdrive' \
    --filter "label=com.docker.compose.volume=$volume_key" </dev/null 2>/dev/null | head -n1 || true
}

capture_legacy_named_volumes() {
  local info
  [[ "$UPGRADE_EXISTING" == "1" ]] || return 0

  info="$(existing_mount_info server /data)"
  if [[ "$info" == volume\|* ]]; then LEGACY_FILES_VOLUME="${info#volume|}"; fi
  info="$(existing_mount_info postgres /var/lib/postgresql/data)"
  if [[ "$info" == volume\|* ]]; then LEGACY_POSTGRES_VOLUME="${info#volume|}"; fi
  info="$(existing_mount_info caddy /data)"
  if [[ "$info" == volume\|* ]]; then LEGACY_CADDY_DATA_VOLUME="${info#volume|}"; fi
  info="$(existing_mount_info caddy /config)"
  if [[ "$info" == volume\|* ]]; then LEGACY_CADDY_CONFIG_VOLUME="${info#volume|}"; fi

  [[ -n "$LEGACY_FILES_VOLUME" ]] || LEGACY_FILES_VOLUME="$(legacy_volume_by_label file-data)"
  [[ -n "$LEGACY_POSTGRES_VOLUME" ]] || LEGACY_POSTGRES_VOLUME="$(legacy_volume_by_label postgres-data)"
  [[ -n "$LEGACY_CADDY_DATA_VOLUME" ]] || LEGACY_CADDY_DATA_VOLUME="$(legacy_volume_by_label caddy-data)"
  [[ -n "$LEGACY_CADDY_CONFIG_VOLUME" ]] || LEGACY_CADDY_CONFIG_VOLUME="$(legacy_volume_by_label caddy-config)"

  if [[ -n "$LEGACY_FILES_VOLUME$LEGACY_POSTGRES_VOLUME$LEGACY_CADDY_DATA_VOLUME$LEGACY_CADDY_CONFIG_VOLUME" ]]; then
    LEGACY_VOLUME_MIGRATION=1
    echo "[xDrive] legacy Docker named-volume deployment detected; bind-mount migration will run after backup."
  fi
}

copy_legacy_volume() {
  local volume="$1" target="$2" helper_image="$3" label="$4"
  [[ -n "$volume" ]] || return 0
  mkdir -p "$target"
  echo "[xDrive] migrating $label: $volume -> $target"
  docker run --rm --entrypoint sh \
    -v "$volume:/from:ro" \
    -v "$target:/to" \
    "$helper_image" \
    -ec 'find /to -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; cp -a /from/. /to/'
}

migrate_legacy_named_volumes() {
  [[ "$LEGACY_VOLUME_MIGRATION" == "1" ]] || return 0
  local helper_image
  helper_image="$(env_value XD_POSTGRES_IMAGE)"
  [[ -n "$helper_image" ]] || helper_image="postgres:17-alpine"

  docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" stop postgres </dev/null >/dev/null 2>&1 || true

  copy_legacy_volume "$LEGACY_FILES_VOLUME" "$(env_value XD_FILES_DATA_DIR)" "$helper_image" "file data"
  copy_legacy_volume "$LEGACY_POSTGRES_VOLUME" "$(env_value XD_POSTGRES_DATA_DIR)" "$helper_image" "PostgreSQL data"
  copy_legacy_volume "$LEGACY_CADDY_DATA_VOLUME" "$(env_value XD_CADDY_DATA_DIR)" "$helper_image" "Caddy data"
  copy_legacy_volume "$LEGACY_CADDY_CONFIG_VOLUME" "$(env_value XD_CADDY_CONFIG_DIR)" "$helper_image" "Caddy config"

  cat > "$STATE_DIR/legacy-volumes-retained" <<EOF
files=$LEGACY_FILES_VOLUME
postgres=$LEGACY_POSTGRES_VOLUME
caddy_data=$LEGACY_CADDY_DATA_VOLUME
caddy_config=$LEGACY_CADDY_CONFIG_VOLUME
EOF
  chmod 600 "$STATE_DIR/legacy-volumes-retained"
}

finalize_host_layout() {
  local old target path pair
  mkdir -p "$SNAPSHOT_BACKUP_DIR" "$PRE_UPGRADE_BACKUP_DIR" "$PRE_RESTORE_BACKUP_DIR" "$LOG_DIR" "$STATE_DIR"

  for old in "$BACKUP_ROOT"/xdrive-backup-*; do
    [[ -d "$old" ]] || continue
    target="$SNAPSHOT_BACKUP_DIR/$(basename "$old")"
    [[ -e "$target" ]] || mv "$old" "$target"
  done

  for pair in "pre-upgrade-backups|$PRE_UPGRADE_BACKUP_DIR" "pre-restore-backups|$PRE_RESTORE_BACKUP_DIR"; do
    old="$XDRIVE_HOME/${pair%%|*}"
    target="${pair#*|}"
    if [[ -d "$old" ]]; then
      find "$old" -mindepth 1 -maxdepth 1 -exec mv -n -t "$target" -- {} + 2>/dev/null || true
      rmdir "$old" 2>/dev/null || true
    fi
  done

  if [[ -f "$XDRIVE_HOME/backup.log" ]]; then
    cat "$XDRIVE_HOME/backup.log" >> "$LOG_DIR/backup.log"
    rm -f "$XDRIVE_HOME/backup.log"
  fi
  if [[ -f "$XDRIVE_HOME/.install-pull.log" ]]; then
    cat "$XDRIVE_HOME/.install-pull.log" >> "$LOG_DIR/install-pull.log"
    rm -f "$XDRIVE_HOME/.install-pull.log"
  fi

  for path in .env docker-compose.yml Caddyfile xdrive-server server-backup.sh server-backup-scheduled.sh server-restore.sh server-verify.sh server-doctor.sh server-migrate-user.sh; do
    rm -f "$XDRIVE_HOME/$path"
  done
  rm -f "$XDRIVE_HOME/.install.lock" "$XDRIVE_HOME/.scheduled-backup.lock"
  rm -rf "$XDRIVE_HOME/.scheduled-backup.lock.d" "$XDRIVE_HOME/.install-staging"
  if [[ -d "$XDRIVE_HOME/.upgrade-transaction" && ! -e "$STATE_DIR/legacy-upgrade-transaction" ]]; then
    mv "$XDRIVE_HOME/.upgrade-transaction" "$STATE_DIR/legacy-upgrade-transaction"
  fi
  printf '2\n' > "$STATE_DIR/layout-version"
  chmod 600 "$STATE_DIR/layout-version"
}

stage 4 "prepare server configuration"
if [[ -f "$COMPOSE_PATH" && -f "$ENV_PATH" ]] \
    && docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" ps -aq server </dev/null 2>/dev/null | grep -q .; then
  UPGRADE_EXISTING=1
  capture_legacy_named_volumes
  prepare_upgrade_transaction
fi

touch "$ENV_PATH"
chmod 600 "$ENV_PATH"
recover_existing_runtime_secrets
if [[ "$UPGRADE_EXISTING" == "1" ]]; then
  set_env_in_file "$UPGRADE_STATE_DIR/files/.env" POSTGRES_PASSWORD "$(env_value POSTGRES_PASSWORD)"
  set_env_in_file "$UPGRADE_STATE_DIR/files/.env" XD_JWT_SECRET "$(env_value XD_JWT_SECRET)"
  set_env_in_file "$UPGRADE_STATE_DIR/files/.env" XD_CONNECTOR_SECRET_ACTIVE_VERSION "$(env_value XD_CONNECTOR_SECRET_ACTIVE_VERSION)"
  set_env_in_file "$UPGRADE_STATE_DIR/files/.env" XD_CONNECTOR_SECRET_KEYS "$(env_value XD_CONNECTOR_SECRET_KEYS)"
  set_env_in_file "$UPGRADE_STATE_DIR/files/.env" XD_CONNECTOR_SECRET_KEY "$(env_value XD_CONNECTOR_SECRET_KEY)"
  ROLLBACK_ARMED=1
  echo "[xDrive] transaction prepared; deployment rollback is armed."
fi
ensure_env POSTGRES_PASSWORD "${POSTGRES_PASSWORD:-$(random_hex 24)}"
ensure_env XD_JWT_SECRET "${XD_JWT_SECRET:-$(random_hex 48)}"

connector_keys="${XD_CONNECTOR_SECRET_KEYS:-$(env_value XD_CONNECTOR_SECRET_KEYS)}"
connector_active="${XD_CONNECTOR_SECRET_ACTIVE_VERSION:-$(env_value XD_CONNECTOR_SECRET_ACTIVE_VERSION)}"
connector_legacy="${XD_CONNECTOR_SECRET_KEY:-$(env_value XD_CONNECTOR_SECRET_KEY)}"
if [[ -z "$connector_keys" ]]; then
  if [[ -n "$connector_legacy" ]]; then
    connector_keys="1:$connector_legacy"
    connector_active="1"
    echo "Migrated legacy connector credential key into keyring version 1."
  else
    generated_connector_key="$(random_hex 32)"
    connector_keys="1:$generated_connector_key"
    connector_active="1"
    echo "Generated connector credential keyring version 1."
  fi
elif [[ -z "$connector_active" ]]; then
  if [[ "$connector_keys" == *,* ]]; then
    echo "xDrive server installer: XD_CONNECTOR_SECRET_ACTIVE_VERSION is required when multiple connector keys are configured." >&2
    exit 1
  fi
  connector_active="${connector_keys%%:*}"
fi
set_env XD_CONNECTOR_SECRET_ACTIVE_VERSION "$connector_active"
set_env XD_CONNECTOR_SECRET_KEYS "$connector_keys"
# The pre-upgrade transaction snapshot retains any legacy single-key setting
# for rollback. The active upgraded configuration must not keep an obsolete
# copy of the historical key after keyring migration.
unset_env XD_CONNECTOR_SECRET_KEY

ensure_env XD_ACCESS_TOKEN_TTL "${XD_ACCESS_TOKEN_TTL:-15m}"
ensure_env XD_REFRESH_TOKEN_TTL "${XD_REFRESH_TOKEN_TTL:-720h}"
ensure_env XD_WEB_BIND "${XD_WEB_BIND:-127.0.0.1}"
ensure_env XD_WEB_PORT "${XD_WEB_PORT:-3000}"
ensure_env XD_ALLOWED_ORIGIN "${XD_ALLOWED_ORIGIN:-http://localhost:3000}"
ensure_env XD_MAX_UPLOAD_BYTES "${XD_MAX_UPLOAD_BYTES:-21474836480}"
ensure_env XD_DOMAIN "${XD_DOMAIN:-}"
ensure_env XD_HTTPS_BIND "${XD_HTTPS_BIND:-0.0.0.0}"
ensure_env XD_HTTPS_PORT "${XD_HTTPS_PORT:-8443}"
ensure_env ALIYUN_ACCESS_KEY_ID "${ALIYUN_ACCESS_KEY_ID:-}"
ensure_env ALIYUN_ACCESS_KEY_SECRET "${ALIYUN_ACCESS_KEY_SECRET:-}"
ensure_env XD_POSTGRES_IMAGE "${XD_POSTGRES_IMAGE:-postgres:17-alpine}"
set_env XD_DOCKER_MODE "$DOCKER_MODE"
set_env XD_SERVER_UID "$SERVER_UID"
set_env XD_SERVER_GID "$SERVER_GID"
configure_data_path XD_FILES_DATA_DIR "$DATA_DIR/files"
configure_data_path XD_POSTGRES_DATA_DIR "$DATA_DIR/postgres"
configure_data_path XD_CADDY_DATA_DIR "$DATA_DIR/caddy/data"
configure_data_path XD_CADDY_CONFIG_DIR "$DATA_DIR/caddy/config"
ensure_env XD_POSTGRES_MEMORY_LIMIT "${XD_POSTGRES_MEMORY_LIMIT:-1g}"
ensure_env XD_POSTGRES_CPU_LIMIT "${XD_POSTGRES_CPU_LIMIT:-1.0}"
ensure_env XD_POSTGRES_PIDS_LIMIT "${XD_POSTGRES_PIDS_LIMIT:-256}"
ensure_env XD_SERVER_MEMORY_LIMIT "${XD_SERVER_MEMORY_LIMIT:-1g}"
ensure_env XD_SERVER_CPU_LIMIT "${XD_SERVER_CPU_LIMIT:-1.0}"
ensure_env XD_SERVER_PIDS_LIMIT "${XD_SERVER_PIDS_LIMIT:-256}"
ensure_env XD_CADDY_MEMORY_LIMIT "${XD_CADDY_MEMORY_LIMIT:-256m}"
ensure_env XD_CADDY_CPU_LIMIT "${XD_CADDY_CPU_LIMIT:-0.50}"
ensure_env XD_CADDY_PIDS_LIMIT "${XD_CADDY_PIDS_LIMIT:-128}"
ensure_env XD_LOG_MAX_SIZE "${XD_LOG_MAX_SIZE:-10m}"
ensure_env XD_LOG_MAX_FILES "${XD_LOG_MAX_FILES:-5}"
ensure_env XD_BACKUP_RETENTION_DAYS "${XD_BACKUP_RETENTION_DAYS:-7}"
ensure_env XD_BACKUP_SCHEDULE "${XD_BACKUP_SCHEDULE:-17 3 * * *}"
previous_source="$(existing_env_value XD_UPDATE_SOURCE)"
ensure_env XD_UPDATE_SOURCE "$requested_source"
ensure_env XD_RELEASE_CHANNEL "$requested_channel"
ensure_env XD_RELEASE_COMMIT "${requested_commit:-}"
# A registry baked into a provider-specific release is only that provider's
# default. When the user explicitly switches providers, discard the baked
# default unless XD_IMAGE_REGISTRY was explicitly supplied at runtime.
if [[ -z "${XD_IMAGE_REGISTRY:-}" && "$requested_source" != "$BUILT_SOURCE" ]] && ! is_template_placeholder "$BUILT_SOURCE"; then
  IMAGE_REGISTRY=""
fi
if [[ -z "$IMAGE_REGISTRY" ]] || is_template_placeholder "$IMAGE_REGISTRY"; then
  existing_registry="$(existing_env_value XD_IMAGE_REGISTRY)"
  if [[ -n "${XD_IMAGE_REGISTRY:-}" ]]; then
    IMAGE_REGISTRY="$XD_IMAGE_REGISTRY"
  elif [[ -n "$existing_registry" && ( "$previous_source" == "$requested_source" || ( -z "$previous_source" && "$requested_source" == "github" ) ) ]]; then
    IMAGE_REGISTRY="$existing_registry"
  elif [[ "$requested_source" == "gitlab" ]]; then
    IMAGE_REGISTRY="$(resolve_gitlab_registry)"
  else
    IMAGE_REGISTRY="ghcr.io/lazyxu"
  fi
fi
IMAGE_REGISTRY="${IMAGE_REGISTRY%/}"
[[ -n "$IMAGE_REGISTRY" ]] || {
  echo "xDrive server installer: could not determine an image registry for $requested_source." >&2
  exit 1
}
validate_image_registry "$IMAGE_REGISTRY"
ensure_env XD_IMAGE_REGISTRY "$IMAGE_REGISTRY"
set_env XD_IMAGE_REGISTRY "$IMAGE_REGISTRY"
set_env XD_UPDATE_SOURCE "$requested_source"
set_env XD_RELEASE_CHANNEL "$requested_channel"
set_env XD_RELEASE_COMMIT "${requested_commit:-}"
domain="$(env_value XD_DOMAIN)"
https_port="$(env_value XD_HTTPS_PORT)"
web_port="$(env_value XD_WEB_PORT)"
validate_port "$https_port"
validate_rootless_port "Web" "$web_port"
validate_rootless_port "HTTPS" "$https_port"
if [[ -z "$domain" ]] && interactive_tty_available; then
  read -r -p "Public domain for DNS-01 HTTPS (blank for HTTP/private mode): " input_domain </dev/tty || true
  domain="${input_domain:-}"
  if [[ -n "$domain" ]]; then
    domain="$(printf '%s' "$domain" | tr '[:upper:]' '[:lower:]')"
    validate_domain "$domain"
    set_env XD_DOMAIN "$domain"
  fi
fi

if [[ -n "$domain" ]]; then
  validate_domain "$domain"
  alidns_key_id="$(env_value ALIYUN_ACCESS_KEY_ID)"
  alidns_key_secret="$(env_value ALIYUN_ACCESS_KEY_SECRET)"
  if [[ -z "$alidns_key_id" || -z "$alidns_key_secret" ]]; then
    if interactive_tty_available; then
      if [[ -z "$alidns_key_id" ]]; then
        read -r -p "AliDNS AccessKey ID: " alidns_key_id </dev/tty
        [[ -n "$alidns_key_id" ]] || { echo "AliDNS AccessKey ID cannot be empty." >&2; exit 1; }
        set_env ALIYUN_ACCESS_KEY_ID "$alidns_key_id"
      fi
      if [[ -z "$alidns_key_secret" ]]; then
        read -r -s -p "AliDNS AccessKey Secret: " alidns_key_secret </dev/tty
        printf '\n' >/dev/tty
        [[ -n "$alidns_key_secret" ]] || { echo "AliDNS AccessKey Secret cannot be empty." >&2; exit 1; }
        set_env ALIYUN_ACCESS_KEY_SECRET "$alidns_key_secret"
      fi
    else
      echo "xDrive server installer: XD_DOMAIN requires ALIYUN_ACCESS_KEY_ID and ALIYUN_ACCESS_KEY_SECRET for DNS-01 HTTPS." >&2
      exit 1
    fi
  fi
  public_url="$(https_url "$domain" "$https_port")"
  set_env XD_ALLOWED_ORIGIN "$public_url"
  set_env XD_WEB_BIND "127.0.0.1"
else
  # HTTP/private mode remains directly reachable on XD_WEB_PORT.
  if [[ "$(env_value XD_WEB_BIND)" == "127.0.0.1" && "${XD_KEEP_LOOPBACK_HTTP:-0}" != "1" ]]; then
    set_env XD_WEB_BIND "0.0.0.0"
  fi
fi

stage 5 "create pre-upgrade backup"
if [[ "$UPGRADE_EXISTING" == "1" ]]; then
  echo "[xDrive] existing deployment detected; entering upgrade maintenance window..."
  docker stop xdrive-caddy xdrive-caddy-1 xdrive-web-1 </dev/null >/dev/null 2>&1 || true

  backup_output=""
  if ! backup_output="$("$STAGING_DIR/server-backup.sh" \
      --config-dir "$XDRIVE_HOME" \
      --output-dir "$PRE_UPGRADE_BACKUP_DIR" \
      --leave-server-stopped </dev/null)"; then
    echo "$backup_output" >&2
    echo "xDrive pre-upgrade backup failed; automatic rollback will reopen the previous deployment." >&2
    exit 1
  fi
  printf '%s\n' "$backup_output"
  PRE_UPGRADE_BACKUP="$(printf '%s\n' "$backup_output" | tail -n1)"
  if [[ ! -d "$PRE_UPGRADE_BACKUP" ]]; then
    echo "xDrive server installer: backup completed without a usable backup directory." >&2
    exit 1
  fi
  printf '%s\n' "$PRE_UPGRADE_BACKUP" > "$UPGRADE_STATE_DIR/pre-upgrade-backup"
  chmod 600 "$UPGRADE_STATE_DIR/pre-upgrade-backup"
  echo "[xDrive] transaction armed; rollback backup: $PRE_UPGRADE_BACKUP"
  migrate_legacy_named_volumes
fi

stage 6 "install deployment files"
# Only point at the new release images after the old deployment has been
# backed up successfully. Caddy now contains the exact CI-tested Web build.
set_env XD_SERVER_IMAGE "$IMAGE_REGISTRY/xdrive-server:$IMAGE_TAG"
set_env XD_CADDY_IMAGE "$IMAGE_REGISTRY/xdrive-caddy:$IMAGE_TAG"
unset_env XD_WEB_IMAGE
unset_env XD_WEB_MEMORY_LIMIT
unset_env XD_WEB_CPU_LIMIT
unset_env XD_WEB_PIDS_LIMIT
unset_env XD_CADDY_BUILD_ID

install -m 600 "$STAGING_DIR/docker-compose.yml" "$COMPOSE_PATH"
for maintenance_script in server-backup.sh server-backup-scheduled.sh server-restore.sh server-verify.sh server-doctor.sh server-migrate-user.sh; do
  install -m 700 "$STAGING_DIR/$maintenance_script" "$BIN_DIR/$maintenance_script"
done
install -m 700 "$STAGING_DIR/xdrive-server" "$HOST_MANAGER_PATH"
configure_user_command_path
remove_legacy_system_manager_link
echo "Host manager:    $HOST_MANAGER_PATH"
echo "User PATH file:  $SHELL_RC_PATH"
echo "Current terminal: run: source \"$SHELL_RC_PATH\""
rm -rf "$STAGING_DIR"

compose() {
  docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@" </dev/null
}

compose_with_stdin() {
  docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@"
}

show_install_environment() {
  echo
  echo "[xDrive] installation environment"
  if ! XD_CONFIG_DIR="$XDRIVE_HOME" "$HOST_MANAGER_PATH" status --summary-only; then
    echo "[xDrive] warning: installation environment summary is unavailable; run 'xdrive-server status' after install." >&2
  fi
}

install_backup_schedule() {
  command -v crontab >/dev/null 2>&1 || {
    echo "Backup schedule: crontab is unavailable; run $BIN_DIR/server-backup-scheduled.sh from your scheduler."
    return 0
  }
  local schedule existing tmp
  schedule="$(env_value XD_BACKUP_SCHEDULE)"
  [[ -n "$schedule" ]] || return 0
  existing="$(crontab -l 2>/dev/null || true)"
  tmp="$(mktemp)"
  printf '%s\n' "$existing" | grep -v '# xdrive-managed-backup$' > "$tmp" || true
  printf '%s XD_CONFIG_DIR=%q %q >> %q 2>&1 # xdrive-managed-backup\n' \
    "$schedule" "$XDRIVE_HOME" "$BIN_DIR/server-backup-scheduled.sh" "$LOG_DIR/backup.log" >> "$tmp"
  crontab "$tmp"
  rm -f "$tmp"
  echo "Backup schedule installed: $schedule; retention $(env_value XD_BACKUP_RETENTION_DAYS) days."
}

echo "xDrive compose: $COMPOSE_PATH"
echo "xDrive env:     $ENV_PATH"

if [[ "${XD_INSTALL_NO_START:-0}" == "1" ]]; then
  commit_upgrade_transaction
  if [[ "$UPGRADE_EXISTING" != "1" ]]; then
    finalize_host_layout
  fi
  stage 9 "complete"
  echo "Files installed without starting containers."
  show_install_environment
  exit 0
fi

stage 7 "pull images and start services"
echo "[xDrive] pulling container images; detailed Docker output is captured in $PULL_LOG"
: > "$PULL_LOG"
chmod 600 "$PULL_LOG"
pull_started="$(date +%s)"
pull_attempts="${XD_PULL_ATTEMPTS:-3}"
pull_retry_delay="${XD_PULL_RETRY_DELAY_SECONDS:-5}"
pull_stall_timeout="${XD_PULL_STALL_TIMEOUT_SECONDS:-60}"
pull_stall_log_interval="${XD_PULL_STALL_LOG_INTERVAL_SECONDS:-15}"
case "$pull_attempts" in
  ''|*[!0-9]*) echo "xDrive server installer: XD_PULL_ATTEMPTS must be an integer." >&2; exit 2 ;;
esac
case "$pull_retry_delay" in
  ''|*[!0-9]*) echo "xDrive server installer: XD_PULL_RETRY_DELAY_SECONDS must be an integer." >&2; exit 2 ;;
esac
case "$pull_stall_timeout" in
  ''|*[!0-9]*) echo "xDrive server installer: XD_PULL_STALL_TIMEOUT_SECONDS must be an integer." >&2; exit 2 ;;
esac
case "$pull_stall_log_interval" in
  ''|*[!0-9]*) echo "xDrive server installer: XD_PULL_STALL_LOG_INTERVAL_SECONDS must be an integer." >&2; exit 2 ;;
esac
if (( pull_attempts < 1 || pull_attempts > 10 )); then
  echo "xDrive server installer: XD_PULL_ATTEMPTS must be between 1 and 10." >&2
  exit 2
fi
if (( pull_stall_timeout < 2 || pull_stall_timeout > 3600 )); then
  echo "xDrive server installer: XD_PULL_STALL_TIMEOUT_SECONDS must be between 2 and 3600." >&2
  exit 2
fi
if (( pull_stall_log_interval < 1 || pull_stall_log_interval > pull_stall_timeout )); then
  echo "xDrive server installer: XD_PULL_STALL_LOG_INTERVAL_SECONDS must be between 1 and the stall timeout." >&2
  exit 2
fi

pull_progress_mode="plain"
if pull_json_supported; then
  pull_progress_mode="json"
  echo "[xDrive] Docker Compose JSON progress available; showing real downloaded/total bytes per service."
  echo "[xDrive] pull stall protection: retry after ${pull_stall_timeout}s without byte progress; stalled output every ${pull_stall_log_interval}s."
else
  echo "[xDrive] Docker Compose JSON progress unavailable; falling back to host RX rate." >&2
fi

pull_services=(postgres server caddy)
for pull_service in "${pull_services[@]}"; do
  pull_service_with_retry "$pull_service"
done

echo "[xDrive] container image pull complete in $(( $(date +%s) - pull_started ))s."
rm -f "$PULL_LOG"

if [[ "$UPGRADE_EXISTING" == "1" ]]; then
  DATABASE_ROLLBACK_REQUIRED=1
fi
compose up -d --remove-orphans postgres server

stage 8 "verify service health"
healthy=0
for _ in $(seq 1 60); do
  if compose exec -T server xdrive-server healthcheck >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 2
done
if [[ "$healthy" != "1" ]]; then
  echo "xDrive server did not become healthy after migration/startup. Recent logs:" >&2
  compose logs --tail=100 postgres server >&2 || true
  exit 1
fi

# Keep data rollback armed through all stage-8 validation. Caddy contains the
# exact CI-tested Web build and proxies /api directly to the server.
compose up -d --remove-orphans worker caddy
edge_healthy=0
for _ in $(seq 1 30); do
  if compose exec -T caddy wget -q -O /dev/null http://127.0.0.1/api/v1/readyz >/dev/null 2>&1; then
    edge_healthy=1
    break
  fi
  sleep 2
done
if [[ "$edge_healthy" != "1" ]]; then
  echo "xDrive Caddy/Web/API edge did not become healthy. Recent logs:" >&2
  compose logs --tail=100 server caddy >&2 || true
  exit 1
fi

wait_https() {
  local domain="$1" port="$2" attempt
  local bind probe_ip url
  bind="$(env_value XD_HTTPS_BIND)"
  probe_ip="127.0.0.1"
  if [[ -n "$bind" && "$bind" != "0.0.0.0" && "$bind" != "::" ]]; then
    probe_ip="$bind"
  fi
  url="$(https_url "$domain" "$port")"

  echo "Waiting for AliDNS DNS-01 certificate and HTTPS readiness on port $port..."
  for attempt in $(seq 1 90); do
    if command -v curl >/dev/null 2>&1; then
      if curl -fsS --max-time 8 --resolve "$domain:$port:$probe_ip" "$url/api/v1/readyz" >/dev/null 2>&1; then
        echo "HTTPS ready: $url"
        return 0
      fi
    elif command -v wget >/dev/null 2>&1; then
      if wget -q --timeout=8 --spider "$url/api/v1/readyz" >/dev/null 2>&1; then
        echo "HTTPS ready: $url"
        return 0
      fi
    fi
    sleep 2
  done

  echo "xDrive HTTPS did not become ready." >&2
  echo "Confirm AliDNS credentials can edit TXT records, the domain resolves to this server, and inbound TCP $port reaches it." >&2
  echo "DNS-01 certificate issuance does not require inbound TCP 80 or 443." >&2
  compose logs --tail=120 caddy server >&2 || true
  return 1
}

if [[ -n "$(env_value XD_DOMAIN)" ]]; then
  wait_https "$(env_value XD_DOMAIN)" "$(env_value XD_HTTPS_PORT)"
fi

DATABASE_ROLLBACK_REQUIRED=0
commit_upgrade_transaction
# Caddy/Web configuration is embedded in the versioned edge image. Keep an old
# host Caddyfile only until the upgrade transaction can no longer roll back.
rm -f "$CADDY_PATH"
finalize_host_layout
if [[ "$UPGRADE_EXISTING" == "1" ]]; then
  echo "[xDrive] UPGRADE SUCCESS: $SOURCE_REF is healthy."
else
  echo "[xDrive] INSTALL SUCCESS: $SOURCE_REF is healthy."
fi

stage 9 "finalize installation"
compose ps
install_backup_schedule

if ! compose exec -T server xdrive-server admin exists >/dev/null 2>&1; then
  echo
  echo "xDrive requires an administrator account before users can sign in."
  if interactive_tty_available; then
    admin_username="admin"
    read -r -p "Administrator username [admin]: " input_username </dev/tty || true
    [[ -n "${input_username:-}" ]] && admin_username="$input_username"
    while true; do
      read -r -s -p "Administrator password: " admin_password </dev/tty || true; printf '\n' >/dev/tty
      read -r -s -p "Confirm administrator password: " admin_password_confirm </dev/tty || true; printf '\n' >/dev/tty
      if [[ "$admin_password" == "$admin_password_confirm" && -n "$admin_password" ]]; then break; fi
      echo "Passwords did not match; try again." >/dev/tty
    done
    printf '%s\n' "$admin_password" | compose_with_stdin exec -T server xdrive-server admin create --username "$admin_username" --password-stdin
    unset admin_password admin_password_confirm
  else
    echo "Create the first administrator with:"
    echo "  read -s -p 'Admin password: ' P; echo; printf '%s\\n' \"\$P\" | docker compose --env-file '$ENV_PATH' -f '$COMPOSE_PATH' exec -T server xdrive-server admin create --username admin --password-stdin; unset P"
  fi
fi

echo
if [[ -n "$(env_value XD_DOMAIN)" ]]; then
  public_url="$(https_url "$(env_value XD_DOMAIN)" "$(env_value XD_HTTPS_PORT)")"
  echo "xDrive is running at: $public_url"
  echo "TLS mode: AliDNS DNS-01; inbound TCP $(env_value XD_HTTPS_PORT) must reach this server. Ports 80/443 are not required for ACME."
else
  echo "xDrive is running in HTTP/private mode on port $(env_value XD_WEB_PORT)."
fi
echo "Backup now:      $BIN_DIR/server-backup.sh"
echo "Restore:         $BIN_DIR/server-restore.sh"
echo "Verify storage:  $BIN_DIR/server-verify.sh"
echo "Diagnose server: xdrive-server doctor"
echo "Update server:   xdrive-server update"
echo "Update source:   $(env_value XD_UPDATE_SOURCE)"
echo "Release channel: $(env_value XD_RELEASE_CHANNEL)${requested_commit:+ ($requested_commit)}"
echo "Manage: xdrive-server status|doctor|update|backup|verify"
if [[ -n "$SHELL_RC_PATH" ]]; then
  echo "If this terminal still cannot find xdrive-server, run: source \"$SHELL_RC_PATH\""
fi
show_install_environment
