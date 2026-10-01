#!/usr/bin/env bash
set -euo pipefail
umask 077

XDRIVE_HOME="${XD_CONFIG_DIR:-$HOME/.xd}"
CONFIG_DIR="$XDRIVE_HOME/config"
BIN_DIR="$XDRIVE_HOME/bin"
LOG_DIR="$XDRIVE_HOME/logs"
STATE_DIR="$XDRIVE_HOME/state"
ENV_PATH="$CONFIG_DIR/.env"
MANAGER="$BIN_DIR/xdrive-server"

# The transactional installer reserves fd 9 for its flock. Host-control may be
# launched before the installer exits, so explicitly drop that inherited file
# descriptor; otherwise the long-lived runner would keep the install lock alive
# and block every later update.
exec 9>&-

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

control_dir() {
  local configured
  configured="$(env_value XD_HOST_CONTROL_HOST_DIR)"
  printf '%s\n' "${configured:-$STATE_DIR/control}"
}

prepare_dir() {
  local dir server_gid
  dir="$(control_dir)"
  server_gid="$(env_value XD_SERVER_GID)"
  [[ "$server_gid" =~ ^[0-9]+$ ]] || server_gid=65532
  mkdir -p "$dir" "$LOG_DIR"
  # Host owner retains full access; the server container reaches the bridge via
  # its configured group. setgid keeps files in the same group. No Docker
  # socket or host secret is exposed through this directory.
  chgrp "$server_gid" "$dir" 2>/dev/null || true
  chmod 2770 "$dir"
  printf '%s\n' "$dir"
}

json_escape() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\r'/}"
  value="${value//$'\n'/\\n}"
  printf '%s' "$value"
}

json_value() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  sed -nE "s/.*\\\"${key}\\\"[[:space:]]*:[[:space:]]*\\\"([^\\\"]*)\\\".*/\\1/p" "$file" | head -n1
}

progress_value() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  grep -F "${key}=" "$file" 2>/dev/null | tail -n1 | cut -d= -f2- || true
}

now_utc() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

request_time_is_fresh() {
  local value="$1" now_epoch request_epoch delta
  [[ -n "$value" ]] || return 1
  request_epoch="$(date -u -d "$value" +%s 2>/dev/null || true)"
  [[ "$request_epoch" =~ ^[0-9]+$ ]] || return 1
  now_epoch="$(date -u +%s)"
  delta=$(( now_epoch - request_epoch ))
  (( delta >= -60 && delta <= 900 ))
}

write_status() {
  local state="$1" source="$2" channel="$3" request_id="$4"
  local stage="$5" stage_current="$6" stage_total="$7"
  local bytes_done="$8" bytes_total="$9" message="${10}" error="${11}"
  local started_at="${12}" finished_at="${13}"
  local dir tmp now
  dir="$(prepare_dir)"
  now="$(now_utc)"
  tmp="$(mktemp "$dir/.status.XXXXXX")"
  printf '{"supported":true,"state":"%s","source":"%s","channel":"%s","request_id":"%s","stage":"%s","stage_current":%s,"stage_total":%s,"bytes_done":%s,"bytes_total":%s,"message":"%s","error":"%s","started_at":"%s","updated_at":"%s","finished_at":"%s","runner_heartbeat_at":"%s"}\n' \
    "$(json_escape "$state")" \
    "$(json_escape "$source")" \
    "$(json_escape "$channel")" \
    "$(json_escape "$request_id")" \
    "$(json_escape "$stage")" \
    "${stage_current:-0}" "${stage_total:-0}" "${bytes_done:-0}" "${bytes_total:-0}" \
    "$(json_escape "$message")" \
    "$(json_escape "$error")" \
    "$(json_escape "$started_at")" \
    "$now" \
    "$(json_escape "$finished_at")" \
    "$now" > "$tmp"
  chmod 0660 "$tmp"
  mv -f "$tmp" "$dir/status.json"
}

touch_heartbeat() {
  local dir
  dir="$(prepare_dir)"
  : > "$dir/heartbeat"
  chmod 0660 "$dir/heartbeat"
}

status_cmd() {
  local dir
  dir="$(prepare_dir)"
  if [[ -f "$dir/status.json" ]]; then
    cat "$dir/status.json"
  else
    printf '{"supported":false,"state":"unavailable","message":"host control has not started"}\n'
  fi
}

sync_progress() {
  local progress_file="$1" source="$2" channel="$3" request_id="$4" started_at="$5"
  local stage stage_current stage_total bytes_done bytes_total service message
  stage="$(progress_value "$progress_file" stage)"
  stage_current="$(progress_value "$progress_file" stage_current)"
  stage_total="$(progress_value "$progress_file" stage_total)"
  bytes_done="$(progress_value "$progress_file" bytes_done)"
  bytes_total="$(progress_value "$progress_file" bytes_total)"
  service="$(progress_value "$progress_file" service)"
  [[ -n "$stage" ]] || stage="准备更新"
  [[ -n "$stage_current" ]] || stage_current=0
  [[ -n "$stage_total" ]] || stage_total=9
  [[ "$stage_current" =~ ^[0-9]+$ ]] || stage_current=0
  [[ "$stage_total" =~ ^[0-9]+$ ]] || stage_total=9
  [[ "$bytes_done" =~ ^[0-9]+$ ]] || bytes_done=0
  [[ "$bytes_total" =~ ^[0-9]+$ ]] || bytes_total=0
  message="$stage"
  [[ -n "$service" ]] && message="$message · $service"
  write_status running "$source" "$channel" "$request_id" "$stage" \
    "$stage_current" "$stage_total" "$bytes_done" "$bytes_total" \
    "$message" "" "$started_at" ""
}

process_request() {
  local dir request active source channel request_id requested_at started_at
  local progress_file run_log update_pid status error_text
  dir="$(prepare_dir)"
  request="$dir/request.json"
  active="$dir/active.json"
  [[ -f "$request" ]] || return 0
  if ! mv "$request" "$active" 2>/dev/null; then
    return 0
  fi

  source="$(json_value "$active" source)"
  channel="$(json_value "$active" channel)"
  request_id="$(json_value "$active" request_id)"
  requested_at="$(json_value "$active" created_at)"
  case "$source" in github|gitlab) ;; *) source="" ;; esac
  case "$channel" in stable|master) ;; *) channel="" ;; esac
  if [[ -z "$source" || -z "$channel" || -z "$request_id" ]] || ! request_time_is_fresh "$requested_at"; then
    write_status failed "${source:-github}" "${channel:-stable}" "$request_id" \
      "校验更新请求" 0 9 0 0 "更新请求无效或已过期。" "invalid or stale host-control request" "" "$(now_utc)"
    rm -f "$active"
    return 0
  fi

  started_at="$(now_utc)"
  progress_file="$dir/install-progress.env"
  run_log="$LOG_DIR/host-control-update.log"
  rm -f "$progress_file"
  : > "$run_log"
  chmod 0600 "$run_log"
  write_status running "$source" "$channel" "$request_id" \
    "下载更新程序" 0 9 0 0 "正在下载并校验更新程序…" "" "$started_at" ""

  (
    export XD_INSTALL_PROGRESS_FILE="$progress_file"
    XD_CONFIG_DIR="$XDRIVE_HOME" "$MANAGER" update --source "$source" --channel "$channel"
  ) >"$run_log" 2>&1 &
  update_pid=$!

  while kill -0 "$update_pid" 2>/dev/null; do
    touch_heartbeat
    sync_progress "$progress_file" "$source" "$channel" "$request_id" "$started_at"
    sleep 1
  done
  if wait "$update_pid"; then status=0; else status=$?; fi

  sync_progress "$progress_file" "$source" "$channel" "$request_id" "$started_at"
  if [[ "$status" -eq 0 ]]; then
    write_status success "$source" "$channel" "$request_id" \
      "更新完成" 9 9 0 0 "服务端更新完成并通过健康检查。" "" "$started_at" "$(now_utc)"
  else
    error_text="$(tail -n 8 "$run_log" 2>/dev/null | tr '\n' ' ' | sed 's/[[:space:]][[:space:]]*/ /g' || true)"
    [[ -n "$error_text" ]] || error_text="xdrive-server update exited with status $status"
    write_status failed "$source" "$channel" "$request_id" \
      "更新失败" 0 9 0 0 "服务端更新失败；若升级事务已启动，安装器会按原有规则执行回滚。" \
      "$error_text" "$started_at" "$(now_utc)"
  fi
  rm -f "$active" "$progress_file"
}

serve_cmd() {
  [[ $# -eq 0 ]] || { echo "usage: server-control.sh serve" >&2; return 2; }
  local dir pid_file existing lock_dir="" source channel
  dir="$(prepare_dir)"
  pid_file="$dir/runner.pid"

  if command -v flock >/dev/null 2>&1; then
    exec 8>"$dir/runner.lock"
    if ! flock -n 8; then
      echo "xdrive-server: host control runner is already active" >&2
      return 0
    fi
  else
    existing="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ "$existing" =~ ^[0-9]+$ && "$existing" != "$$" ]] && kill -0 "$existing" 2>/dev/null; then
      echo "xdrive-server: host control runner is already active" >&2
      return 0
    fi
    lock_dir="$dir/runner.lock.d"
    if ! mkdir "$lock_dir" 2>/dev/null; then
      echo "xdrive-server: host control runner lock is held" >&2
      return 0
    fi
  fi

  printf '%s\n' "$$" > "$pid_file"
  chmod 0660 "$pid_file"
  CONTROL_PID_FILE="$pid_file"
  CONTROL_LOCK_DIR="$lock_dir"
  trap 'rm -f "${CONTROL_PID_FILE:-}"; [[ -z "${CONTROL_LOCK_DIR:-}" ]] || rmdir "${CONTROL_LOCK_DIR}" 2>/dev/null || true' EXIT
  trap 'exit 0' INT TERM

  if [[ -f "$dir/active.json" ]]; then
    interrupted_source="$(json_value "$dir/active.json" source)"
    interrupted_channel="$(json_value "$dir/active.json" channel)"
    interrupted_request_id="$(json_value "$dir/active.json" request_id)"
    case "$interrupted_source" in github|gitlab) ;; *) interrupted_source=github ;; esac
    case "$interrupted_channel" in stable|master) ;; *) interrupted_channel=stable ;; esac
    write_status failed "$interrupted_source" "$interrupted_channel" "$interrupted_request_id" \
      "更新中断" 0 9 0 0 "检测到上次服务端更新被宿主机重启或 runner 中断。" \
      "host update interrupted before completion" "" "$(now_utc)"
    rm -f "$dir/active.json" "$dir/install-progress.env"
  fi

  source="$(env_value XD_UPDATE_SOURCE)"
  channel="$(env_value XD_RELEASE_CHANNEL)"
  case "$source" in github|gitlab) ;; *) source=github ;; esac
  case "$channel" in stable|master) ;; *) channel=stable ;; esac
  if [[ ! -f "$dir/status.json" ]]; then
    write_status idle "$source" "$channel" "" "" 0 9 0 0 "等待管理员发起服务端更新。" "" "" ""
  fi

  while true; do
    touch_heartbeat
    [[ -f "$dir/request.json" ]] && process_request
    [[ "${XD_CONTROL_ONCE:-0}" == "1" ]] && break
    sleep 1
  done
}

start_cmd() {
  [[ $# -eq 0 ]] || { echo "usage: server-control.sh start" >&2; return 2; }
  local dir pid_file pid
  dir="$(prepare_dir)"
  pid_file="$dir/runner.pid"
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    echo "Host control already running (pid $pid)."
    return 0
  fi
  rm -f "$pid_file"
  # The installer owns transaction lock fd 9. A long-lived background
  # runner must not inherit it, otherwise all later updates remain locked.
  nohup env XD_CONFIG_DIR="$XDRIVE_HOME" "$BIN_DIR/server-control.sh" serve \
    >>"$LOG_DIR/host-control.log" 2>&1 </dev/null 9>&- &
  sleep 1
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ ! "$pid" =~ ^[0-9]+$ ]] || ! kill -0 "$pid" 2>/dev/null; then
    echo "xdrive-server: failed to start host control runner; see $LOG_DIR/host-control.log" >&2
    return 1
  fi
  echo "Host control started (pid $pid)."
}

stop_cmd() {
  [[ $# -eq 0 ]] || { echo "usage: server-control.sh stop" >&2; return 2; }
  local dir pid_file pid
  dir="$(control_dir)"
  pid_file="$dir/runner.pid"
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
  fi
  rm -f "$pid_file"
}

remove_schedule() {
  command -v crontab >/dev/null 2>&1 || return 0
  local existing tmp
  existing="$(crontab -l 2>/dev/null || true)"
  tmp="$(mktemp)"
  printf '%s\n' "$existing" | grep -v '# xdrive-managed-control$' > "$tmp" || true
  crontab "$tmp"
  rm -f "$tmp"
}

install_cmd() {
  [[ $# -eq 0 ]] || { echo "usage: server-control.sh install" >&2; return 2; }
  prepare_dir >/dev/null
  if command -v crontab >/dev/null 2>&1; then
    local existing tmp
    existing="$(crontab -l 2>/dev/null || true)"
    tmp="$(mktemp)"
    printf '%s\n' "$existing" | grep -v '# xdrive-managed-control$' > "$tmp" || true
    printf '@reboot XD_CONFIG_DIR=%q %q serve >> %q 2>&1 # xdrive-managed-control\n' \
      "$XDRIVE_HOME" "$BIN_DIR/server-control.sh" "$LOG_DIR/host-control.log" >> "$tmp"
    crontab "$tmp"
    rm -f "$tmp"
  fi
  start_cmd
}

cmd="${1:-status}"
shift || true
case "$cmd" in
  install) install_cmd "$@" ;;
  start) start_cmd "$@" ;;
  serve) serve_cmd "$@" ;;
  stop) stop_cmd "$@" ;;
  status) status_cmd "$@" ;;
  remove-schedule) remove_schedule ;;
  *) echo "usage: server-control.sh <install|start|serve|stop|status|remove-schedule>" >&2; exit 2 ;;
esac
