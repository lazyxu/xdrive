#!/usr/bin/env bash
set -euo pipefail
umask 077

XDRIVE_HOME="${XD_CONFIG_DIR:-$HOME/.xd}"
CONFIG_DIR="$XDRIVE_HOME/config"
BIN_DIR="$XDRIVE_HOME/bin"
LOG_DIR="$XDRIVE_HOME/logs"
STATE_DIR="$XDRIVE_HOME/state"
ENV_PATH="$CONFIG_DIR/.env"
COMPOSE_PATH="$CONFIG_DIR/docker-compose.yml"
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


directory_size_bytes() {
  local dir="$1" value
  [[ -d "$dir" ]] || { printf '0\n'; return; }
  value="$(du -sb -- "$dir" 2>/dev/null | awk '{print $1}' || true)"
  [[ "$value" =~ ^[0-9]+$ ]] || value=0
  printf '%s\n' "$value"
}

directory_file_count() {
  local dir="$1" value
  [[ -d "$dir" ]] || { printf '0\n'; return; }
  value="$(find "$dir" -type f -print 2>/dev/null | wc -l | tr -d ' ' || true)"
  [[ "$value" =~ ^[0-9]+$ ]] || value=0
  printf '%s\n' "$value"
}

home_root_file_bytes() {
  local value
  value="$(find "$XDRIVE_HOME" -mindepth 1 -maxdepth 1 -type f -printf '%s\n' 2>/dev/null | awk '{sum += $1} END {print sum + 0}' || true)"
  [[ "$value" =~ ^[0-9]+$ ]] || value=0
  printf '%s\n' "$value"
}

home_root_file_count() {
  local value
  value="$(find "$XDRIVE_HOME" -mindepth 1 -maxdepth 1 -type f -print 2>/dev/null | wc -l | tr -d ' ' || true)"
  [[ "$value" =~ ^[0-9]+$ ]] || value=0
  printf '%s\n' "$value"
}

postgres_storage_value() {
  local mode="$1" host_path value=""
  host_path="$(env_value XD_POSTGRES_DATA_DIR)"
  if [[ -f "$COMPOSE_PATH" && -f "$ENV_PATH" ]]; then
    if [[ "$mode" == "bytes" ]]; then
      value="$(docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" exec -T postgres sh -ec 'du -sk /var/lib/postgresql/data 2>/dev/null | cut -f1' 2>/dev/null | tr -d '\r' || true)"
      if [[ "$value" =~ ^[0-9]+$ ]]; then
        value=$(( value * 1024 ))
      fi
    else
      value="$(docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" exec -T postgres sh -ec "find /var/lib/postgresql/data -type f -print 2>/dev/null | wc -l" 2>/dev/null | tr -d ' \r' || true)"
    fi
  fi
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    if [[ "$mode" == "bytes" ]]; then
      value="$(directory_size_bytes "$host_path")"
    else
      value="$(directory_file_count "$host_path")"
    fi
  fi
  printf '%s\n' "$value"
}

refresh_storage_host_inventory() {
  local dir target tmp backup_root snapshots pre_upgrade pre_restore caddy_data caddy_config
  dir="$(prepare_dir)"
  target="$dir/storage-host-inventory.env"
  tmp="$(mktemp "$dir/.storage-host-inventory.XXXXXX")"
  backup_root="$XDRIVE_HOME/backups"
  snapshots="$backup_root/snapshots"
  pre_upgrade="$backup_root/pre-upgrade"
  pre_restore="$backup_root/pre-restore"
  caddy_data="$(env_value XD_CADDY_DATA_DIR)"
  caddy_config="$(env_value XD_CADDY_CONFIG_DIR)"
  [[ -n "$caddy_data" ]] || caddy_data="$XDRIVE_HOME/data/caddy/data"
  [[ -n "$caddy_config" ]] || caddy_config="$XDRIVE_HOME/data/caddy/config"

  {
    printf 'generated_at=%s\n' "$(now_utc)"
    printf 'database_bytes=%s\n' "$(postgres_storage_value bytes)"
    printf 'database_files=%s\n' "$(postgres_storage_value files)"
    printf 'backup_root_bytes=%s\n' "$(directory_size_bytes "$backup_root")"
    printf 'backup_root_files=%s\n' "$(directory_file_count "$backup_root")"
    printf 'backup_snapshots_bytes=%s\n' "$(directory_size_bytes "$snapshots")"
    printf 'backup_snapshots_files=%s\n' "$(directory_file_count "$snapshots")"
    printf 'backup_pre_upgrade_bytes=%s\n' "$(directory_size_bytes "$pre_upgrade")"
    printf 'backup_pre_upgrade_files=%s\n' "$(directory_file_count "$pre_upgrade")"
    printf 'backup_pre_restore_bytes=%s\n' "$(directory_size_bytes "$pre_restore")"
    printf 'backup_pre_restore_files=%s\n' "$(directory_file_count "$pre_restore")"
    printf 'config_bytes=%s\n' "$(directory_size_bytes "$CONFIG_DIR")"
    printf 'config_files=%s\n' "$(directory_file_count "$CONFIG_DIR")"
    printf 'bin_bytes=%s\n' "$(directory_size_bytes "$BIN_DIR")"
    printf 'bin_files=%s\n' "$(directory_file_count "$BIN_DIR")"
    printf 'logs_bytes=%s\n' "$(directory_size_bytes "$LOG_DIR")"
    printf 'logs_files=%s\n' "$(directory_file_count "$LOG_DIR")"
    printf 'state_bytes=%s\n' "$(directory_size_bytes "$STATE_DIR")"
    printf 'state_files=%s\n' "$(directory_file_count "$STATE_DIR")"
    printf 'caddy_data_bytes=%s\n' "$(directory_size_bytes "$caddy_data")"
    printf 'caddy_data_files=%s\n' "$(directory_file_count "$caddy_data")"
    printf 'caddy_config_bytes=%s\n' "$(directory_size_bytes "$caddy_config")"
    printf 'caddy_config_files=%s\n' "$(directory_file_count "$caddy_config")"
    printf 'home_root_files_bytes=%s\n' "$(home_root_file_bytes)"
    printf 'home_root_files_count=%s\n' "$(home_root_file_count)"
  } > "$tmp"
  chmod 0660 "$tmp"
  mv -f "$tmp" "$target"
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

json_bool_value() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  sed -nE "s/.*\\\"${key}\\\"[[:space:]]*:[[:space:]]*(true|false).*/\\1/p" "$file" | head -n1
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
  local started_at="${12}" finished_at="${13}" backup_file_data="${14:-false}"
  local dir tmp now
  [[ "$backup_file_data" == "true" ]] || backup_file_data=false
  dir="$(prepare_dir)"
  now="$(now_utc)"
  tmp="$(mktemp "$dir/.status.XXXXXX")"
  printf '{"supported":true,"state":"%s","source":"%s","channel":"%s","backup_file_data":%s,"request_id":"%s","stage":"%s","stage_current":%s,"stage_total":%s,"bytes_done":%s,"bytes_total":%s,"message":"%s","error":"%s","started_at":"%s","updated_at":"%s","finished_at":"%s","runner_heartbeat_at":"%s"}\n' \
    "$(json_escape "$state")" \
    "$(json_escape "$source")" \
    "$(json_escape "$channel")" \
    "$backup_file_data" \
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
  local progress_file="$1" source="$2" channel="$3" request_id="$4" started_at="$5" backup_file_data="${6:-false}"
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
    "$message" "" "$started_at" "" "$backup_file_data"
}

process_request() {
  local dir request active source channel backup_file_data request_id requested_at started_at
  local progress_file run_log update_pid status error_text
  local -a update_args
  dir="$(prepare_dir)"
  request="$dir/request.json"
  active="$dir/active.json"
  [[ -f "$request" ]] || return 0
  if ! mv "$request" "$active" 2>/dev/null; then
    return 0
  fi

  source="$(json_value "$active" source)"
  channel="$(json_value "$active" channel)"
  backup_file_data="$(json_bool_value "$active" backup_file_data)"
  [[ "$backup_file_data" == "true" ]] || backup_file_data=false
  request_id="$(json_value "$active" request_id)"
  requested_at="$(json_value "$active" created_at)"
  case "$source" in github|gitlab) ;; *) source="" ;; esac
  case "$channel" in stable|master) ;; *) channel="" ;; esac
  if [[ -z "$source" || -z "$channel" || -z "$request_id" ]] || ! request_time_is_fresh "$requested_at"; then
    write_status failed "${source:-github}" "${channel:-stable}" "$request_id" \
      "校验更新请求" 0 9 0 0 "更新请求无效或已过期。" "invalid or stale host-control request" "" "$(now_utc)" "$backup_file_data"
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
    "下载更新程序" 0 9 0 0 "正在下载并校验更新程序…" "" "$started_at" "" "$backup_file_data"

  update_args=(update --source "$source" --channel "$channel")
  [[ "$backup_file_data" == "true" ]] && update_args+=(--backup-file-data)
  (
    export XD_INSTALL_PROGRESS_FILE="$progress_file"
    XD_CONFIG_DIR="$XDRIVE_HOME" "$MANAGER" "${update_args[@]}"
  ) >"$run_log" 2>&1 &
  update_pid=$!

  while kill -0 "$update_pid" 2>/dev/null; do
    touch_heartbeat
    sync_progress "$progress_file" "$source" "$channel" "$request_id" "$started_at" "$backup_file_data"
    sleep 1
  done
  if wait "$update_pid"; then status=0; else status=$?; fi

  sync_progress "$progress_file" "$source" "$channel" "$request_id" "$started_at" "$backup_file_data"
  if [[ "$status" -eq 0 ]]; then
    write_status success "$source" "$channel" "$request_id" \
      "更新完成" 9 9 0 0 "服务端更新完成并通过健康检查。" "" "$started_at" "$(now_utc)" "$backup_file_data"
  else
    error_text="$(tail -n 8 "$run_log" 2>/dev/null | tr '\n' ' ' | sed 's/[[:space:]][[:space:]]*/ /g' || true)"
    [[ -n "$error_text" ]] || error_text="xdrive-server update exited with status $status"
    write_status failed "$source" "$channel" "$request_id" \
      "更新失败" 0 9 0 0 "服务端更新失败；若升级事务已启动，安装器会按原有规则执行回滚。" \
      "$error_text" "$started_at" "$(now_utc)" "$backup_file_data"
  fi
  rm -f "$active" "$progress_file"
}


# Restricted Media Worker bridge accepts only fixed media-worker activation,
# bounded memory and CPU quotas. No generic Docker commands or core restarts.
media_worker_control_uint() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  sed -nE "s/.*\"${key}\"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p" "$file" | head -n1
}
# Refuse shell arithmetic with noncanonical numbers (including octal and
# overflow input). This operator-approved range matches the Server validator.
media_worker_memory_valid() {
  local value="${1:-}"
  [[ "$value" =~ ^[1-9][0-9]*$ && ${#value} -le 4 ]] || return 1
  (( value >= 256 && value <= 4096 && value % 128 == 0 ))
}
media_worker_cpu_valid() {
  local value="${1:-}"
  [[ "$value" =~ ^[1-9][0-9]*$ && ${#value} -le 4 ]] || return 1
  (( value >= 250 && value <= 4000 && value % 250 == 0 ))
}
media_worker_cpu_decimal() {
  media_worker_cpu_valid "$1" || return 1
  printf '%d.%02d\n' "$(( $1 / 1000 ))" "$(( ($1 % 1000) / 10 ))"
}
media_worker_inspect_cpu() {
  local raw milli
  raw="$(docker inspect --format '{{.HostConfig.NanoCpus}}' xdrive-media-worker 2>/dev/null || true)"
  [[ "$raw" =~ ^[1-9][0-9]*$ && ${#raw} -le 10 ]] || return 1
  (( raw % 1000000 == 0 )) || return 1
  milli=$(( raw / 1000000 ))
  media_worker_cpu_valid "$milli" || return 1
  printf '%s\n' "$milli"
}
media_worker_staged_cpu() {
  local raw whole fraction milli
  raw="$(env_value XD_MEDIA_WORKER_CPU_LIMIT)"
  [[ -n "$raw" ]] || raw="0.75"
  [[ "$raw" =~ ^([0-4])\.([0-9]{1,3})$ ]] || return 1
  whole="${BASH_REMATCH[1]}"
  fraction="${BASH_REMATCH[2]}"
  while (( ${#fraction} < 3 )); do fraction+="0"; done
  milli=$(( 10#$whole * 1000 + 10#$fraction ))
  media_worker_cpu_valid "$milli" || return 1
  printf '%s\n' "$milli"
}
media_worker_observed_cpu() {
  if media_worker_running; then
    media_worker_inspect_cpu
  else
    media_worker_staged_cpu
  fi
}
media_worker_pids_valid() {
  local value="${1:-}"
  [[ "$value" =~ ^[1-9][0-9]*$ && ${#value} -le 4 ]] || return 1
  (( value >= 64 && value <= 1024 && value % 32 == 0 ))
}
media_worker_inspect_pids() {
  local raw
  raw="$(docker inspect --format '{{.HostConfig.PidsLimit}}' xdrive-media-worker 2>/dev/null || true)"
  media_worker_pids_valid "$raw" || return 1
  printf '%s\n' "$raw"
}
media_worker_staged_pids() {
  local raw
  raw="$(env_value XD_MEDIA_WORKER_PIDS_LIMIT)"
  [[ -n "$raw" ]] || raw="128"
  media_worker_pids_valid "$raw" || return 1
  printf '%s\n' "$raw"
}
media_worker_observed_pids() {
  if media_worker_running; then
    media_worker_inspect_pids
  else
    media_worker_staged_pids
  fi
}
media_worker_running() {
  [[ -f "$COMPOSE_PATH" && -f "$ENV_PATH" ]] || return 1
  docker compose --profile media-worker --env-file "$ENV_PATH" -f "$COMPOSE_PATH" \
    ps --status running --services media-worker 2>/dev/null | grep -Fxq media-worker
}
# Real container memory is obtained solely by fixed-name docker inspect.
# Never trust a saved .env setting as evidence of a running container's limit.
media_worker_inspect_memory() {
  local raw mib
  raw="$(docker inspect --format '{{.HostConfig.Memory}}' xdrive-media-worker 2>/dev/null || true)"
  [[ "$raw" =~ ^[1-9][0-9]*$ && ${#raw} -le 11 ]] || return 1
  (( raw % 1048576 == 0 )) || return 1
  mib=$(( raw / 1048576 ))
  media_worker_memory_valid "$mib" || return 1
  printf '%s\n' "$mib"
}
media_worker_staged_memory() {
  local raw
  raw="$(env_value XD_MEDIA_WORKER_MEMORY_LIMIT)"
  [[ -n "$raw" ]] || raw="768m"
  [[ "$raw" =~ ^[1-9][0-9]*m$ ]] || return 1
  raw="${raw%m}"
  media_worker_memory_valid "$raw" || return 1
  printf '%s\n' "$raw"
}
media_worker_observed_memory() {
  if media_worker_running; then
    media_worker_inspect_memory
  else
    media_worker_staged_memory
  fi
}
media_worker_control_write_status() {
  local state="$1" revision="$2" applied="$3" enabled="$4" observed="$5" request_id="$6"
  local target_memory="${7:-768}" observed_memory="${8:-0}" memory_verified="${9:-false}"
  local target_cpu="${10:-750}" observed_cpu="${11:-0}" cpu_verified="${12:-false}"
  local target_pids="${13:-128}" observed_pids="${14:-0}" pids_verified="${15:-false}"
  local dir tmp
  media_worker_memory_valid "$target_memory" || target_memory=768
  if ! media_worker_memory_valid "$observed_memory"; then observed_memory=0; memory_verified=false; fi
  media_worker_cpu_valid "$target_cpu" || target_cpu=750
  if ! media_worker_cpu_valid "$observed_cpu"; then observed_cpu=0; cpu_verified=false; fi
  media_worker_pids_valid "$target_pids" || target_pids=128
  if ! media_worker_pids_valid "$observed_pids"; then observed_pids=0; pids_verified=false; fi
  [[ "$memory_verified" == true ]] || memory_verified=false
  [[ "$cpu_verified" == true ]] || cpu_verified=false
  [[ "$pids_verified" == true ]] || pids_verified=false
  dir="$(prepare_dir)"
  tmp="$(mktemp "$dir/.media-worker-status.XXXXXX")" || return 1
  printf '{"supported":true,"cpu_control_supported":true,"pids_control_supported":true,"state":"%s","revision":%s,"applied_revision":%s,"enabled":%s,"observed_enabled":%s,"memory_mib":%s,"observed_memory_mib":%s,"memory_verified":%s,"cpu_milli":%s,"observed_cpu_milli":%s,"cpu_verified":%s,"pids_limit":%s,"observed_pids_limit":%s,"pids_verified":%s,"request_id":"%s","updated_at":"%s"}\n' \
    "$state" "$revision" "$applied" "$enabled" "$observed" \
    "$target_memory" "$observed_memory" "$memory_verified" \
    "$target_cpu" "$observed_cpu" "$cpu_verified" \
    "$target_pids" "$observed_pids" "$pids_verified" "$request_id" "$(now_utc)" > "$tmp"
  chmod 0660 "$tmp"
  mv -f "$tmp" "$dir/media-worker-control-status.json"
}
media_worker_control_refresh() {
  local dir path state revision applied enabled observed request_id
  local target_memory observed_memory memory_verified=false
  local target_cpu observed_cpu cpu_verified=false
  local target_pids observed_pids pids_verified=false
  dir="$(prepare_dir)"
  path="$dir/media-worker-control-status.json"
  observed=false
  if media_worker_running; then observed=true; fi
  observed_memory="$(media_worker_observed_memory || true)"
  media_worker_memory_valid "$observed_memory" || observed_memory=0
  observed_cpu="$(media_worker_observed_cpu || true)"
  media_worker_cpu_valid "$observed_cpu" || observed_cpu=0
  observed_pids="$(media_worker_observed_pids || true)"
  media_worker_pids_valid "$observed_pids" || observed_pids=0
  if [[ ! -f "$path" ]]; then
    media_worker_control_write_status idle 0 0 false "$observed" "" \
      768 "$observed_memory" false 750 "$observed_cpu" false 128 "$observed_pids"
    return
  fi
  state="$(json_value "$path" state)"
  revision="$(media_worker_control_uint "$path" revision)"
  applied="$(media_worker_control_uint "$path" applied_revision)"
  enabled="$(json_bool_value "$path" enabled)"
  request_id="$(json_value "$path" request_id)"
  target_memory="$(media_worker_control_uint "$path" memory_mib)"
  target_cpu="$(media_worker_control_uint "$path" cpu_milli)"
  target_pids="$(media_worker_control_uint "$path" pids_limit)"
  [[ "$revision" =~ ^[0-9]+$ ]] || revision=0
  [[ "$applied" =~ ^[0-9]+$ ]] || applied=0
  [[ "$enabled" == true ]] || enabled=false
  media_worker_memory_valid "$target_memory" || target_memory=768
  media_worker_cpu_valid "$target_cpu" || target_cpu=750
  media_worker_pids_valid "$target_pids" || target_pids=128
  [[ "$request_id" =~ ^[0-9a-f]{24}$ ]] || request_id=""
  case "$state" in idle|queued|running|success|failed) ;; *) state=failed ;; esac
  [[ "$observed_memory" == "$target_memory" ]] && memory_verified=true
  [[ "$observed_cpu" == "$target_cpu" ]] && cpu_verified=true
  [[ "$observed_pids" == "$target_pids" ]] && pids_verified=true
  if [[ "$state" == success && ( "$observed" != "$enabled" ||
      "$memory_verified" != true || "$cpu_verified" != true || "$pids_verified" != true ) ]]; then
    state=failed
  fi
  media_worker_control_write_status "$state" "$revision" "$applied" "$enabled" \
    "$observed" "$request_id" "$target_memory" "$observed_memory" "$memory_verified" \
    "$target_cpu" "$observed_cpu" "$cpu_verified" "$target_pids" "$observed_pids" "$pids_verified"
}
media_worker_profiles_for() {
  local profiles="$1" enabled="$2" item next=""
  profiles="$(printf '%s' "$profiles" | tr -d '[:space:]')"
  [[ "$profiles" =~ ^[A-Za-z0-9,_-]*$ ]] || return 1
  local -a parts=()
  IFS=',' read -r -a parts <<< "$profiles"
  for item in "${parts[@]}"; do
    [[ -n "$item" && "$item" != media-worker ]] || continue
    [[ -z "$next" ]] || next+=","
    next+="$item"
  done
  if [[ "$enabled" == true ]]; then
    [[ -z "$next" ]] || next+=","
    next+="media-worker"
  fi
  printf '%s\n' "$next"
}
# Atomically stage only media-worker profile, memory, CPU and PID scalars.
# Preserve all other deployment variables, credentials and Compose profiles.
media_worker_control_apply_config() {
  local profiles="$1" memory="$2" cpu="$3" pids="$4" cpu_decimal tmp
  media_worker_memory_valid "$memory" || return 1
  media_worker_cpu_valid "$cpu" || return 1
  media_worker_pids_valid "$pids" || return 1
  cpu_decimal="$(media_worker_cpu_decimal "$cpu")" || return 1
  [[ "$profiles" =~ ^[A-Za-z0-9,_-]*$ ]] || return 1
  [[ -f "$ENV_PATH" ]] || return 1
  tmp="$(mktemp "$CONFIG_DIR/.media-worker-env.XXXXXX")" || return 1
  awk -v profile="$profiles" -v mem="$memory" -v cpu="$cpu_decimal" -v pids="$pids" '
    /^COMPOSE_PROFILES=/ {
      if (!seen_profile) print "COMPOSE_PROFILES=" profile
      seen_profile=1; next
    }
    /^XD_MEDIA_WORKER_MEMORY_LIMIT=/ {
      if (!seen_memory) print "XD_MEDIA_WORKER_MEMORY_LIMIT=" mem "m"
      seen_memory=1; next
    }
    /^XD_MEDIA_WORKER_CPU_LIMIT=/ {
      if (!seen_cpu) print "XD_MEDIA_WORKER_CPU_LIMIT=" cpu
      seen_cpu=1; next
    }
    /^XD_MEDIA_WORKER_PIDS_LIMIT=/ {
      if (!seen_pids) print "XD_MEDIA_WORKER_PIDS_LIMIT=" pids
      seen_pids=1; next
    }
    { print }
    END {
      if (!seen_profile) print "COMPOSE_PROFILES=" profile
      if (!seen_memory) print "XD_MEDIA_WORKER_MEMORY_LIMIT=" mem "m"
      if (!seen_cpu) print "XD_MEDIA_WORKER_CPU_LIMIT=" cpu
      if (!seen_pids) print "XD_MEDIA_WORKER_PIDS_LIMIT=" pids
    }
  ' "$ENV_PATH" > "$tmp" || { rm -f "$tmp"; return 1; }
  chmod 0600 "$tmp"
  mv -f "$tmp" "$ENV_PATH"
}
media_worker_control_process() {
  local dir request active request_id revision enabled created_at status_path applied last_state
  local memory cpu pids before_memory before_cpu before_pids before_profiles next_profiles
  local observed next_observed observed_memory observed_cpu observed_pids
  local was_running=false healthy=false memory_verified=false cpu_verified=false pids_verified=false
  dir="$(prepare_dir)"
  request="$dir/media-worker-control-request.json"
  active="$dir/media-worker-control-active.json"
  [[ -f "$request" ]] || return 0
  if ! mv "$request" "$active" 2>/dev/null; then return 0; fi
  request_id="$(json_value "$active" request_id)"
  revision="$(media_worker_control_uint "$active" revision)"
  enabled="$(json_bool_value "$active" enabled)"
  memory="$(media_worker_control_uint "$active" memory_mib)"
  cpu="$(media_worker_control_uint "$active" cpu_milli)"
  pids="$(media_worker_control_uint "$active" pids_limit)"
  created_at="$(json_value "$active" created_at)"
  status_path="$dir/media-worker-control-status.json"
  applied="$(media_worker_control_uint "$status_path" applied_revision)"
  last_state="$(json_value "$status_path" state)"
  [[ "$applied" =~ ^[0-9]+$ ]] || applied=0
  [[ "$revision" =~ ^[0-9]+$ ]] || revision=0
  observed=false
  if media_worker_running; then observed=true; was_running=true; fi
  observed_memory="$(media_worker_observed_memory || true)"
  media_worker_memory_valid "$observed_memory" || observed_memory=0
  observed_cpu="$(media_worker_observed_cpu || true)"
  media_worker_cpu_valid "$observed_cpu" || observed_cpu=0
  observed_pids="$(media_worker_observed_pids || true)"
  media_worker_pids_valid "$observed_pids" || observed_pids=0
  if [[ ! "$request_id" =~ ^[0-9a-f]{24}$ || "$revision" -le 0 ||
        ( "$revision" -lt "$applied" || ( "$revision" -eq "$applied" && "$last_state" != failed ) ) ||
        "$revision" -gt 1152921504606846976 ||
        ( "$enabled" != true && "$enabled" != false ) ]] ||
        ! media_worker_memory_valid "$memory" ||
        ! media_worker_cpu_valid "$cpu" ||
        ! media_worker_pids_valid "$pids" || ! request_time_is_fresh "$created_at"; then
    media_worker_control_write_status failed "$revision" "$applied" false "$observed" "" \
      768 "$observed_memory" false 750 "$observed_cpu" false 128 "$observed_pids"
    rm -f "$active"
    return 0
  fi
  media_worker_control_write_status running "$revision" "$applied" "$enabled" "$observed" \
    "$request_id" "$memory" "$observed_memory" false "$cpu" "$observed_cpu" false \
    "$pids" "$observed_pids"
  before_profiles="$(env_value COMPOSE_PROFILES)"
  before_memory="$(media_worker_staged_memory || true)"
  before_cpu="$(media_worker_staged_cpu || true)"
  before_pids="$(media_worker_staged_pids || true)"
  if ! media_worker_memory_valid "$before_memory" ||
      ! media_worker_cpu_valid "$before_cpu" ||
      ! media_worker_pids_valid "$before_pids" ||
      ! next_profiles="$(media_worker_profiles_for "$before_profiles" "$enabled")"; then
    media_worker_control_write_status failed "$revision" "$applied" "$enabled" "$observed" \
      "$request_id" "$memory" "$observed_memory" false "$cpu" "$observed_cpu" false \
      "$pids" "$observed_pids"
    rm -f "$active"
    return 0
  fi
  if ! media_worker_control_apply_config "$next_profiles" "$memory" "$cpu" "$pids"; then
    media_worker_control_write_status failed "$revision" "$applied" "$enabled" "$observed" \
      "$request_id" "$memory" "$observed_memory" false "$cpu" "$observed_cpu" false \
      "$pids" "$observed_pids"
    rm -f "$active"
    return 0
  fi
  if [[ "$enabled" == true ]]; then
    # Recreate ONLY media-worker; require live cgroup limits and FFmpeg health.
    if docker compose --profile media-worker --env-file "$ENV_PATH" -f "$COMPOSE_PATH" \
        up -d --no-deps --force-recreate media-worker >/dev/null 2>&1; then
      for _ in $(seq 1 20); do
        if docker compose --profile media-worker --env-file "$ENV_PATH" -f "$COMPOSE_PATH" \
            exec -T media-worker xdrive-server media-worker check >/dev/null 2>&1 &&
            [[ "$(media_worker_inspect_memory || true)" == "$memory" ]] &&
            [[ "$(media_worker_inspect_cpu || true)" == "$cpu" ]] &&
            [[ "$(media_worker_inspect_pids || true)" == "$pids" ]]; then
          healthy=true
          break
        fi
        touch_heartbeat
        sleep 1
      done
    fi
  else
    if ! media_worker_running; then
      healthy=true
    elif docker compose --profile media-worker --env-file "$ENV_PATH" -f "$COMPOSE_PATH" \
        stop media-worker >/dev/null 2>&1 && ! media_worker_running; then
      healthy=true
    fi
  fi
  next_observed=false
  if media_worker_running; then next_observed=true; fi
  observed_memory="$(media_worker_observed_memory || true)"
  observed_cpu="$(media_worker_observed_cpu || true)"
  observed_pids="$(media_worker_observed_pids || true)"
  [[ "$observed_memory" == "$memory" ]] && memory_verified=true
  [[ "$observed_cpu" == "$cpu" ]] && cpu_verified=true
  [[ "$observed_pids" == "$pids" ]] && pids_verified=true
  if [[ "$healthy" == true && "$next_observed" == "$enabled" &&
      "$memory_verified" == true && "$cpu_verified" == true && "$pids_verified" == true ]]; then
    media_worker_control_write_status success "$revision" "$revision" "$enabled" "$next_observed" \
      "$request_id" "$memory" "$observed_memory" true "$cpu" "$observed_cpu" true \
      "$pids" "$observed_pids" true
    rm -f "$active"
    return 0
  fi
  # Roll back the previous optional-worker resources only, best-effort.
  media_worker_control_apply_config "$before_profiles" "$before_memory" "$before_cpu" "$before_pids" || true
  if [[ "$was_running" == true ]]; then
    docker compose --profile media-worker --env-file "$ENV_PATH" -f "$COMPOSE_PATH" \
      up -d --no-deps --force-recreate media-worker >/dev/null 2>&1 || true
  else
    docker compose --profile media-worker --env-file "$ENV_PATH" -f "$COMPOSE_PATH" \
      stop media-worker >/dev/null 2>&1 || true
  fi
  next_observed=false
  if media_worker_running; then next_observed=true; fi
  observed_memory="$(media_worker_observed_memory || true)"
  observed_cpu="$(media_worker_observed_cpu || true)"
  observed_pids="$(media_worker_observed_pids || true)"
  media_worker_control_write_status failed "$revision" "$applied" "$enabled" "$next_observed" \
    "$request_id" "$memory" "$observed_memory" false "$cpu" "$observed_cpu" false \
    "$pids" "$observed_pids" false
  rm -f "$active"
}
# Verify only the operator-configured domain via a TCP connection to
# 127.0.0.1:XD_HTTPS_PORT. Never resolve the hostname or probe a remote URL:
# the domain is used solely for SNI and TLS hostname verification. No output
# from OpenSSL, certificate, hostname, credentials or path enters admin JSON.
caddy_local_tls_state() {
  local domain="$1" port bind raw
  port="$(env_value XD_HTTPS_PORT)"
  [[ -n "$port" ]] || port=8443
  bind="$(env_value XD_HTTPS_BIND)"
  [[ -n "$bind" ]] || bind=0.0.0.0
  # An interface-specific non-loopback binding may be healthy remotely but
  # cannot be validated through 127.0.0.1. Report unknown, NOT a TLS failure.
  case "$bind" in
    0.0.0.0|127.0.0.1) ;;
    *) printf 'unavailable\n'; return ;;
  esac
  # Strict ASCII FQDN (no localhost/IP literals, flags, wildcards, URLs or
  # shell metacharacters) and a validated host-local TCP port.
  if (( ${#domain} > 253 )) ||
      [[ ! "$domain" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$ ]] ||
      [[ ! "$domain" =~ \.[A-Za-z][A-Za-z0-9-]*$ ]] ||
      [[ ! "$port" =~ ^[1-9][0-9]{0,4}$ ]] || (( port > 65535 )); then
    printf 'invalid-config\n'
    return
  fi
  if ! command -v openssl >/dev/null 2>&1 ||
      ! command -v timeout >/dev/null 2>&1; then
    printf 'unavailable\n'
    return
  fi
  if raw="$(timeout 5s openssl s_client -connect "127.0.0.1:$port" \
      -servername "$domain" -verify_hostname "$domain" -verify_return_error \
      -brief </dev/null 2>&1)" && [[ "$raw" == *"Verification: OK"* ]]; then
    printf 'verified\n'
  else
    printf 'failed\n'
  fi
}

# Fixed-container HTTP health and independent loopback TLS chain/host proof.
# "verified" never asserts external DNS, firewall or public reachability.
caddy_host_refresh() {
  local dir tmp observed domain state=unknown https_configured=false tls_state=disabled
  domain="$(env_value XD_DOMAIN)"
  if [[ -n "$domain" ]]; then
    https_configured=true
    tls_state=unavailable
  fi
  observed=""
  if [[ -f "$COMPOSE_PATH" && -f "$ENV_PATH" ]]; then
    observed="$(timeout 3s docker inspect \
      --format '{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}' \
      xdrive-caddy 2>/dev/null || true)"
  fi
  case "$observed" in
    "true|healthy") state=healthy ;;
    "true|unhealthy") state=unhealthy ;;
    "true|starting") state=starting ;;
    "true|") state=running-unverified ;;
    false\|*) state=stopped ;;
    *) state=unknown ;;
  esac
  if [[ "$https_configured" == true && "$state" == healthy ]]; then
    tls_state="$(caddy_local_tls_state "$domain")"
  fi
  dir="$(prepare_dir)"
  tmp="$(mktemp "$dir/.caddy-runtime.XXXXXX")" || return 1
  printf '{"state":"%s","https_configured":%s,"tls_check_supported":true,"tls_state":"%s"}\n' \
    "$state" "$https_configured" "$tls_state" > "$tmp"
  chmod 0660 "$tmp"
  mv -f "$tmp" "$dir/caddy-runtime-status.json"
}
serve_cmd() {
  [[ $# -eq 0 ]] || { echo "usage: server-control.sh serve" >&2; return 2; }
  local dir pid_file existing lock_dir="" source channel interrupted_backup_file_data
  local storage_inventory_interval last_storage_inventory_at last_caddy_observation_at now
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

  # An interrupted media activation is never acknowledged after a runner crash.
  if [[ -f "$dir/media-worker-control-active.json" ]]; then
    rm -f "$dir/media-worker-control-active.json"
    media_worker_control_refresh
    local status_file="$dir/media-worker-control-status.json"
    local rev="$(media_worker_control_uint "$status_file" revision)"
    local applied="$(media_worker_control_uint "$status_file" applied_revision)"
    local enabled="$(json_bool_value "$status_file" enabled)"
    local observed=false
    if media_worker_running; then observed=true; fi
    [[ "$rev" =~ ^[0-9]+$ ]] || rev=0
    [[ "$applied" =~ ^[0-9]+$ ]] || applied=0
    [[ "$enabled" == true ]] || enabled=false
    media_worker_control_write_status failed "$rev" "$applied" "$enabled" "$observed" ""
  fi

  # Publish liveness before any externally visible idle/recovery status. This
  # prevents API/UI consumers from observing a ready-looking status while the
  # host-control heartbeat is still absent during startup.
  touch_heartbeat

  if [[ -f "$dir/active.json" ]]; then
    interrupted_source="$(json_value "$dir/active.json" source)"
    interrupted_channel="$(json_value "$dir/active.json" channel)"
    interrupted_request_id="$(json_value "$dir/active.json" request_id)"
    interrupted_backup_file_data="$(json_bool_value "$dir/active.json" backup_file_data)"
    [[ "$interrupted_backup_file_data" == "true" ]] || interrupted_backup_file_data=false
    case "$interrupted_source" in github|gitlab) ;; *) interrupted_source=github ;; esac
    case "$interrupted_channel" in stable|master) ;; *) interrupted_channel=stable ;; esac
    write_status failed "$interrupted_source" "$interrupted_channel" "$interrupted_request_id" \
      "更新中断" 0 9 0 0 "检测到上次服务端更新被宿主机重启或 runner 中断。" \
      "host update interrupted before completion" "" "$(now_utc)" "$interrupted_backup_file_data"
    rm -f "$dir/active.json" "$dir/install-progress.env"
  fi

  source="$(env_value XD_UPDATE_SOURCE)"
  channel="$(env_value XD_RELEASE_CHANNEL)"
  case "$source" in github|gitlab) ;; *) source=github ;; esac
  case "$channel" in stable|master) ;; *) channel=stable ;; esac
  if [[ ! -f "$dir/status.json" ]]; then
    write_status idle "$source" "$channel" "" "" 0 9 0 0 "等待管理员发起服务端更新。" "" "" ""
  fi

  storage_inventory_interval="$(env_value XD_STORAGE_INVENTORY_INTERVAL_SECONDS)"
  [[ "$storage_inventory_interval" =~ ^[0-9]+$ ]] || storage_inventory_interval=300
  (( storage_inventory_interval >= 30 )) || storage_inventory_interval=30
  refresh_storage_host_inventory || true
  media_worker_control_refresh
  caddy_host_refresh || true
  last_storage_inventory_at="$(date +%s)"
  last_caddy_observation_at="$last_storage_inventory_at"

  while true; do
    touch_heartbeat
    [[ -f "$dir/request.json" ]] && process_request
    [[ -f "$dir/media-worker-control-request.json" ]] && media_worker_control_process
    media_worker_control_refresh
    now="$(date +%s)"
    if (( now - last_caddy_observation_at >= 15 )); then
      caddy_host_refresh || true
      last_caddy_observation_at="$now"
    fi
    if (( now - last_storage_inventory_at >= storage_inventory_interval )); then
      refresh_storage_host_inventory || true
      last_storage_inventory_at="$now"
    fi
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

if [[ "${XD_HOST_CONTROL_SOURCE_ONLY:-0}" == "1" ]]; then
  return 0
fi

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
