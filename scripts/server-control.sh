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

# Read-only host-side proof of the configured RFC1918 IP HTTPS listener.
# A local Caddy CA root never enters the Server/shared status directory.
caddy_valid_private_lan_ip() {
  local ip="$1" a b c d octet
  [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  IFS=. read -r a b c d <<< "$ip"
  for octet in "$a" "$b" "$c" "$d"; do
    [[ "$octet" =~ ^(0|[1-9][0-9]{0,2})$ ]] || return 1
    (( 10#$octet <= 255 )) || return 1
  done
  (( a == 10 || (a == 172 && b >= 16 && b <= 31) ||
      (a == 192 && b == 168) ))
}

caddy_local_lan_tls_state() {
  local ip="$1" port bind cert response bytes status=unavailable
  if ! caddy_valid_private_lan_ip "$ip"; then
    printf 'invalid-config\n'
    return
  fi
  port="$(env_value XD_HTTPS_PORT)"
  [[ -n "$port" ]] || port=8443
  bind="$(env_value XD_HTTPS_BIND)"
  [[ -n "$bind" ]] || bind=0.0.0.0
  if [[ ! "$port" =~ ^[1-9][0-9]{0,4}$ ]] || (( port > 65535 )); then
    printf 'invalid-config\n'
    return
  fi
  # Only test an RFC1918 address assigned to THIS Linux host.
  if [[ "$bind" != 0.0.0.0 && "$bind" != "$ip" ]] ||
      ! command -v ip >/dev/null 2>&1 ||
      ! ip -o -4 addr show | awk -v wanted="$ip" \
          '{split($4,addr,"/"); if (addr[1] == wanted) seen=1} END {exit !seen}'; then
    printf 'unavailable\n'
    return
  fi
  if ! command -v curl >/dev/null 2>&1 ||
      ! command -v timeout >/dev/null 2>&1 ||
      ! command -v python3 >/dev/null 2>&1; then
    printf 'unavailable\n'
    return
  fi
  cert="$(mktemp /tmp/xdrive-caddy-lan-root.XXXXXX)" || {
    printf 'unavailable\n'
    return
  }
  response="$(mktemp /tmp/xdrive-caddy-lan-ready.XXXXXX)" || {
    rm -f -- "$cert"
    printf 'unavailable\n'
    return
  }
  chmod 0600 "$cert" "$response"
  # The CA is temporary host-private input, never an admin JSON or download.
  if timeout 4s docker exec xdrive-caddy cat \
      /data/caddy/pki/authorities/local/root.crt > "$cert" 2>/dev/null; then
    bytes="$(wc -c < "$cert" | tr -d ' ')"
    if [[ "$bytes" =~ ^[0-9]+$ ]] && (( bytes >= 256 && bytes <= 8192 )); then
      status=failed
      if timeout 8s curl -fsS --noproxy '*' --cacert "$cert" \
          --connect-timeout 3 --max-time 6 --max-filesize 1024 \
          --output "$response" "https://$ip:$port/api/v1/readyz" >/dev/null 2>&1 &&
          python3 -c 'import json,sys; v=json.load(sys.stdin); sys.exit(0 if isinstance(v,dict) and v.get("ok") is True else 1)' \
              < "$response" >/dev/null 2>&1; then
        status=verified
      fi
    fi
  fi
  rm -f -- "$cert" "$response"
  printf '%s\n' "$status"
}

# Compare the fixed running xdrive-caddy container's *startup* XD_DOMAIN
# with the SNI whose chain and hostname passed the local loopback TLS probe.
# Docker's server-side template outputs ONLY the XD_DOMAIN entry; it never
# serializes the full Env array containing AliDNS credentials.
# Missing, duplicate, malformed or unreadable entries fail closed.
# This is NOT proof of Caddy's active configuration or admin-applied revision.
caddy_container_runtime_tls_alignment() {
  local sni_domain="$1" runtime_entry runtime_domain
  if ! runtime_entry="$(timeout 3s docker inspect --format \
      '{{range .Config.Env}}{{if eq (index (split . "=") 0) "XD_DOMAIN"}}{{println .}}{{end}}{{end}}' \
      xdrive-caddy 2>/dev/null)"; then
    printf 'unverified\n'
    return
  fi
  [[ "$runtime_entry" == XD_DOMAIN=* ]] || { printf 'unverified\n'; return; }
  runtime_domain="${runtime_entry#XD_DOMAIN=}"
  # One plain ASCII FQDN only: reject CR/LF, duplicate XD_DOMAIN entries,
  # literal equals signs, shell tokens, IP addresses and malformed labels.
  if (( ${#runtime_domain} > 253 )) ||
      [[ ! "$runtime_domain" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$ ]] ||
      [[ ! "$runtime_domain" =~ \.[A-Za-z][A-Za-z0-9-]*$ ]]; then
    printf 'unverified\n'
    return
  fi
  if [[ "${runtime_domain,,}" == "${sni_domain,,}" ]]; then
    printf 'matched-local\n'
  else
    printf 'mismatch-local\n'
  fi
}

# Locally observe the *in-memory* configuration returned by the fixed Caddy
# admin API. wget's raw JSON (which can include DNS provider credentials)
# stays INSIDE xdrive-caddy and streams directly into sha256sum there. Only a
# digest ever crosses the Docker exec/Host Manager boundary. Never expose the
# Caddy admin API on the host/public interface or treat this as applied revision.
# Missing/disabled admin API, unreadable JSON, empty response and errors yield
# no digest. Both the Docker target and in-container URL are literal constants.
caddy_live_active_config_sha256() {
  local raw digest
  if ! raw="$(timeout 4s docker exec xdrive-caddy /bin/sh -ec \
      'set -o pipefail; wget -q -T 2 -O - http://127.0.0.1:2019/config/ | sha256sum' \
      2>/dev/null)"; then
    return
  fi
  if [[ "$raw" =~ ^([0-9a-f]{64})[[:space:]]+-$ ]]; then
    digest="${BASH_REMATCH[1]}"
    # sha256(empty) is not a JSON config and must never be a positive probe.
    [[ "$digest" == e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 ]] || printf '%s\n' "$digest"
  fi
}

# Fixed read-only inventory of the optional AliDNS DNS-01 module in the
# RUNNING Caddy binary. Keep every module name inside the container and
# return only a small enum; errors NEVER mean the plugin is absent.
caddy_local_alidns_module_state() {
  local result
  result="$(timeout 4s docker exec xdrive-caddy /bin/sh -ec \
      'modules="$(caddy list-modules --skip-standard 2>/dev/null)" || exit 2; if printf "%s\n" "$modules" | grep -Fxq dns.providers.alidns; then printf "present-local\n"; else code="$?"; [ "$code" -eq 1 ] || exit 2; printf "absent-local\n"; fi' 2>/dev/null)" || { printf 'unverified\n'; return; }
  case "$result" in
    present-local|absent-local) printf '%s\n' "$result" ;;
    *) printf 'unverified\n' ;;
  esac
}

# Fence TLS, Docker startup Env and in-memory Caddy JSON to one fixed,
# healthy container process generation. Compare only immutable Docker ID,
# StartedAt and PID plus healthy/running bits, NEVER full inspect/Env output.
# An unchanged generation is not a Caddy config revision/apply receipt: the
# Caddy process may still reload its in-memory config without restarting.
caddy_container_generation_sample() {
  local sample
  sample="$(timeout 3s docker inspect --format \
      '{{.Id}}|{{.State.StartedAt}}|{{.State.Pid}}|{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}' \
      xdrive-caddy 2>/dev/null)" || return 1
  [[ "$sample" =~ ^[0-9a-f]{64}\|[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+Z-]{9,40}\|[1-9][0-9]{0,7}\|true\|healthy$ ]] || return 1
  printf '%s\n' "$sample"
}

# Fixed-container HTTP health and independent loopback TLS chain/host proof.
# "verified" never asserts external DNS, firewall or public reachability.
caddy_host_refresh() {
  local dir tmp observed domain generation_before="" generation_after="" live_config_before="" live_config_after="" instance_generation_state=unverified alidns_module_state=unverified module_generation_before="" module_generation_after="" state=unknown https_configured=false tls_state=disabled tls_domain_sha256="" runtime_tls_alignment=unverified live_config_sha256=""
  local lan_ip="" lan_https_configured=false lan_tls_state=disabled lan_verified_ip_sha256="" lan_generation_before="" lan_generation_after="" lan_live_before="" lan_live_after=""
  local host_local_generation_sha256="" host_local_live_config_sha256="" local_generation_sample="" local_live_config_sample=""
  domain="$(env_value XD_DOMAIN)"
  lan_ip="$(env_value XD_LAN_HTTPS_IP)"
  if [[ -n "$domain" ]]; then
    https_configured=true
    tls_state=unavailable
  fi
  if [[ -n "$lan_ip" ]]; then
    lan_https_configured=true
    lan_tls_state=unavailable
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
    generation_before="$(caddy_container_generation_sample)" || generation_before=""
    tls_state="$(caddy_local_tls_state "$domain")"
    # The fixed host-configured SNI just passed a real loopback TLS handshake;
    # its lowercase hash is local comparison material, NOT applied revision
    # evidence or public TLS reachability. No raw hostname goes to admin JSON.
    if [[ "$tls_state" == verified ]] && command -v sha256sum >/dev/null 2>&1; then
      tls_domain_sha256="$(printf '%s' "$domain" | LC_ALL=C tr '[:upper:]' '[:lower:]' | sha256sum | awk '{print $1}')" || tls_domain_sha256=""
      [[ "$tls_domain_sha256" =~ ^[0-9a-f]{64}$ ]] || tls_domain_sha256=""
      # Read ONLY the fixed container's startup XD_DOMAIN after verified
      # local TLS. This does not prove an active config or applied revision.
      if [[ -n "$tls_domain_sha256" ]]; then
        # First hash is captured before reading the fixed startup domain.
        # A second hash after that observation detects a mid-window reload.
        live_config_before="$(caddy_live_active_config_sha256)"
        runtime_tls_alignment="$(caddy_container_runtime_tls_alignment "$domain")"
        # Two in-container digest samples, no raw Caddy JSON or credentials.
        # Matching samples still cannot exclude an A-B-A reload in between.
        live_config_after="$(caddy_live_active_config_sha256)"
        generation_after="$(caddy_container_generation_sample)" || generation_after=""
        if [[ -n "$generation_before" && "$generation_before" == "$generation_after" ]]; then
          instance_generation_state=same-instance-local
          if [[ -n "$live_config_before" && "$live_config_before" == "$live_config_after" ]]; then
            live_config_sha256="$live_config_after"
          elif [[ -n "$live_config_before" && -n "$live_config_after" ]]; then
            # Caddy can reload in place without changing container ID/PID.
            # Revoke mixed TLS, startup Env and config evidence when two
            # validated in-memory JSON samples differ during this window.
            tls_state=unavailable
            tls_domain_sha256=""
            runtime_tls_alignment=unverified
            instance_generation_state=unverified
          fi
        else
          # A container/process restart (or inability to prove one generation)
          # invalidates all prior positive local TLS and active-config signals.
          tls_state=unavailable
          tls_domain_sha256=""
          runtime_tls_alignment=unverified
          live_config_sha256=""
        fi
      else
        # A local TLS success without a valid SNI fingerprint cannot bind
        # independent observations to a specific fixed running instance.
        tls_state=unavailable
      fi
    elif [[ "$tls_state" == verified ]]; then
      tls_state=unavailable
    fi
  fi
  # Independent private-IP HTTPS verification, including IP SAN, is kept
  # separate from public-domain TLS. No result is an applied DB revision.
  if [[ "$lan_https_configured" == true && "$state" == healthy ]]; then
    lan_generation_before="$(caddy_container_generation_sample)" || lan_generation_before=""
    lan_live_before="$(caddy_live_active_config_sha256)" || lan_live_before=""
    lan_tls_state="$(caddy_local_lan_tls_state "$lan_ip")"
    lan_live_after="$(caddy_live_active_config_sha256)" || lan_live_after=""
    lan_generation_after="$(caddy_container_generation_sample)" || lan_generation_after=""
    # An in-place Caddy reload can leave Docker's PID and start time intact.
    if [[ -z "$lan_generation_before" ||
          "$lan_generation_before" != "$lan_generation_after" ||
          -z "$lan_live_before" || "$lan_live_before" != "$lan_live_after" ]]; then
      lan_tls_state=unavailable
    elif [[ "$lan_tls_state" == verified ]] && command -v sha256sum >/dev/null 2>&1; then
      lan_verified_ip_sha256="$(printf '%s' "$lan_ip" | sha256sum | awk '{print $1}')" || lan_verified_ip_sha256=""
      if [[ ! "$lan_verified_ip_sha256" =~ ^[0-9a-f]{64}$ ]]; then
        lan_verified_ip_sha256=""
        lan_tls_state=unavailable
      fi
    fi
  fi
  # Do not aggregate two valid TLS observations from different Caddy
  # generations or live configurations into a false-green dual ingress.
  if [[ "$tls_state" == verified && "$lan_tls_state" == verified &&
        ( "$generation_after" != "$lan_generation_before" ||
          -z "$live_config_sha256" || "$live_config_sha256" != "$lan_live_before" ) ]]; then
    tls_state=unavailable
    tls_domain_sha256=""
    runtime_tls_alignment=unverified
    live_config_sha256=""
    instance_generation_state=unverified
    lan_tls_state=unavailable
    lan_verified_ip_sha256=""
  fi
  # AliDNS is optional: observe the binary even if this Caddy serves only
  # HTTP. Fence the fixed read with healthy container generation samples.
  if [[ "$state" == healthy ]]; then
    module_generation_before="$(caddy_container_generation_sample)" || module_generation_before=""
    if [[ -n "$module_generation_before" ]]; then
      alidns_module_state="$(caddy_local_alidns_module_state)"
      module_generation_after="$(caddy_container_generation_sample)" || module_generation_after=""
      if [[ -z "$module_generation_after" || "$module_generation_before" != "$module_generation_after" ]]; then
        alidns_module_state=unverified
      fi
    fi
    # If different container generations are positively observed across the
    # TLS and module probes, revoke the mixed positive evidence.
    if [[ "$instance_generation_state" == same-instance-local &&
          ( ( -n "$module_generation_before" && "$module_generation_before" != "$generation_after" ) ||
            ( -n "$module_generation_after" && "$module_generation_after" != "$module_generation_before" ) ) ]]; then
      tls_state=unavailable
      tls_domain_sha256=""
      runtime_tls_alignment=unverified
      live_config_sha256=""
      instance_generation_state=unverified
      alidns_module_state=unverified
    fi
    if [[ "$lan_tls_state" == verified &&
          ( ( -n "$module_generation_before" && "$module_generation_before" != "$lan_generation_after" ) ||
            ( -n "$module_generation_after" && "$module_generation_after" != "$module_generation_before" ) ) ]]; then
      lan_tls_state=unavailable
      lan_verified_ip_sha256=""
    fi
  fi
  # Reuse only coherent, positive Host-local observations already collected
  # above. This adds NO second Docker/TLS sampling or third-party requests.
  # Neither digest grants a signed Applied Receipt or configuration authority.
  # Both-on requires both entries verified; LAN-only uses its bounded
  # IP-SAN/local-CA observation window.
  if [[ "$state" == healthy &&
        ( "$https_configured" == true || "$lan_https_configured" == true ) &&
        ( "$https_configured" != true ||
          ( "$tls_state" == verified &&
            "$instance_generation_state" == same-instance-local &&
            "$runtime_tls_alignment" == matched-local &&
            "$live_config_sha256" =~ ^[0-9a-f]{64}$ ) ) &&
        ( "$lan_https_configured" != true || "$lan_tls_state" == verified ) ]]; then
    if [[ "$https_configured" == true ]]; then
      local_generation_sample="$generation_after"
      local_live_config_sample="$live_config_sha256"
    elif [[ -n "$lan_generation_before" &&
            "$lan_generation_before" == "$lan_generation_after" &&
            -n "$lan_live_before" && "$lan_live_before" == "$lan_live_after" ]]; then
      local_generation_sample="$lan_generation_after"
      local_live_config_sample="$lan_live_after"
    fi
    if [[ -n "$local_generation_sample" &&
          "$local_live_config_sample" =~ ^[0-9a-f]{64}$ &&
          "$local_live_config_sample" != e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 ]] &&
          command -v sha256sum >/dev/null 2>&1; then
      host_local_generation_sha256="$(printf 'xdrive.caddy.host.local-generation.v1\n%s\n' "$local_generation_sample" |
        sha256sum | awk '{print $1}')" || host_local_generation_sha256=""
      if [[ "$host_local_generation_sha256" =~ ^[0-9a-f]{64}$ ]]; then
        host_local_live_config_sha256="$local_live_config_sample"
      else
        host_local_generation_sha256=""
      fi
    fi
  fi
  dir="$(prepare_dir)"
  tmp="$(mktemp "$dir/.caddy-runtime.XXXXXX")" || return 1
  printf '{"state":"%s","https_configured":%s,"tls_check_supported":true,"tls_state":"%s","tls_verified_domain_sha256":"%s","runtime_tls_alignment":"%s","live_config_sha256":"%s","host_local_generation_sha256":"%s","host_local_live_config_sha256":"%s","instance_generation_state":"%s","alidns_module_state":"%s","lan_https_configured":%s,"lan_tls_state":"%s","lan_verified_ip_sha256":"%s"}\n' \
    "$state" "$https_configured" "$tls_state" "$tls_domain_sha256" "$runtime_tls_alignment" "$live_config_sha256" "$host_local_generation_sha256" "$host_local_live_config_sha256" "$instance_generation_state" "$alidns_module_state" \
    "$lan_https_configured" "$lan_tls_state" "$lan_verified_ip_sha256" > "$tmp"
  chmod 0660 "$tmp"
  mv -f "$tmp" "$dir/caddy-runtime-status.json"
}

# Restricted Photo Intelligence *enable-only* bridge. Never stop/recreate a
# running analyzer or accept a service name, command, image or arbitrary path.


# Optional host-to-model receipt after the existing fixed, audited enable-only
# action. No arbitrary command, destination, Docker control or workload changes.
# The separate operator-only credential travels on stdin, never in process argv.
photo_host_model_ack_at_apply() {
  local revision="$1" request_id="$2" digest="$3"
  local token runtime_dir socket_path pid start_ticks reply=""
  [[ "$revision" =~ ^[1-9][0-9]*$ && ${#revision} -le 19 ]] || return 1
  (( revision < 1152921504606846976 )) || return 1
  [[ "$request_id" =~ ^[0-9a-f]{24}$ && "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1
  [[ -f "$ENV_PATH" && ! -L "$ENV_PATH" ]] || return 1
  [[ "$(grep -c '^XD_PHOTO_HOST_APPLY_TOKEN=' "$ENV_PATH" || true)" == 1 ]] || return 1
  token="$(env_value XD_PHOTO_HOST_APPLY_TOKEN)"
  [[ "$token" =~ ^[0-9a-f]{64}$ ]] || return 1
  runtime_dir="$(env_value XD_PHOTO_FACE_RUNTIME_DIR)"
  [[ -n "$runtime_dir" ]] || runtime_dir="$STATE_DIR/photo-face"
  [[ "$runtime_dir" == /* && "$runtime_dir" != *'/../'* &&
     "$runtime_dir" != *'/./'* && "$runtime_dir" != *'/..' &&
     "$runtime_dir" != *'/.' && "$runtime_dir" != *$'\n'* &&
     "$runtime_dir" != *$'\r'* ]] || return 1
  socket_path="$runtime_dir/photo-face.sock"
  [[ -S "$socket_path" && ! -L "$socket_path" ]] || return 1
  command -v python3 >/dev/null 2>&1 || return 1
  pid="$(timeout 3s docker inspect --format '{{.State.Pid}}' xdrive-photo-face 2>/dev/null || true)"
  [[ "$pid" =~ ^[1-9][0-9]{0,6}$ ]] || return 1
  start_ticks="$(photo_intelligence_proc_start_ticks "$pid")" || return 1
  photo_intelligence_socket_owned_by_pid "$pid" || return 1
  # Before sending the operator secret, the Unix peer must prove it is the
  # very same fixed Docker main PID AND kernel process birth generation.
  # A replaced host socket path must NEVER receive this credential.
  reply="$(printf '%s\n' "$token" | timeout 5s python3 -c '
import http.client
import json
import re
import socket
import struct
import sys

path, pid_text, expected_ticks, revision, request_id, digest = sys.argv[1:]
secret = sys.stdin.readline(80).rstrip("\n")
if not re.fullmatch(r"[0-9a-f]{64}", secret):
    sys.exit(1)

def process_ticks():
    try:
        with open("/proc/" + pid_text + "/stat", "r", encoding="ascii") as stream:
            data = stream.readline(4096)
        fields = data.rsplit(") ", 1)[1].split()
        return fields[19] if len(fields) >= 20 else ""
    except Exception:
        return ""

if process_ticks() != expected_ticks or not expected_ticks:
    sys.exit(1)
payload = json.dumps({
    "request_id": request_id,
    "revision": int(revision),
    "runtime_instance_sha256": digest,
}, separators=(",", ":")).encode("ascii")
expected = {
    "acknowledged": True,
    "revision": int(revision),
    "request_id": request_id,
    "runtime_instance_sha256": digest,
}
try:
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as peer:
        peer.settimeout(3)
        peer.connect(path)
        credentials = peer.getsockopt(
            socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i")
        )
        peer_pid, _, _ = struct.unpack("3i", credentials)
        if peer_pid != int(pid_text) or process_ticks() != expected_ticks:
            sys.exit(1)
        head = (
            "POST /v1/host-apply-ack HTTP/1.1\r\n"
            "Host: localhost\r\n"
            "Connection: close\r\n"
            "Content-Type: application/json\r\n"
            "X-XDrive-Host-Apply-Protocol: 1\r\n"
            + "Authorization: Bearer " + secret + "\r\n"
            + "Content-Length: " + str(len(payload)) + "\r\n\r\n"
        )
        peer.sendall(head.encode("ascii") + payload)
        response = http.client.HTTPResponse(peer)
        response.begin()
        length = response.getheader("Content-Length", "")
        if response.status != 200 or not length.isdecimal() or int(length) > 512:
            sys.exit(1)
        body = response.read(513)
        if len(body) != int(length) or json.loads(body) != expected:
            sys.exit(1)
        if process_ticks() != expected_ticks:
            sys.exit(1)
except Exception:
    sys.exit(1)
print("ACK_OK")
' "$socket_path" "$pid" "$start_ticks" "$revision" "$request_id" "$digest" \
    2>/dev/null)" || return 1
  [[ "$reply" == ACK_OK ]]
}

photo_host_control_uint() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  sed -nE "s/.*\"$key\"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p" "$file" | head -n1
}
photo_host_control_profiles() {
  local profiles="$1" item next=""
  [[ ${#profiles} -le 512 && "$profiles" =~ ^[A-Za-z0-9,_-]*$ ]] || return 1
  local -a items=()
  IFS=',' read -r -a items <<< "$profiles"
  for item in "${items[@]}"; do
    [[ -n "$item" && "$item" != photo-intelligence ]] || continue
    [[ -z "$next" ]] || next+=","
    next+="$item"
  done
  [[ -z "$next" ]] || next+=","
  printf '%s\n' "${next}photo-intelligence"
}
photo_host_control_set_profiles() {
  local profiles="$1" tmp
  [[ ${#profiles} -le 512 && "$profiles" =~ ^[A-Za-z0-9,_-]*$ ]] || return 1
  [[ -f "$ENV_PATH" && ! -L "$ENV_PATH" && -f "$COMPOSE_PATH" ]] || return 1
  tmp="$(mktemp "$CONFIG_DIR/.photo-host-env.XXXXXX")" || return 1
  awk -v profiles="$profiles" '
    /^COMPOSE_PROFILES=/ {
      if (!seen) print "COMPOSE_PROFILES=" profiles
      seen=1; next
    }
    { print }
    END { if (!seen) print "COMPOSE_PROFILES=" profiles }
  ' "$ENV_PATH" > "$tmp" || { rm -f "$tmp"; return 1; }
  chmod 0600 "$tmp"
  mv -f "$tmp" "$ENV_PATH"
}
photo_host_control_probe() {
  local raw=""
  [[ -f "$COMPOSE_PATH" && -f "$ENV_PATH" ]] || { printf 'unknown\n'; return; }
  raw="$(timeout 3s docker inspect \
    --format '{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}' \
    xdrive-photo-face 2>/dev/null || true)"
  case "$raw" in
    'true|healthy') printf 'healthy\n' ;;
    'true|unhealthy') printf 'unhealthy\n' ;;
    'true|starting') printf 'starting\n' ;;
    'true|') printf 'running-unverified\n' ;;
    false\|*) printf 'stopped\n' ;;
    *) printf 'unknown\n' ;;
  esac
}
photo_host_control_write_status() {
  local state="$1" revision="$2" applied="$3" enabled="$4" request_id="$5"
  local observed="$6" verified="$7" applied_instance_digest="${8:-}" model_ack_at_apply="${9:-false}" dir tmp
  case "$state" in idle|queued|running|success|failed) ;; *) state=failed ;; esac
  case "$observed" in healthy|unhealthy|starting|running-unverified|stopped|unknown) ;;
    *) observed=unknown ;;
  esac
  [[ "$revision" =~ ^[0-9]+$ && ${#revision} -le 19 ]] || revision=0
  [[ "$applied" =~ ^[0-9]+$ && ${#applied} -le 19 ]] || applied=0
  [[ "$enabled" == true ]] || enabled=false
  [[ "$verified" == true ]] || verified=false
  [[ "$request_id" =~ ^[0-9a-f]{24}$ ]] || request_id=""
  if [[ "$state" != success || "$observed" != healthy || "$verified" != true ||
        ! "$applied_instance_digest" =~ ^[0-9a-f]{64}$ ]]; then
    applied_instance_digest=""
  fi
  if [[ "$state" != success || ! "$applied_instance_digest" =~ ^[0-9a-f]{64}$ ||
        ! "$request_id" =~ ^[0-9a-f]{24}$ || "$model_ack_at_apply" != true ]]; then
    model_ack_at_apply=false
  fi
  dir="$(prepare_dir)"
  tmp="$(mktemp "$dir/.photo-host-control-status.XXXXXX")" || return 1
  printf '{"supported":true,"state":"%s","revision":%s,"applied_revision":%s,"enabled":%s,"profile_verified":%s,"observed_host_state":"%s","request_id":"%s","applied_instance_digest":"%s","model_ack_at_apply":%s,"updated_at":"%s"}\n' \
    "$state" "$revision" "$applied" "$enabled" "$verified" "$observed" \
    "$request_id" "$applied_instance_digest" "$model_ack_at_apply" "$(now_utc)" > "$tmp"
  chmod 0660 "$tmp"
  mv -f "$tmp" "$dir/photo-host-control-status.json"
}
photo_host_control_refresh() {
  local dir file state revision applied enabled request_id profile observed verified=false applied_instance_digest="" model_ack_at_apply=false
  dir="$(prepare_dir)"
  file="$dir/photo-host-control-status.json"
  observed="$(photo_host_control_probe)"
  profile="$(env_value COMPOSE_PROFILES)"
  case ",$profile," in *,photo-intelligence,*) verified=true ;; esac
  if [[ ! -f "$file" ]]; then
    photo_host_control_write_status idle 0 0 false "" "$observed" "$verified"
    return
  fi
  state="$(json_value "$file" state)"
  revision="$(photo_host_control_uint "$file" revision)"
  applied="$(photo_host_control_uint "$file" applied_revision)"
  enabled="$(json_bool_value "$file" enabled)"
  request_id="$(json_value "$file" request_id)"
  applied_instance_digest="$(json_value "$file" applied_instance_digest)"
  model_ack_at_apply="$(json_bool_value "$file" model_ack_at_apply)"
  case "$state" in idle|queued|running|success|failed) ;; *) state=failed ;; esac
  [[ "$revision" =~ ^[0-9]+$ && ${#revision} -le 19 ]] || revision=0
  [[ "$applied" =~ ^[0-9]+$ && ${#applied} -le 19 ]] || applied=0
  if [[ "$state" == success && ( "$observed" != healthy || "$verified" != true ) ]]; then
    state=failed
  fi
  photo_host_control_write_status "$state" "$revision" "$applied" "$enabled" \
    "$request_id" "$observed" "$verified" "$applied_instance_digest" "$model_ack_at_apply"
}
photo_host_control_recover() {
  local dir recovery previous before_running
  dir="$(prepare_dir)"
  recovery="$dir/photo-host-control-recovery"
  [[ -f "$recovery" && ! -L "$recovery" ]] || return 0
  previous="$(head -n1 "$recovery" | tr -d '\r')"
  before_running="$(sed -n '2p' "$recovery" | tr -d '\r')"
  [[ "$previous" =~ ^[A-Za-z0-9,_-]*$ && ${#previous} -le 512 ]] || return 1
  [[ "$before_running" == true || "$before_running" == false ]] || return 1
  photo_host_control_set_profiles "$previous" || return 1
  if [[ "$before_running" == false ]]; then
    timeout 20s docker compose --profile photo-intelligence --env-file "$ENV_PATH" \
      -f "$COMPOSE_PATH" stop photo-face >/dev/null 2>&1 || true
  fi
  rm -f "$recovery"
}
photo_host_control_process() {
  local dir request active status request_id revision enabled created_at applied last_state
  local previous next initial current verified=false launched=false applied_instance_digest="" model_ack_at_apply=false
  dir="$(prepare_dir)"
  request="$dir/photo-host-control-request.json"
  active="$dir/photo-host-control-active.json"
  status="$dir/photo-host-control-status.json"
  [[ -f "$request" && ! -L "$request" ]] || return 0
  [[ "$(wc -c < "$request")" -le 512 ]] || { rm -f "$request"; return 0; }
  if ! mv "$request" "$active" 2>/dev/null; then return 0; fi
  request_id="$(json_value "$active" request_id)"
  revision="$(photo_host_control_uint "$active" revision)"
  enabled="$(json_bool_value "$active" enabled)"
  created_at="$(json_value "$active" created_at)"
  applied="$(photo_host_control_uint "$status" applied_revision)"
  last_state="$(json_value "$status" state)"
  [[ "$applied" =~ ^[0-9]+$ && ${#applied} -le 19 ]] || applied=0
  initial="$(photo_host_control_probe)"
  # A disabled request is always rejected: no global active-job drain exists.
  if [[ ! "$request_id" =~ ^[0-9a-f]{24}$ || ! "$revision" =~ ^[1-9][0-9]*$ ||
        ${#revision} -gt 19 || "$revision" -ge 1152921504606846976 ||
        "$enabled" != true || "$revision" -lt "$applied" ||
        ( "$revision" -eq "$applied" && "$last_state" != failed ) ]] ||
        ! request_time_is_fresh "$created_at"; then
    photo_host_control_write_status failed "$applied" "$applied" false "" "$initial" false
    rm -f "$active"
    return 0
  fi
  previous="$(env_value COMPOSE_PROFILES)"
  if ! next="$(photo_host_control_profiles "$previous")" ||
      [[ "$initial" != healthy && "$initial" != stopped ]] ||
      ! timeout 10s docker info >/dev/null 2>&1 ||
      ! timeout 10s docker compose --profile photo-intelligence --env-file "$ENV_PATH" \
        -f "$COMPOSE_PATH" config --quiet >/dev/null 2>&1; then
    photo_host_control_write_status failed "$revision" "$applied" true "$request_id" "$initial" false
    rm -f "$active"
    return 0
  fi
  # A previous interrupted transaction must be recovered explicitly first.
  if [[ -e "$dir/photo-host-control-recovery" ]]; then
    photo_host_control_write_status failed "$revision" "$applied" true "$request_id" "$initial" false
    rm -f "$active"
    return 0
  fi
  photo_host_control_write_status running "$revision" "$applied" true "$request_id" "$initial" false
  printf '%s\n%s\n' "$previous" \
    "$([[ "$initial" == healthy ]] && echo true || echo false)" \
    > "$dir/photo-host-control-recovery"
  chmod 0600 "$dir/photo-host-control-recovery"
  if photo_host_control_set_profiles "$next"; then
    if [[ "$initial" == healthy ]]; then
      launched=true
    elif timeout 25s docker compose --profile photo-intelligence --env-file "$ENV_PATH" \
        -f "$COMPOSE_PATH" up -d --no-deps photo-face >/dev/null 2>&1; then
      for _ in $(seq 1 20); do
        touch_heartbeat
        if [[ "$(photo_host_control_probe)" == healthy ]]; then launched=true; break; fi
        sleep 1
      done
    fi
  fi
  current="$(photo_host_control_probe)"
  case ",$(env_value COMPOSE_PROFILES)," in *,photo-intelligence,*) verified=true ;; esac
  if [[ "$launched" == true && "$current" == healthy && "$verified" == true ]]; then
    # Seal the observed model generation only at THIS audited fixed-host
    # request's successful completion. Later health refresh cannot re-seal a
    # replacement model process as if it were this original revision.
    # Rootless/proc denial is not permission to escalate or restart.
    if photo_intelligence_socket_owner_observed; then
      applied_instance_digest="$(photo_intelligence_healthcheck_digest)"
      if [[ "$applied_instance_digest" =~ ^[0-9a-f]{64}$ ]] &&
          photo_host_model_ack_at_apply "$revision" "$request_id" "$applied_instance_digest" &&
          photo_intelligence_socket_owner_observed &&
          [[ "$(photo_intelligence_healthcheck_digest)" == "$applied_instance_digest" ]]; then
        model_ack_at_apply=true
      fi
    fi
    [[ "$applied_instance_digest" =~ ^[0-9a-f]{64}$ ]] || applied_instance_digest=""
    rm -f "$dir/photo-host-control-recovery"
    photo_host_control_write_status success "$revision" "$revision" true "$request_id" "$current" true "$applied_instance_digest" "$model_ack_at_apply"
    rm -f "$active"
    return 0
  fi
  # Revert only newly started optional photo-face and former profile scalar.
  photo_host_control_recover || true
  photo_host_control_write_status failed "$revision" "$applied" true "$request_id" \
    "$(photo_host_control_probe)" false
  rm -f "$active"
}

# Fixed-container Photo Intelligence Host Manager observation only.
# Profile presence is *deployment intent*, while Docker inspect reports only
# the existing xdrive-photo-face process/health. Neither proves model Info health
# nor authorizes a container start, stop, restart or arbitrary Docker action.
# Only the fixed photo-face container's recent Docker-recorded healthcheck.
# A matching hash shows shared-socket healthcheck agreement, NOT authenticated
# OS-level process ownership or a model task completion.
photo_intelligence_healthcheck_digest() {
  local raw latest observed_at epoch now delta digest=""
  [[ -f "$COMPOSE_PATH" && -f "$ENV_PATH" ]] || return 0
  raw="$(timeout 3s docker inspect --format '{{range .State.Health.Log}}{{printf "%v|%v|%s\n" .End .ExitCode .Output}}{{end}}' xdrive-photo-face 2>/dev/null || true)"
  [[ -n "$raw" && ${#raw} -le 4096 ]] || return 0
  latest="${raw##*$'\n'}"
  [[ "$latest" =~ ^([^|]+)\|0\|XD_PHOTO_INSTANCE_SHA256=([0-9a-f]{64})$ ]] || return 0
  observed_at="${BASH_REMATCH[1]}"
  digest="${BASH_REMATCH[2]}"
  epoch="$(date -u -d "$observed_at" +%s 2>/dev/null || true)"
  [[ "$epoch" =~ ^[0-9]+$ ]] || return 0
  now="$(date -u +%s)"
  delta=$((now - epoch))
  (( delta >= -15 && delta <= 90 )) || return 0
  printf '%s\n' "$digest"
}

# Kernel-only evidence for the fixed photo-face process and Unix listener.
# proc_root is passed ONLY by local synthetic tests; production uses /proc.
photo_intelligence_proc_start_ticks() {
  local pid="$1" proc_root="${2:-/proc}" line rest
  local -a fields
  [[ "$pid" =~ ^[1-9][0-9]{0,6}$ ]] || return 1
  IFS= read -r line < "$proc_root/$pid/stat" || return 1
  rest="${line##*) }"
  [[ "$rest" != "$line" ]] || return 1
  read -r -a fields <<< "$rest"
  [[ ${#fields[@]} -ge 20 && "${fields[19]}" =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s\n' "${fields[19]}"
}
photo_intelligence_socket_owned_by_pid() {
  local pid="$1" proc_root="${2:-/proc}" before after inode fd target
  local count=0 found=false
  [[ "$pid" =~ ^[1-9][0-9]{0,6}$ ]] || return 1
  before="$(photo_intelligence_proc_start_ticks "$pid" "$proc_root")" || return 1
  [[ -d "$proc_root/$pid/fd" && -r "$proc_root/$pid/net/unix" ]] || return 1
  inode="$(timeout 2s awk '
    $4 == "00010000" && $5 == "0001" && $7 ~ /^[1-9][0-9]*$/ &&
    $8 == "/run/xdrive-photo-face/photo-face.sock" { print $7 }
  ' "$proc_root/$pid/net/unix" 2>/dev/null)" || return 1
  [[ "$inode" =~ ^[1-9][0-9]*$ ]] || return 1
  for fd in "$proc_root/$pid/fd/"*; do
    [[ -L "$fd" ]] || continue
    count=$((count + 1))
    (( count <= 512 )) || return 1
    target="$(readlink -- "$fd" 2>/dev/null || true)"
    if [[ "$target" == "socket:[$inode]" ]]; then
      found=true
      break
    fi
  done
  [[ "$found" == true ]] || return 1
  after="$(photo_intelligence_proc_start_ticks "$pid" "$proc_root")" || return 1
  [[ "$before" == "$after" ]]
}
photo_intelligence_socket_owner_observed() {
  local pid=""
  [[ -f "$COMPOSE_PATH" && -f "$ENV_PATH" ]] || return 1
  pid="$(timeout 3s docker inspect --format '{{.State.Pid}}' xdrive-photo-face 2>/dev/null || true)"
  photo_intelligence_socket_owned_by_pid "$pid"
}

photo_intelligence_host_refresh() {
  local dir tmp profile observed="" state=unknown profile_configured=false session_digest="" socket_owner_verified=false
  profile="$(env_value COMPOSE_PROFILES)"
  case ",$profile," in
    *,photo-intelligence,*) profile_configured=true ;;
  esac
  if [[ -f "$COMPOSE_PATH" && -f "$ENV_PATH" ]]; then
    observed="$(timeout 3s docker inspect \
      --format '{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}' \
      xdrive-photo-face 2>/dev/null || true)"
  fi
  case "$observed" in
    "true|healthy") state=healthy ;;
    "true|unhealthy") state=unhealthy ;;
    "true|starting") state=starting ;;
    "true|") state=running-unverified ;;
    false\|*) state=stopped ;;
    *) state=unknown ;;
  esac
  if [[ "$state" == healthy ]]; then
    session_digest="$(photo_intelligence_healthcheck_digest)"
    if photo_intelligence_socket_owner_observed; then
      socket_owner_verified=true
    fi
  fi
  [[ "$session_digest" =~ ^[0-9a-f]{64}$ ]] || session_digest=""
  dir="$(prepare_dir)"
  tmp="$(mktemp "$dir/.photo-intelligence-runtime.XXXXXX")" || return 1
  printf '{"state":"%s","profile_configured":%s,"healthcheck_session_digest":"%s","socket_owner_verified":%s}\n' \
    "$state" "$profile_configured" "$session_digest" "$socket_owner_verified" > "$tmp"
  chmod 0660 "$tmp"
  mv -f "$tmp" "$dir/photo-intelligence-runtime-status.json"
}


# A running Bash process keeps the code loaded when it was started. An
# upgrade installs a NEW server-control.sh but does not replace an existing
# long-running Host Control daemon (which may be processing an update).
# The fixed SHA marker is ONLY a read-only source-identity hint. It never
# authorizes a Host action, grants a session or exposes secret material.
caddy_host_control_script_sha() {
  local digest
  [[ -f "$BIN_DIR/server-control.sh" && ! -L "$BIN_DIR/server-control.sh" ]] || return 1
  digest="$(sha256sum "$BIN_DIR/server-control.sh" 2>/dev/null | awk '{print $1}')" || return 1
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s\n' "$digest"
}

caddy_host_control_current_runner() {
  local dir="$1" pid="$2" sha marker
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  sha="$(caddy_host_control_script_sha)" || return 1
  marker="$(cat "$dir/caddy-runner-source.sha" 2>/dev/null)" || return 1
  [[ "$marker" == "$pid|$sha" ]]
}

caddy_host_control_mark_runner() {
  local dir="$1" sha tmp
  sha="$(caddy_host_control_script_sha)" || return 1
  tmp="$(mktemp "$dir/.caddy-runner-source.XXXXXX")" || return 1
  if ! printf '%s|%s\n' "$BASHPID" "$sha" > "$tmp" ||
      ! chmod 0660 "$tmp" ||
      ! mv -f "$tmp" "$dir/caddy-runner-source.sha"; then
    rm -f -- "$tmp"
    return 1
  fi
}

# A source-matched Host Control runner is NOT proof of a usable Caddy snapshot.
# A long-running updater can keep the code marker current while not sampling.
# This hint is scoped to a fixed sanitized file; it grants no Host control.
caddy_host_snapshot_fresh() {
  local dir="$1" snapshot modified now
  snapshot="$dir/caddy-runtime-status.json"
  [[ -f "$snapshot" && ! -L "$snapshot" ]] || return 1
  modified="$(stat -c %Y -- "$snapshot" 2>/dev/null)" || return 1
  now="$(date +%s)" || return 1
  [[ "$modified" =~ ^[0-9]{1,12}$ && "$now" =~ ^[0-9]{1,12}$ ]] || return 1
  # Match the Server's 45s freshness and 15s future-clock tolerance.
  (( modified >= now - 45 && modified <= now + 15 ))
}

# Host .env authority requires its OWN fresh fixed-name observation. A live
# gateway snapshot is not evidence that the desired HTTPS/AliDNS configuration
# is available to the Server after an older Host Runner survived an upgrade.
caddy_host_env_snapshot_fresh() {
  local dir="$1" snapshot modified now
  snapshot="$dir/caddy-env-observed.json"
  [[ -f "$snapshot" && ! -L "$snapshot" ]] || return 1
  modified="$(stat -c %Y -- "$snapshot" 2>/dev/null)" || return 1
  now="$(date +%s)" || return 1
  [[ "$modified" =~ ^[0-9]{1,12}$ && "$now" =~ ^[0-9]{1,12}$ ]] || return 1
  (( modified >= now - 45 && modified <= now + 15 ))
}

# The main runner, not the compatibility observer, writes this source-bound
# pulse ONLY after its own fixed Caddy snapshot sampler has returned.
# No pulse authorizes gateway actions or marks an admin revision applied.
caddy_host_control_mark_main_sample() {
  local dir="$1" sha marker tmp
  sha="$(caddy_host_control_script_sha)" || return 1
  marker="$(cat "$dir/caddy-runner-source.sha" 2>/dev/null)" || return 1
  [[ "$marker" == "$BASHPID|$sha" ]] || return 1
  tmp="$(mktemp "$dir/.caddy-main-sample.XXXXXX")" || return 1
  if ! printf '%s|%s|%s\n' "$BASHPID" "$sha" "$(date +%s%N)" > "$tmp" ||
      ! chmod 0660 "$tmp" || ! mv -f "$tmp" "$dir/caddy-main-sample.sha"; then
    rm -f -- "$tmp"
    return 1
  fi
}

# A new/fresh snapshot written by the observer is NOT evidence that the main
# runner has resumed polling. Require a NEW pulse since observer ownership.
caddy_host_control_main_sample_since() {
  local dir="$1" pid="$2" baseline="$3" sha pulse
  caddy_host_control_current_runner "$dir" "$pid" || return 1
  sha="$(caddy_host_control_script_sha)" || return 1
  pulse="$(cat "$dir/caddy-main-sample.sha" 2>/dev/null)" || return 1
  local expected="$pid|$sha|" stamp
  [[ "$pulse" != "$baseline" && "$pulse" == "$expected"* ]] || return 1
  stamp="${pulse#"$expected"}"
  [[ "$stamp" =~ ^[0-9]{16,20}$ ]]
}

# The read-only observer also restores missing/stale snapshots from a
# same-source runner which is temporarily unable to sample the gateway.
# This separate observer was originally needed when an older Host Control runner
# is still alive after a script upgrade. It never calls Compose up/down,
# restarts Caddy, edits .env, reveals credentials or consumes Host Pending.
# flock guarantees at most one supplemental Caddy-only observer.
# Four-field Caddy .env authority is a HOST-only operation, not a generic
# Docker/env manipulation API. No password or whole .env is published here.
caddy_env_refresh() {
  local dir tmp
  dir="$(prepare_dir)"
  [[ -f "$BIN_DIR/caddy-env-config.py" ]] || return 1
  tmp="$(mktemp "$dir/.caddy-env-observed.XXXXXX")" || return 1
  if XD_CONFIG_DIR="$XDRIVE_HOME" python3 "$BIN_DIR/caddy-env-config.py" snapshot > "$tmp" 2>/dev/null; then
    chmod 0660 "$tmp"
    mv -f "$tmp" "$dir/caddy-env-observed.json"
  else
    rm -f "$tmp" "$dir/caddy-env-observed.json"
    return 1
  fi
}

# Fixed host request, only "save" and the private "commit/restore" transitions.
# User input NEVER specifies the .env path, script path or Docker arguments.

# Verify a single Host-local Caddy runtime generation across the fixed
# Ready, domain TLS and LAN TLS probes. The Docker instance and in-memory
# Caddy JSON must BOTH remain unchanged; even in-place reloads fail closed.
# This is local proof within the install.lock deployment window, never a
# signed Applied Receipt or external WAN/CA/client trust assertion.
caddy_env_verify_local_runtime_window() {
  local domain="$1" lan="$2" before_generation="" after_generation=""
  local before_live="" after_live="" generation_digest=""
  # These are Host-process-only outputs, never browser/Server inputs.
  # Clear on every call so a failed recheck cannot reuse a prior generation.
  CADDY_LOCAL_WINDOW_GENERATION_SHA256=""
  CADDY_LOCAL_WINDOW_LIVE_SHA256=""
  before_generation="$(caddy_container_generation_sample)" || return 1
  before_live="$(caddy_live_active_config_sha256)" || return 1
  [[ -n "$before_generation" && -n "$before_live" ]] || return 1
  timeout 5s docker exec xdrive-caddy wget -q -O /dev/null \
    http://127.0.0.1/api/v1/readyz >/dev/null 2>&1 || return 1
  if [[ -n "$domain" && "$(caddy_local_tls_state "$domain")" != verified ]]; then
    return 1
  fi
  if [[ -n "$lan" && "$(caddy_local_lan_tls_state "$lan")" != verified ]]; then
    return 1
  fi
  after_live="$(caddy_live_active_config_sha256)" || return 1
  after_generation="$(caddy_container_generation_sample)" || return 1
  if [[ -z "$after_live" || -z "$after_generation" ||
        "$before_generation" != "$after_generation" ||
        "$before_live" != "$after_live" ]]; then
    return 1
  fi
  # Domain separate the fixed five-field Docker runtime identity. The
  # underlying container ID/start/PID and raw Caddy JSON never leave Host.
  generation_digest="$(printf 'xdrive.caddy.host.local-generation.v1\n%s\n' "$before_generation" |
    sha256sum | awk '{print $1}')" || return 1
  [[ "$generation_digest" =~ ^[0-9a-f]{64}$ &&
     "$before_live" =~ ^[0-9a-f]{64}$ ]] || return 1
  CADDY_LOCAL_WINDOW_GENERATION_SHA256="$generation_digest"
  CADDY_LOCAL_WINDOW_LIVE_SHA256="$before_live"
}

# A bounded Caddy-only recreate is a separate, administrator-audited request.
# It does not run "compose down", restart other services, install images or
# accept browser-selected commands. The Host retains a private running baseline.
caddy_env_deploy() {
  local id="$1" active="$2" result_file="$3" dir snapshot expected observed pending
  local domain lan ready=0 previous=0 attempt request
  dir="$(prepare_dir)"
  expected="$(json_value "$active" expected_sha256)"
  [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || return 1

  # Serialize before the snapshot: an installer-held lock is a retryable busy
  # receipt, not an unclassified snapshot/deploy-refused error.
  exec 6>"$STATE_DIR/install.lock"
  if ! flock -n 6; then
    exec 6>&-
    printf '{"protocol":"xdrive.caddy.host-env.v1","state":"failed","request_id":"%s","sha256":"%s","rolled_back":false,"error":"installer-busy"}\n' \
      "$id" "$expected" > "$result_file"
    return 0
  fi

  # Reuse the Host's same open-file-description; taking a second snapshot
  # lock in Python would conflict with our own exclusive install lock.
  snapshot="$(mktemp "$dir/.caddy-deploy-before.XXXXXX")" || {
    flock -u 6
    exec 6>&-
    return 1
  }
  if ! XD_CONFIG_DIR="$XDRIVE_HOME" XD_CADDY_INSTALL_LOCK_INHERITED_FD=6 \
      python3 "$BIN_DIR/caddy-env-config.py" snapshot > "$snapshot" 2>/dev/null; then
    rm -f "$snapshot"
    flock -u 6
    exec 6>&-
    return 1
  fi
  observed="$(json_value "$snapshot" sha256)"
  pending="$(json_bool_value "$snapshot" pending_redeploy)"
  rm -f "$snapshot"
  if [[ "$expected" != "$observed" || "$pending" != true ]]; then
    flock -u 6
    exec 6>&-
    return 1
  fi

  # The initial receipt is a durable task state, NOT deployment success.
  request="$(mktemp "$dir/.caddy-deploy-progress.XXXXXX")" || {
    flock -u 6
    exec 6>&-
    return 1
  }
  printf '{"protocol":"xdrive.caddy.host-env.v1","state":"deploying","request_id":"%s","sha256":"%s"}\n' \
    "$id" "$expected" > "$request"
  chmod 0660 "$request"
  mv -f "$request" "$dir/caddy-env-result.json"

  # Hold the same install lock across ONLY the Caddy recreate, checks and
  # config commit/rollback; never restart the entire Compose application.
  if timeout 180s docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" \
      up -d --no-deps --force-recreate caddy >/dev/null 2>&1; then
      for attempt in $(seq 1 30); do
        touch_heartbeat
        domain="$(env_value XD_DOMAIN)"
        lan="$(env_value XD_LAN_HTTPS_IP)"
        if caddy_env_verify_local_runtime_window "$domain" "$lan"; then
          ready=1
          break
        fi
        sleep 2
      done
    fi
  # Keep install.lock until the Host journal is committed or restored. A
  # concurrent upgrade must not adopt an uncommitted candidate in this gap.
  if (( ready == 1 )) &&
      [[ "$CADDY_LOCAL_WINDOW_GENERATION_SHA256" =~ ^[0-9a-f]{64}$ &&
         "$CADDY_LOCAL_WINDOW_LIVE_SHA256" =~ ^[0-9a-f]{64}$ ]]; then
    # Persist this precise request + local runtime witness IN THE SAME
    # immutable Host success decision as the .env SHA. It is historical
    # Host-local evidence, NOT a signed/current Applied Receipt.
    if printf '{"operation":"commit","request_id":"%s","expected_sha256":"%s","host_local_generation_sha256":"%s","host_local_live_config_sha256":"%s"}\n' \
        "$id" "$expected" "$CADDY_LOCAL_WINDOW_GENERATION_SHA256" "$CADDY_LOCAL_WINDOW_LIVE_SHA256" |
        XD_CONFIG_DIR="$XDRIVE_HOME" XD_CADDY_INSTALL_LOCK_INHERITED_FD=6 \
          XD_CADDY_DEPLOY_RECEIPT_DIR="$dir" XD_CADDY_COMMIT_DURABLE=1 \
          python3 "$BIN_DIR/caddy-env-config.py" commit > /dev/null 2>&1; then
      flock -u 6
      exec 6>&-
      printf '{"protocol":"xdrive.caddy.host-env.v1","state":"deployed","request_id":"%s","sha256":"%s"}\n' \
        "$id" "$expected" > "$result_file"
      return 0
    fi
    # A lost Python ACK or SIGKILL after durable commit publication must
    # NEVER roll back an already committed target. Reconcile only the exact
    # immutable success receipt while still holding the installer lock.
    if [[ -e "$dir/caddy-deploy-results/$id.json" ||
          -L "$dir/caddy-deploy-results/$id.json" ]]; then
      if printf '{"operation":"reconcile-commit","request_id":"%s","expected_sha256":"%s"}\n' "$id" "$expected" |
          XD_CONFIG_DIR="$XDRIVE_HOME" XD_CADDY_INSTALL_LOCK_INHERITED_FD=6 \
            XD_CADDY_DEPLOY_RECEIPT_DIR="$dir" \
            python3 "$BIN_DIR/caddy-env-config.py" reconcile-commit >/dev/null 2>&1; then
        flock -u 6
        exec 6>&-
        printf '{"protocol":"xdrive.caddy.host-env.v1","state":"deployed","request_id":"%s","sha256":"%s"}\n' \
          "$id" "$expected" > "$result_file"
        return 0
      fi
      # Ambiguous committed state: never restore, delete active, or invent
      # a successful terminal if durable reconciliation cannot be proved.
      flock -u 6
      exec 6>&-
      return 2
    fi
  fi

  # A failed start, probe or finalization must NEVER claim success. Restore
  # only the four Caddy fields; never roll back unrelated .env credentials.
  if printf '{"operation":"restore","request_id":"%s","expected_sha256":"%s"}\n' "$id" "$expected" |
      XD_CONFIG_DIR="$XDRIVE_HOME" XD_CADDY_INSTALL_LOCK_INHERITED_FD=6 \
        python3 "$BIN_DIR/caddy-env-config.py" restore > /dev/null 2>&1; then
    if timeout 180s docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" \
        up -d --no-deps --force-recreate caddy >/dev/null 2>&1; then
      domain="$(env_value XD_DOMAIN)"
      lan="$(env_value XD_LAN_HTTPS_IP)"
      if caddy_env_verify_local_runtime_window "$domain" "$lan"; then
        previous=1
      fi
    fi
  fi
  flock -u 6
  exec 6>&-
  printf '{"protocol":"xdrive.caddy.host-env.v1","state":"failed","request_id":"%s","sha256":"%s","rolled_back":%s,"error":"caddy-deploy-or-verify-failed"}\n' \
    "$id" "$expected" "$([[ "$previous" == 1 ]] && printf true || printf false)" > "$result_file"
  return 0
}

# Secret response is private, one-time, and forcibly reaped after 30s.
# It never enters status.json, Caddy runtime snapshots or standard logs.
caddy_env_reap_secret_result() {
  local file="$1" now="$2" modified
  if [[ -L "$file" ]]; then rm -f -- "$file"; return 0; fi
  [[ -f "$file" ]] || return 0
  modified="$(stat -c %Y -- "$file" 2>/dev/null)" || return 0
  if [[ "$modified" =~ ^[0-9]+$ ]] && (( now - modified >= 30 )); then
    rm -f -- "$file"
  fi
}

# Terminal statuses are per-request, bounded and contain no secrets. The
# legacy one-slot result remains available for older Server/Agent versions.
caddy_env_archive_final() {
  local dir="$1" file="$2"
  [[ -f "$file" && ! -L "$file" ]] || return 1
  XD_CADDY_DEPLOY_RECEIPT_DIR="$dir" \
    python3 "$BIN_DIR/caddy-env-config.py" archive-deploy < "$file" >/dev/null 2>&1
}

caddy_env_process() {
  local dir request active result operation request_id created_at expected tmp
  dir="$(prepare_dir)"
  request="$dir/caddy-env-request.json"
  active="$dir/caddy-env-active.json"
  result="$dir/caddy-env-result.json"
  # Shared kernel flock + no-follow fixed-name promotion makes
  # Server publication and Host queue->Active admission one transaction.
  # The helper never follows a path supplied by the browser.
  [[ -f "$BIN_DIR/caddy-admission.py" && ! -L "$BIN_DIR/caddy-admission.py" ]] || return 0
  if ! XD_CADDY_CONTROL_DIR="$dir" python3 "$BIN_DIR/caddy-admission.py" claim >/dev/null 2>&1; then
    return 0
  fi
  rm -f -- "$dir/caddy-env-secret-result.json"
  operation="$(json_value "$active" operation)"
  request_id="$(json_value "$active" request_id)"
  created_at="$(json_value "$active" created_at)"
  expected="$(json_value "$active" expected_sha256)"
  [[ "$request_id" =~ ^[0-9a-f]{24}$ ]] || request_id=""
  tmp="$(mktemp "$dir/.caddy-env-result.XXXXXX")" || return 1
  if [[ -n "$request_id" && "$operation" == deploy ]] && request_time_is_fresh "$created_at"; then
    if caddy_env_deploy "$request_id" "$active" "$tmp"; then
      :
    else
      local deploy_rc="$?"
      if [[ "$deploy_rc" == 2 ]]; then
        # The durable success decision exists, but recovery is unresolved.
        # Preserve the active slot without terminating the Host sampling
        # loop. A restarted Host may finish the exact durable decision safely.
        rm -f -- "$tmp"
        return 0
      fi
      if [[ "$expected" =~ ^[0-9a-f]{64}$ ]]; then
        printf '{"protocol":"xdrive.caddy.host-env.v1","state":"failed","request_id":"%s","sha256":"%s","error":"deploy-refused"}\n' "$request_id" "$expected" > "$tmp"
      else
        printf '{"state":"failed","request_id":"%s","error":"invalid-deploy"}\n' "$request_id" > "$tmp"
      fi
    fi
  elif [[ -n "$request_id" && "$operation" == reveal && "$expected" =~ ^[0-9a-f]{64}$ ]] &&
      request_time_is_fresh "$created_at" &&
      XD_CONFIG_DIR="$XDRIVE_HOME" python3 "$BIN_DIR/caddy-env-config.py" reveal \
      < "$active" > "$tmp" 2>/dev/null; then
    chmod 0660 "$tmp"
    mv -f "$tmp" "$dir/caddy-env-secret-result.json"
    printf '{"protocol":"xdrive.caddy.host-env.v1","state":"revealed","request_id":"%s","sha256":"%s"}\n' \
      "$request_id" "$expected" > "$tmp"
  elif [[ -n "$request_id" && ( "$operation" == save || "$operation" == commit || "$operation" == restore ) ]] &&
      request_time_is_fresh "$created_at" &&
      XD_CONFIG_DIR="$XDRIVE_HOME" python3 "$BIN_DIR/caddy-env-config.py" "$operation" \
      < "$active" > "$tmp" 2>/dev/null; then
    :
  else
    # Do not echo raw JSON, .env values, provider error text or request payload.
    printf '{"state":"failed","request_id":"%s","error":"host-env-operation-failed"}\n' "$request_id" > "$tmp"
  fi
  # Restored .env bytes are NOT evidence the previous gateway is running.
  # A failed old-Caddy recreate / TLS/Ready check must retain the exact
  # active deployment as a durable Host fence until trusted recovery.
  if [[ "$operation" != deploy ||
        "$(json_value "$tmp" state)" != failed ||
        "$(json_value "$tmp" error)" != caddy-deploy-or-verify-failed ||
        "$(json_bool_value "$tmp" rolled_back)" == true ]]; then
    rm -f "$active"
  fi
  # Publish the new non-secret Host projection BEFORE acknowledging Save.
  # Otherwise immediate UI reload could still read the previous .env digest
  # even though the mutation response already said "saved".
  if [[ "$operation" == deploy &&
        ( "$(json_value "$tmp" error)" == installer-busy ||
          "$(json_value "$tmp" state)" == deployed ) ]]; then
    # Busy refusal cannot snapshot under installer.lock. A completed deploy
    # already published a durable terminal BEFORE its Host journal cleanup;
    # snapshot failure must never overwrite either trustworthy terminal.
    # The ordinary sampler will reconcile runtime observations afterwards.
    caddy_env_refresh || true
    # A server upgrade owns install.lock, so Python snapshot must fail closed.
    # The busy deploy did not alter .env or Caddy. Do not overwrite its
    # trustworthy, fixed error code with host-env-observation-unavailable.
    # The prior projection may remain stale until the upgrade releases the
    # installer lock and Host Control resumes normal sampling.
    :
  elif ! caddy_env_refresh; then
    # The file may have changed even when observation fails. Do not fabricate
    # success: callers must reconcile the actual Host state before retry.
    printf '{"state":"failed","request_id":"%s","error":"host-env-observation-unavailable"}\n' \
      "$request_id" > "$tmp"
  fi
  if [[ "$operation" == deploy && "$request_id" =~ ^[0-9a-f]{24}$ &&
        "$(json_value "$tmp" state)" != deployed ]]; then
    # Successful Deploy was archived atomically INSIDE Python commit before
    # removing the rollback journal; never overwrite its O_EXCL decision.
    if ! caddy_env_archive_final "$dir" "$tmp"; then
      # This operation may have physically completed, but must NOT pretend
      # its per-request terminal receipt was durably archived.
      echo "xDrive Caddy terminal receipt archive unavailable" >&2
    fi
  fi
  chmod 0660 "$tmp"
  mv -f "$tmp" "$result"
}


# Recovery is ONLY for an interrupted authorized fixed Caddy transaction.
# Never replay the candidate. Restore last private Host baseline and verify the
# old ingress before clearing the sticky active slot. Unknown state stays fenced.
caddy_env_recover_interrupted() {
  local dir="$1" active operation request_id expected domain lan recovered=false
  active="$dir/caddy-env-active.json"
  [[ -e "$active" ]] || return 0
  [[ -f "$active" && ! -L "$active" ]] || return 1
  operation="$(json_value "$active" operation)"
  request_id="$(json_value "$active" request_id)"
  expected="$(json_value "$active" expected_sha256)"
  [[ "$request_id" =~ ^[0-9a-f]{24}$ ]] || request_id=""
  # A saved .env may be valid after a lost Save ACK. Do not undo it or replay
  # credentials; the fresh snapshot determines whether it is still pending.
  if [[ "$operation" == save || "$operation" == reveal ]]; then
    rm -f -- "$active" "$dir/caddy-env-secret-result.json"
    caddy_env_refresh || true
    return 0
  fi
  if [[ "$operation" != deploy || -z "$request_id" || ! "$expected" =~ ^[0-9a-f]{64}$ ]]; then
    # Malformed or ambiguous active records cannot authorize Host effects.
    return 1
  fi
  # The installer lock must cover *both* restoring the pinned .env and
  # recreating Caddy. An updater cannot interleave between these two effects.
  exec 6>"$STATE_DIR/install.lock"
  if flock -n 6; then
    # A physical commit can outlive its shell process. If Python durably
    # published the precise SUCCESS decision before crashing during cleanup,
    # finish the cleanup rather than restoring the old running configuration.
    if [[ -e "$dir/caddy-deploy-results/$request_id.json" ||
          -L "$dir/caddy-deploy-results/$request_id.json" ]]; then
      if printf '{"operation":"reconcile-commit","request_id":"%s","expected_sha256":"%s"}\n' "$request_id" "$expected" |
          XD_CONFIG_DIR="$XDRIVE_HOME" XD_CADDY_INSTALL_LOCK_INHERITED_FD=6 \
            XD_CADDY_DEPLOY_RECEIPT_DIR="$dir" \
            python3 "$BIN_DIR/caddy-env-config.py" reconcile-commit >/dev/null 2>&1; then
        local terminal
        terminal="$(mktemp "$dir/.caddy-committed-recovery.XXXXXX")" || return 1
        printf '{"protocol":"xdrive.caddy.host-env.v1","state":"deployed","request_id":"%s","sha256":"%s"}\n' \
          "$request_id" "$expected" > "$terminal"
        chmod 0660 "$terminal"
        mv -f "$terminal" "$dir/caddy-env-result.json"
        rm -f -- "$active"
        flock -u 6
        exec 6>&-
        caddy_env_refresh || true
        return 0
      fi
      # A conflicting or unreadable success receipt is UNCERTAIN. Preserve
      # the active slot and never silently roll back a committed candidate.
      flock -u 6
      exec 6>&-
      return 1
    fi
    if printf '{"operation":"restore","request_id":"%s","expected_sha256":"%s"}\n' "$request_id" "$expected" |
        XD_CONFIG_DIR="$XDRIVE_HOME" XD_CADDY_INSTALL_LOCK_INHERITED_FD=6 \
          python3 "$BIN_DIR/caddy-env-config.py" restore > /dev/null 2>&1; then
      if timeout 180s docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" \
          up -d --no-deps --force-recreate caddy >/dev/null 2>&1; then
        domain="$(env_value XD_DOMAIN)"
        lan="$(env_value XD_LAN_HTTPS_IP)"
        # After an interrupted Host transaction, restored .env bytes or a
        # one-off TLS success cannot attest the old running Caddy. Use the
        # same bounded Docker generation + Live Config window as ordinary
        # Caddy-only rollback; missing/changing evidence stays fenced.
        if caddy_env_verify_local_runtime_window "$domain" "$lan"; then
          recovered=true
        fi
      fi
    fi
    flock -u 6
  fi
  exec 6>&-
  local temp
  temp="$(mktemp "$dir/.caddy-interrupted-status.XXXXXX")" || return 1
  printf '{"protocol":"xdrive.caddy.host-env.v1","state":"failed","request_id":"%s","sha256":"%s","rolled_back":%s,"error":"interrupted-deploy"}\n' \
    "$request_id" "$expected" "$recovered" > "$temp"
  chmod 0660 "$temp"
  mv -f "$temp" "$dir/caddy-env-result.json"
  if [[ "$recovered" == true ]]; then
    # Only persist recovery as terminal after the old ingress is verified.
    # Unresolved active operations may still be reconciled on next startup.
    if ! caddy_env_archive_final "$dir" "$dir/caddy-env-result.json"; then
      echo "xDrive Caddy recovered terminal receipt archive unavailable" >&2
    fi
    rm -f -- "$active"
    caddy_env_refresh || true
    return 0
  fi
  # Keep unresolved active slot to block later Save/Deploy attempts.
  return 1
}

caddy_compat_observe_cmd() {
  [[ $# -eq 0 ]] || { echo "usage: server-control.sh caddy-observe" >&2; return 2; }
  local dir sha current pid i main_pulse_at_entry
  command -v flock >/dev/null 2>&1 || return 1
  dir="$(prepare_dir)"
  sha="$(caddy_host_control_script_sha)" || return 1
  exec 7>"$dir/caddy-observer.lock"
  flock -n 7 || return 0
  printf '%s\n' "$BASHPID" > "$dir/caddy-observer.pid"
  chmod 0660 "$dir/caddy-observer.pid"
  # EXIT runs after local variables leave scope; retain only a private
  # observer PID-file path, never paths/credentials from Caddy.
  CADDY_OBSERVER_PID_FILE="$dir/caddy-observer.pid"
  trap 'if [[ -n "${CADDY_OBSERVER_PID_FILE:-}" && "$(cat "$CADDY_OBSERVER_PID_FILE" 2>/dev/null || true)" == "$BASHPID" ]]; then rm -f -- "$CADDY_OBSERVER_PID_FILE"; fi' EXIT
  trap 'exit 0' INT TERM
  main_pulse_at_entry="$(cat "$dir/caddy-main-sample.sha" 2>/dev/null || true)"
  while true; do
    [[ ! -e "$dir/caddy-observer-stop" ]] || return 0
    current="$(caddy_host_control_script_sha)" || current=""
    if [[ "$current" != "$sha" ]]; then
      # The installed source changed again during an upgrade. Release our
      # own lock before loading the newest read-only observation logic.
      flock -u 7
      exec env XD_CONFIG_DIR="$XDRIVE_HOME" "$BIN_DIR/server-control.sh" caddy-observe
    fi
    pid="$(cat "$dir/runner.pid" 2>/dev/null || true)"
    if [[ "$pid" =~ ^[1-9][0-9]*$ ]] && kill -0 "$pid" 2>/dev/null &&
        caddy_host_control_main_sample_since "$dir" "$pid" "$main_pulse_at_entry" &&
        caddy_host_snapshot_fresh "$dir" &&
        caddy_host_env_snapshot_fresh "$dir"; then
      return 0
    fi
    # A pre-upgrade long-lived Bash runner may still publish the gateway's
    # heartbeat/runtime snapshot but not the newly required Host .env snapshot.
    # Read only the fixed four-key Host state through the restricted parser.
    # Its output is sanitized; neither the whole .env nor keys reach the bridge.
    if ! caddy_env_refresh; then
      echo "xDrive Caddy host .env read-only observation unavailable" >&2
    fi
    if ! caddy_host_refresh; then
      # The original snapshot reader will remain fail-closed. Do not emit
      # raw Docker/openssl/curl output, private paths, domain or credentials.
      echo "xDrive Caddy read-only observation unavailable" >&2
    fi
    [[ "${XD_CADDY_OBSERVER_ONCE:-0}" != 1 ]] || return 0
    for i in {1..15}; do
      [[ ! -e "$dir/caddy-observer-stop" ]] || return 0
      sleep 1
    done
  done
}

# Explicit privileged Host-local operator recovery. This is deliberately
# NEVER a Server/Agent/browser route and is not called by the Watchdog.
# It resolves Sticky Active only after a fresh physical SAME-generation
# check against restored host .env, with a separate immutable local record.
caddy_rescue_manual() (
  [[ $# -eq 2 && "$2" == --confirm && "$1" =~ ^[0-9a-f]{24}$ ]] || return 2
  local id="$1" dir active archived original expected snapshot current
  local before after domain lan
  dir="$(prepare_dir)"
  active="$dir/caddy-env-active.json"
  archived="$dir/caddy-deploy-results/$id.json"
  # Admission excludes other Server publishers while investigating and
  # releasing the fence. The installer lock excludes upgrade/Deploy.
  [[ -f "$active" && ! -L "$active" &&
     -f "$archived" && ! -L "$archived" ]] || return 1
  # The shared Host bridge is writable by Server replicas. Never truncate
  # a planted symlink while taking the rescue lock; open an existing
  # regular inode read-only, then bind the held FD to the current pathname.
  [[ -f "$dir/caddy-env-admission.lock" &&
     ! -L "$dir/caddy-env-admission.lock" ]] || return 1
  exec 5<"$dir/caddy-env-admission.lock" || return 1
  flock -n 5 || return 1
  local admission_inode
  admission_inode="$(stat -Lc '%d:%i' /proc/self/fd/5)" || return 1
  [[ "$admission_inode" == "$(stat -c '%d:%i' "$dir/caddy-env-admission.lock")" ]] || return 1
  exec 6>"$STATE_DIR/install.lock"
  flock -n 6 || return 1
  [[ -f "$active" && ! -L "$active" &&
     "$(json_value "$active" operation)" == deploy &&
     "$(json_value "$active" request_id)" == "$id" &&
     "$(json_value "$archived" request_id)" == "$id" &&
     "$(json_value "$archived" state)" == failed ]] || return 1
  expected="$(json_value "$active" expected_sha256)"
  [[ "$expected" =~ ^[0-9a-f]{64}$ &&
     "$expected" == "$(json_value "$archived" sha256)" ]] || return 1
  case "$(json_value "$archived" error)" in
    interrupted-deploy|caddy-deploy-or-verify-failed) ;;
    *) return 1 ;;
  esac
  [[ "$(json_bool_value "$archived" rolled_back)" != true ]] || return 1
  # No unknown pending write, preserved original rollback file or new queue
  # may be bypassed by a manual rescue request.
  [[ ! -e "$STATE_DIR/caddy-env/pending.json" &&
     ! -L "$STATE_DIR/caddy-env/pending.json" &&
     ! -e "$STATE_DIR/caddy-env/previous.env" &&
     ! -L "$STATE_DIR/caddy-env/previous.env" &&
     ! -e "$dir/caddy-env-request.json" &&
     ! -L "$dir/caddy-env-request.json" ]] || return 1
  snapshot="$(mktemp "$dir/.caddy-rescue-snapshot.XXXXXX")" || return 1
  if ! XD_CONFIG_DIR="$XDRIVE_HOME" XD_CADDY_INSTALL_LOCK_INHERITED_FD=6 \
      python3 "$BIN_DIR/caddy-env-config.py" snapshot > "$snapshot" 2>/dev/null; then
    rm -f -- "$snapshot"
    return 1
  fi
  [[ "$(json_bool_value "$snapshot" pending_redeploy)" != true ]] || {
    rm -f -- "$snapshot"
    return 1
  }
  original="$(json_value "$snapshot" sha256)"
  rm -f -- "$snapshot"
  [[ "$original" =~ ^[0-9a-f]{64}$ && "$original" != "$expected" ]] || return 1
  domain="$(env_value XD_DOMAIN)"
  lan="$(env_value XD_LAN_HTTPS_IP)"
  [[ -n "$domain" || -n "$lan" ]] || return 1
  caddy_env_verify_local_runtime_window "$domain" "$lan" || return 1
  before="$CADDY_LOCAL_WINDOW_GENERATION_SHA256"
  after="$CADDY_LOCAL_WINDOW_LIVE_SHA256"
  [[ "$before" =~ ^[0-9a-f]{64}$ && "$after" =~ ^[0-9a-f]{64}$ ]] || return 1
  if [[ -n "$domain" &&
        "$(caddy_container_runtime_tls_alignment "$domain")" != matched-local ]]; then
    return 1
  fi
  # Recheck .env+original Request ID while both trusted locks are held.
  snapshot="$(mktemp "$dir/.caddy-rescue-recheck.XXXXXX")" || return 1
  if ! XD_CONFIG_DIR="$XDRIVE_HOME" XD_CADDY_INSTALL_LOCK_INHERITED_FD=6 \
      python3 "$BIN_DIR/caddy-env-config.py" snapshot > "$snapshot" 2>/dev/null; then
    rm -f -- "$snapshot"
    return 1
  fi
  current="$(json_value "$snapshot" sha256)"
  [[ "$current" == "$original" &&
     "$(json_bool_value "$snapshot" pending_redeploy)" != true &&
     "$(json_value "$active" request_id)" == "$id" ]] || {
    rm -f -- "$snapshot"
    return 1
  }
  rm -f -- "$snapshot"
  # The original failure remains immutable and visible; record a separate
  # fixed nonsecret Host-local operator rescue event BEFORE clearing Active.
  # Both journal publication and fence deletion are fsynced, no overwrite.
  XD_CADDY_RESCUE_DIR="$dir" \
  XD_CADDY_RESCUE_ID="$id" XD_CADDY_RESCUE_FAILED_SHA="$expected" \
  XD_CADDY_RESCUE_CURRENT_SHA="$original" \
  XD_CADDY_RESCUE_GENERATION_SHA="$before" \
  XD_CADDY_RESCUE_CONFIG_SHA="$after" \
  python3 - <<'PY_RESCUE'
import json, os, stat, sys, secrets
from pathlib import Path
try:
    root = Path(os.environ["XD_CADDY_RESCUE_DIR"])
    if not root.is_dir() or root.is_symlink():
        raise OSError("unsafe-dir")
    receipts = root / "caddy-rescue-results"
    if receipts.is_symlink():
        raise OSError("unsafe-receipts")
    receipts.mkdir(mode=0o700, exist_ok=True)
    if receipts.stat().st_mode & 0o077:
        raise OSError("bad-mode")
    data = dict(protocol="xdrive.caddy.host-rescue.v1",
                state="recovered-local", request_id=os.environ["XD_CADDY_RESCUE_ID"],
                failed_sha256=os.environ["XD_CADDY_RESCUE_FAILED_SHA"],
                current_sha256=os.environ["XD_CADDY_RESCUE_CURRENT_SHA"],
                host_local_generation_sha256=os.environ["XD_CADDY_RESCUE_GENERATION_SHA"],
                host_local_live_config_sha256=os.environ["XD_CADDY_RESCUE_CONFIG_SHA"])
    folder = os.open(receipts, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        name = data["request_id"] + ".json"
        encoded = (json.dumps(data, sort_keys=True, separators=(",", ":"))+"\n").encode()

        def reconcile_existing():
            # Exactly the SAME immutable Host result may outlive a crash
            # between publication and removal of Sticky Active. Never
            # create another result or accept a mismatched old success.
            st = os.stat(name, dir_fd=folder, follow_symlinks=False)
            if (not stat.S_ISREG(st.st_mode) or st.st_nlink not in (1, 2) or
                    st.st_uid != os.geteuid() or st.st_mode & 0o077 or
                    st.st_size != len(encoded)):
                raise OSError("unsafe-rescue-receipt")
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=folder)
            try:
                pinned = os.fstat(fd)
                if (pinned.st_dev, pinned.st_ino) != (st.st_dev, st.st_ino):
                    raise OSError("changed-rescue-receipt")
                stored = os.read(fd, len(encoded)+1)
            finally:
                os.close(fd)
            if stored != encoded:
                raise OSError("different-rescue-receipt")
            if st.st_nlink == 2:
                # A power loss after link publication can leave its precise
                # Host-owned temporary hardlink. Remove only that sibling.
                prefix = "." + data["request_id"] + ".tmp."
                matched = []
                for candidate in os.listdir(folder):
                    if not candidate.startswith(prefix):
                        continue
                    suffix = candidate[len(prefix):]
                    if len(suffix) != 16 or any(c not in "0123456789abcdef" for c in suffix):
                        continue
                    member = os.stat(candidate, dir_fd=folder, follow_symlinks=False)
                    if ((member.st_dev, member.st_ino) == (st.st_dev, st.st_ino)
                            and stat.S_ISREG(member.st_mode)):
                        matched.append(candidate)
                if len(matched) != 1:
                    raise OSError("unrecognized-rescue-link")
                os.unlink(matched[0], dir_fd=folder)
                os.fsync(folder)

        try:
            reconcile_existing()
        except FileNotFoundError:
            # Exact one-time, durable first publication. An old unmatched
            # or forged record is NEVER overwritten or silently repaired.
            temp = f".{data['request_id']}.tmp.{secrets.token_hex(8)}"
            fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         0o600, dir_fd=folder)
            try:
                os.write(fd, encoded)
                os.fsync(fd)
            finally:
                os.close(fd)
            os.link(temp, name, src_dir_fd=folder, dst_dir_fd=folder,
                    follow_symlinks=False)
            os.fsync(folder)
            os.unlink(temp, dir_fd=folder)
            os.fsync(folder)
    finally:
        os.close(folder)
except OSError:
    sys.exit(1)
PY_RESCUE
  [[ $? -eq 0 ]] || return 1
  # No shell 'rm Active' after a mere .env restore. Remove only the exact
  # previously verified regular inode, fsyncing the bridge directory.
  # Do not release a fence after another Server replaced the shared
  # admission pathname while this operator held the original FD.
  [[ "$admission_inode" == "$(stat -c '%d:%i' "$dir/caddy-env-admission.lock")" ]] || return 1
  XD_CADDY_RESCUE_DIR="$dir" XD_CADDY_RESCUE_ID="$id" python3 - <<'PY_UNFENCE'
import json, os, stat, sys
try:
    root = os.open(os.environ["XD_CADDY_RESCUE_DIR"],
                   os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fd = os.open("caddy-env-active.json", os.O_RDONLY | os.O_NOFOLLOW,
                     dir_fd=root)
        try:
            s = os.fstat(fd)
            if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or s.st_size > 4096:
                raise OSError("unsafe-active")
            obj = json.loads(os.read(fd, 4097))
            if obj.get("request_id") != os.environ["XD_CADDY_RESCUE_ID"]:
                raise OSError("different-active")
        finally:
            os.close(fd)
        os.unlink("caddy-env-active.json", dir_fd=root)
        os.fsync(root)
    finally:
        os.close(root)
except (OSError, ValueError, json.JSONDecodeError):
    sys.exit(1)
PY_UNFENCE
)

# Independent cron-invoked watcher. This is a SEPARATE process from the Host
# runner and only invokes the existing exact-request recovery ONCE. It cannot
# retry a known failed rollback, clear Sticky Active, or deploy a candidate.
caddy_watchdog_once() {
  [[ $# -eq 0 ]] || return 2
  local dir active id expected receipt archive_state
  command -v flock >/dev/null 2>&1 || return 1
  dir="$(prepare_dir)"
  active="$dir/caddy-env-active.json"
  [[ -f "$active" && ! -L "$active" ]] || return 0
  id="$(json_value "$active" request_id)"
  expected="$(json_value "$active" expected_sha256)"
  [[ "$id" =~ ^[0-9a-f]{24}$ && "$expected" =~ ^[0-9a-f]{64}$ &&
     "$(json_value "$active" operation)" == deploy ]] || return 1
  # The watchdog's own lock belongs in Host-private state, never in
  # the Server-group-writable control bridge.
  [[ -d "$STATE_DIR" && ! -L "$STATE_DIR" &&
     ! -L "$STATE_DIR/caddy-watchdog.lock" ]] || return 1
  exec 7>"$STATE_DIR/caddy-watchdog.lock"
  flock -n 7 || return 0
  # No Watchdog action while the Host runner or an upgrade is alive.
  # A PID file is not a trustworthy process-lifetime proof.
  # The existing runner uses this file for its lifetime. Observe its
  # lock read-only; the watchdog must not create/truncate Host bridge paths.
  [[ -f "$dir/runner.lock" && ! -L "$dir/runner.lock" ]] || return 0
  exec 8<"$dir/runner.lock"
  flock -n 8 || return 0
  exec 4>"$STATE_DIR/install.lock"
  flock -n 4 || return 0
  flock -u 4
  exec 4>&-
  receipt="$dir/caddy-deploy-results/$id.json"
  if [[ -e "$receipt" || -L "$receipt" ]]; then
    [[ -f "$receipt" && ! -L "$receipt" ]] || return 1
    archive_state="$(json_value "$receipt" state)"
    # An immutable FAILED outcome is terminal. Never give it a physical
    # retry even if the Docker mock becomes healthy later.
    [[ "$archive_state" == deployed ]] || return 0
  else
    # Without a precise committed success, normal recovery is permitted
    # only while BOTH original Host rollback journal files remain intact.
    [[ -f "$STATE_DIR/caddy-env/pending.json" &&
       ! -L "$STATE_DIR/caddy-env/pending.json" &&
       -f "$STATE_DIR/caddy-env/previous.env" &&
       ! -L "$STATE_DIR/caddy-env/previous.env" ]] || return 0
  fi
  # Persist one durable, private attempt marker *before* recovery. A crash
  # between publishing it and restoring Caddy remains fenced, never replayed.
  if ! XD_CADDY_WATCHDOG_ID="$id" XD_CADDY_WATCHDOG_STATE="$STATE_DIR" python3 - <<'PY_WATCHDOG'
import os, stat, sys
from pathlib import Path
try:
    root = Path(os.environ["XD_CADDY_WATCHDOG_STATE"])
    if root.is_symlink() or not root.is_dir():
        raise OSError("unsafe-state")
    folder = root / "caddy-watchdog-attempts"
    if folder.is_symlink():
        raise OSError("unsafe-attempts")
    folder.mkdir(mode=0o700, exist_ok=True)
    if folder.stat().st_mode & 0o077:
        raise OSError("untrusted-mode")
    parent = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fd = os.open(os.environ["XD_CADDY_WATCHDOG_ID"],
                     os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=parent)
        try:
            os.write(fd, b"attempted\n")
            os.fsync(fd)
        finally:
            os.close(fd)
        os.fsync(parent)
    finally:
        os.close(parent)
except OSError:
    sys.exit(1)
PY_WATCHDOG
  then
    # Existing/uncertain attempt means NO automatic retry. No unlink.
    return 0
  fi
  # This is the preexisting exact-ID, install.lock-bound recovery path.
  # It validates the private backup/commit journal and the old Caddy
  # generation+Live Config+Ready/TLS, otherwise retains Sticky Active.
  caddy_env_recover_interrupted "$dir" || return 1
}

start_caddy_compat_observer() {
  local dir="$1"
  if ! command -v flock >/dev/null 2>&1; then
    echo "xDrive: Caddy read-only upgrade observer requires flock." >&2
    return 1
  fi
  rm -f -- "$dir/caddy-observer-stop"
  # The ordinary runner owns updates. This subprocess owns only fresh
  # sanitized Caddy observations; neither can terminate the other.
  nohup env XD_CONFIG_DIR="$XDRIVE_HOME" "$BIN_DIR/server-control.sh" caddy-observe \
    >>"$LOG_DIR/caddy-observer.log" 2>&1 </dev/null 9>&- &
  echo "Caddy read-only observer launched for missing/stale Caddy evidence or older Host Control runtime."
}


# Admin Server Backup bridge: fixed Host actions, never a browser-supplied
# shell command, Docker argument, path or arbitrary backup-file mutation.
backup_admin_protocol=xdrive-backup-admin-v1

backup_admin_policy_values() {
  backup_admin_format="$(env_value XD_BACKUP_SCHEDULE_FORMAT)"
  [[ -n "$backup_admin_format" ]] || backup_admin_format=v1
  backup_admin_days="$(env_value XD_BACKUP_RETENTION_DAYS)"
  [[ -n "$backup_admin_days" ]] || backup_admin_days=7
  backup_admin_repo="$(env_value XD_BACKUP_SCHEDULE_REPOSITORY_DIR)"
  [[ "$backup_admin_format" == v1 || "$backup_admin_format" == v2 ]] || return 1
  [[ "$backup_admin_days" =~ ^[0-9]{1,4}$ ]] || return 1
  (( 10#$backup_admin_days <= 3650 )) || return 1
  if [[ -n "$backup_admin_repo" ]]; then
    [[ "$backup_admin_format" == v2 && "$backup_admin_repo" == /* && ! -L "$backup_admin_repo" ]] || return 1
    # Custom directories can be configured before the initial v2 capture.
    if [[ -d "$backup_admin_repo" ]]; then
      backup_admin_repo="$(cd "$backup_admin_repo" && pwd -P)" || return 1
    fi
  fi
  backup_admin_revision="$(printf '%s\0%s\0%s' "$backup_admin_format" "$backup_admin_days" "$backup_admin_repo" | sha256sum | cut -d' ' -f1)"
}

backup_admin_snapshot_directory() {
  local identity="$1" scope name root
  [[ "$identity" =~ ^(v1|v2-default|v2-configured):xdrive-backup-[0-9]{8}T[0-9]{6}Z$ ]] || return 1
  scope="$(printf '%s' "$identity" | cut -d: -f1)"
  name="$(printf '%s' "$identity" | cut -d: -f2)"
  case "$scope" in
    v1) root="$XDRIVE_HOME/backups/snapshots" ;;
    v2-default) root="$XDRIVE_HOME/backups/incremental/snapshots" ;;
    v2-configured)
      backup_admin_policy_values || return 1
      [[ "$backup_admin_format" == v2 && -n "$backup_admin_repo" ]] || return 1
      root="$backup_admin_repo/snapshots" ;;
    *) return 1 ;;
  esac
  [[ -d "$root" && ! -L "$root" && -d "$root/$name" && ! -L "$root/$name" ]] || return 1
  printf '%s\n' "$root/$name"
}

backup_admin_snapshot_complete() {
  local snapshot="$1" format="$2" f
  [[ -d "$snapshot" && ! -L "$snapshot" ]] || return 1
  for f in database.dump verify.json manifest.json SHA256SUMS.txt; do
    [[ -f "$snapshot/$f" && ! -L "$snapshot/$f" ]] || return 1
  done
  if [[ "$format" == v1 ]]; then
    [[ -f "$snapshot/blobs.tar" && ! -L "$snapshot/blobs.tar" ]] ||
      grep -Eq '"file_data_included"[[:space:]]*:[[:space:]]*false' "$snapshot/manifest.json" || return 1
  else
    for f in objects.index legacy.tar; do
      [[ -f "$snapshot/$f" && ! -L "$snapshot/$f" ]] || return 1
    done
  fi
}

# Inspect only the installer's exact managed crontab signature. Never
# publish cron commands, Host paths or arbitrary operator scheduler entries.
# Unknown does not mean disabled: NAS/DSM or systemd schedulers are external.
backup_admin_schedule_status() {
  local configured raw expected state=unknown expression="" managed_count=0
  configured="$(env_value XD_BACKUP_SCHEDULE)"
  if [[ -n "$configured" && ${#configured} -le 80 ]] &&
     { [[ "$configured" =~ ^([0-9*/,-]+[[:space:]]+){4}[0-9*/,-]+$ ]] ||
       [[ "$configured" =~ ^@(hourly|daily|weekly|monthly|yearly)$ ]]; }; then
    expression="$configured"
  fi
  if command -v crontab >/dev/null 2>&1 &&
     raw="$(crontab -l 2>/dev/null)"; then
    managed_count="$(grep -c '# xdrive-managed-backup$' <<< "$raw" || true)"
    [[ "$managed_count" =~ ^[0-9]+$ ]] || managed_count=0
    if [[ -z "$configured" && "$managed_count" == 0 ]]; then
      state=not_configured
    elif [[ -n "$expression" ]]; then
      expected="$(printf '%s XD_CONFIG_DIR=%q %q >> %q 2>&1 # xdrive-managed-backup' \
        "$expression" "$XDRIVE_HOME" "$BIN_DIR/server-backup-scheduled.sh" "$LOG_DIR/backup.log")"
      if [[ "$(grep -Fxc -- "$expected" <<< "$raw" || true)" == 1 &&
            "$managed_count" == 1 ]]; then
        state=registered
      elif (( managed_count > 0 )); then
        state=mismatch
      else
        state=not_detected
      fi
    elif (( managed_count > 0 )); then
      state=mismatch
    fi
  fi
  printf '{"protocol":"xdrive-host-backup-schedule-v1","source":"installer_crontab","state":"%s","expression":"%s"}\n' \
    "$state" "$(json_escape "$expression")"
}

# Publish only bounded, canonical snapshot identities for future authenticated
# read-only Server pagination. Never publish absolute Host paths or claim that
# an indexed generation is complete, SHA-verified or restorable.
backup_admin_snapshot_index() {
  local dir="$1" source="$2" total="$3" revision="$4" temp
  [[ "$total" =~ ^[0-9]{1,7}$ && "$revision" =~ ^[0-9a-f]{64}$ ]] || return 1
  (( total <= 1000000 )) || return 1
  temp="$(mktemp "$dir/.backup-admin-snapshot-page.XXXXXXXX")" || return 1
  if ! python3 - "$source" "$total" "$revision" "$temp" <<'PY'
import datetime,json,os,re,stat,sys
source,total,revision,target=sys.argv[1],int(sys.argv[2]),sys.argv[3],sys.argv[4]
valid_name=re.compile(r"xdrive-backup-[0-9]{8}T[0-9]{6}Z\Z")
scopes={"v1","v2-default","v2-configured"}
try:
    fd=os.open(source,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,"r",encoding="utf-8") as stream:
        st=os.fstat(stream.fileno())
        if not stat.S_ISREG(st.st_mode) or st.st_size>64000000:
            raise ValueError("snapshot index inode is unsafe")
        ids=[]
        last=None
        for i,line in enumerate(stream):
            if i>=1000:
                break
            name,sep,scope=line.rstrip("\n").partition("\t")
            if sep!="\t" or not valid_name.fullmatch(name) or scope not in scopes:
                raise ValueError("noncanonical snapshot identity")
            key=(name,scope)
            if last is not None and not (last>key):
                raise ValueError("unsorted or duplicate snapshot identity")
            last=key
            ids.append(scope+":"+name)
    if len(ids)!=min(total,1000):
        raise ValueError("snapshot index cardinality mismatch")
    # Counts are from the same Host scan used for Admin newest-100 inventory.
    report=dict(protocol="xdrive-backup-snapshot-index-v1",
                generated_at=datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                policy_revision=revision,total_snapshots=total,
                indexed_snapshots=len(ids),truncated=total>len(ids),
                snapshot_ids=ids)
    raw=(json.dumps(report,separators=(",",":"),ensure_ascii=True)+"\n").encode()
    if len(raw)>131072:
        raise ValueError("indexed snapshot page exceeds hard size cap")
    with open(target,"wb") as out:
        out.write(raw)
        out.flush()
        os.fsync(out.fileno())
except (OSError,UnicodeError,ValueError):
    sys.exit(1)
PY
  then
    rm -f -- "$temp"
    return 1
  fi
  chmod 0660 "$temp" &&
    mv -f -- "$temp" "$dir/backup-admin-snapshot-index.json" || {
      rm -f -- "$temp"
      return 1
    }
}

backup_admin_inventory() {
  local dir="$1" tmp comma="" scope root snap name state bytes file_data created
  local snapshot_index inventory_total inventory_truncated
  local repository_v1_count repository_default_count repository_configured_count
  local backup_admin_schedule_json
  local default_repo backup_admin_format backup_admin_days backup_admin_repo backup_admin_revision
  backup_admin_policy_values || return 1
  backup_admin_schedule_json="$(backup_admin_schedule_status)" || return 1
  default_repo="$XDRIVE_HOME/backups/incremental"
  if [[ -d "$default_repo" ]]; then
    default_repo="$(cd "$default_repo" && pwd -P)" || return 1
  fi
  # Only metadata for the newest 100 is materialized; disclose how many
  # additional canonical generations exist without opening a browser path.
  snapshot_index="$(mktemp "$dir/.backup-admin-inventory-index.XXXXXX")" || return 1
  if ! (
      for scope in v1 v2-default v2-configured; do
        case "$scope" in
          v1) root="$XDRIVE_HOME/backups/snapshots" ;;
          v2-default) root="$XDRIVE_HOME/backups/incremental/snapshots" ;;
          v2-configured)
            [[ "$backup_admin_format" == v2 && -n "$backup_admin_repo" &&
               "$backup_admin_repo" != "$default_repo" ]] || continue
            root="$backup_admin_repo/snapshots" ;;
        esac
        [[ -d "$root" && ! -L "$root" ]] || continue
        for snap in "$root"/xdrive-backup-*; do
          [[ -d "$snap" && ! -L "$snap" ]] || continue
          name="$(basename "$snap")"
          [[ "$name" =~ ^xdrive-backup-[0-9]{8}T[0-9]{6}Z$ ]] || continue
          printf '%s\t%s\n' "$name" "$scope"
        done
      done | LC_ALL=C sort -r > "$snapshot_index"
  ); then
    rm -f -- "$snapshot_index"
    return 1
  fi
  inventory_total="$(wc -l < "$snapshot_index")"
  if [[ ! "$inventory_total" =~ ^[0-9]+$ ]] || (( inventory_total > 1000000 )); then
    rm -f -- "$snapshot_index"
    return 1
  fi
  # Count the exact same canonical Host-observed identity index used by the
  # newest-100 inventory; do not infer total repository health or open CAS.
  read -r repository_v1_count repository_default_count repository_configured_count < <(
    awk -F '\t' '
      $2=="v1" {v1++}
      $2=="v2-default" {def++}
      $2=="v2-configured" {custom++}
      END {printf "%d %d %d\n", v1+0, def+0, custom+0}
    ' "$snapshot_index"
  )
  if [[ ! "$repository_v1_count" =~ ^[0-9]+$ ||
        ! "$repository_default_count" =~ ^[0-9]+$ ||
        ! "$repository_configured_count" =~ ^[0-9]+$ ]] ||
     (( repository_v1_count + repository_default_count + repository_configured_count != inventory_total )); then
    rm -f -- "$snapshot_index"
    return 1
  fi
  inventory_truncated=false
  if (( inventory_total > 100 )); then inventory_truncated=true; fi
  tmp="$(mktemp "$dir/.backup-admin-inventory.XXXXXX")" || {
    rm -f -- "$snapshot_index"
    return 1
  }
  {
    printf '{"protocol":"%s","generated_at":"%s","policy":{"schedule_format":"%s","retention_days":%s,"repository":"%s","revision":"%s"},"total_snapshots":%s,"truncated":%s,"repositories":[{"id":"v1","snapshot_count":%s},{"id":"v2-default","snapshot_count":%s},{"id":"v2-configured","snapshot_count":%s}],"schedule":%s,"snapshots":[' \
      "$backup_admin_protocol" "$(now_utc)" "$backup_admin_format" "$backup_admin_days" "$(json_escape "$backup_admin_repo")" "$backup_admin_revision" "$inventory_total" "$inventory_truncated" \
      "$repository_v1_count" "$repository_default_count" "$repository_configured_count" "$backup_admin_schedule_json"

    # Show the latest 100 generations across all configured repositories,
    # not the oldest 100 from the alphabetically first (legacy v1) root.
    while IFS=$'\t' read -r name scope; do
      [[ "$name" =~ ^xdrive-backup-[0-9]{8}T[0-9]{6}Z$ ]] || continue
      case "$scope" in
        v1) root="$XDRIVE_HOME/backups/snapshots" ;;
        v2-default) root="$XDRIVE_HOME/backups/incremental/snapshots" ;;
        v2-configured)
          [[ "$backup_admin_format" == v2 && -n "$backup_admin_repo" ]] || continue
          root="$backup_admin_repo/snapshots" ;;
        *) continue ;;
      esac
      snap="$root/$name"
      [[ -d "$snap" && ! -L "$snap" ]] || continue
      state=complete
      if [[ "$scope" == v1 ]]; then
        backup_admin_snapshot_complete "$snap" v1 || state=incomplete
      else
        backup_admin_snapshot_complete "$snap" v2 || state=incomplete
      fi
      if [[ "$state" == complete ]] &&
         grep -Eq '"consistency_verified"[[:space:]]*:[[:space:]]*false' "$snap/manifest.json" 2>/dev/null; then
        state=inconsistent
      fi
      bytes="$(du -sb -- "$snap" 2>/dev/null | cut -f1 || true)"
      [[ "$bytes" =~ ^[0-9]+$ ]] || bytes=0
      file_data=true
      if [[ "$scope" == v1 ]] &&
         grep -Eq '"file_data_included"[[:space:]]*:[[:space:]]*false' "$snap/manifest.json" 2>/dev/null; then
        file_data=false
      fi
      created="$(printf '%s' "$name" | sed -nE 's/^xdrive-backup-([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z$/\1-\2-\3T\4:\5:\6Z/p')"
      printf '%s{"id":"%s:%s","name":"%s","format":"%s","created_at":"%s","state":"%s","bytes":%s,"file_data_included":%s}' \
        "$comma" "$scope" "$name" "$name" \
        "$([[ "$scope" == v1 ]] && printf v1 || printf v2)" \
        "$created" "$state" "$bytes" "$file_data"
      comma=","
    done < <(sed -n '1,100p' "$snapshot_index")
    printf ']}\n'
  } > "$tmp" || { rm -f -- "$tmp" "$snapshot_index"; return 1; }
  if ! backup_admin_snapshot_index "$dir" "$snapshot_index" "$inventory_total" "$backup_admin_revision"; then
    rm -f -- "$snapshot_index" "$tmp"
    return 1
  fi
  rm -f -- "$snapshot_index"
  chmod 0660 "$tmp" && mv -f "$tmp" "$dir/backup-admin-inventory.json"
}

backup_admin_status() {
  local dir="$1" state="$2" action="$3" request_id="$4" snapshot_id="$5" code="$6" message="$7"
  local started="$8" finished="$9" stage="${10:-}" bytes_done="${11:-0}" bytes_total="${12:-0}" tmp
  [[ "$bytes_done" =~ ^[0-9]{1,15}$ ]] || bytes_done=0
  [[ "$bytes_total" =~ ^[0-9]{1,15}$ ]] || bytes_total=0
  [[ ${#stage} -le 96 ]] || stage=""
  tmp="$(mktemp "$dir/.backup-admin-status.XXXXXX")" || return 1
  printf '{"protocol":"%s","state":"%s","request_id":"%s","action":"%s","snapshot_id":"%s","started_at":"%s","updated_at":"%s","finished_at":"%s","error_code":"%s","message":"%s","stage":"%s","bytes_done":%s,"bytes_total":%s}\n' \
    "$backup_admin_protocol" "$(json_escape "$state")" "$(json_escape "$request_id")" "$(json_escape "$action")" \
    "$(json_escape "$snapshot_id")" "$(json_escape "$started")" "$(now_utc)" "$(json_escape "$finished")" \
    "$(json_escape "$code")" "$(json_escape "$message")" "$(json_escape "$stage")" "$bytes_done" "$bytes_total" > "$tmp"
  chmod 0660 "$tmp" && mv -f "$tmp" "$dir/backup-admin-status.json"
}


# Persist only Host-observed terminal results; bounded to 30 receipts. No
# renderer path, log contents or credentials can enter this private record.

# Read only actual backup stage/byte evidence. Verify, restore and GC have
# unknown byte totals and never receive estimated percentages.
backup_admin_publish_live_progress() {
  local dir="$1" action="$2" id="$3" snapshot="$4" started="$5"
  local file="$dir/backup-admin-progress.env" fields service done_bytes total_bytes
  [[ "$action" == create ]] || return 0
  # One O_NOFOLLOW open and fstat against a 2 KiB cap prevents a symlink
  # replacement between Lstat and grep. No raw file or path is sent to API.
  fields="$(python3 - "$file" <<'PY'
import os
import re
import stat
import sys

path = sys.argv[1]
try:
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        st = os.fstat(stream.fileno())
        if not stat.S_ISREG(st.st_mode) or not 0 < st.st_size <= 2048:
            sys.exit(1)
        raw = stream.read(2049)
    if len(raw) > 2048:
        sys.exit(1)
    lines = raw.decode("utf-8").splitlines()
except (OSError, UnicodeError):
    sys.exit(1)

values = {}
for line in lines:
    key, separator, value = line.partition("=")
    if separator and key in ("service", "bytes_done", "bytes_total"):
        values[key] = value
service = values.get("service", "")
if (not service or len(service.encode("utf-8")) > 96 or
        any(ord(char) < 32 or ord(char) == 127 for char in service)):
    service = "正在创建服务器备份"
def count(name):
    value = values.get(name, "")
    return int(value, 10) if re.fullmatch(r"[0-9]{1,15}", value) else 0
done = count("bytes_done")
total = count("bytes_total")
if total and done > total:
    done = total
print(f"{service}\t{done}\t{total}")
PY
)" || return 0
  IFS=$'\t' read -r service done_bytes total_bytes <<< "$fields"
  backup_admin_status "$dir" running "$action" "$id" "$snapshot" "" \
    "宿主机正在执行备份操作。" "$started" "" "$service" "$done_bytes" "$total_bytes"
}
backup_admin_history_append() {
  local dir="$1" state="$2" action="$3" id="$4" snapshot="$5" mode="$6"
  local started="$7" finished="$8" error_code="$9" proof_path="${10:-}"
  python3 - "$dir/backup-admin-history.json" "$state" "$action" "$id" \
    "$snapshot" "$mode" "$started" "$finished" "$error_code" "$proof_path" <<'PY'
import json, os, re, stat, sys, tempfile
path,state,action,rid,snapshot,mode,started,finished,code,proof_path=sys.argv[1:]
if state not in ("success","failed") or action not in ("create","verify","verify_all","preview_delete","drill","plan","restore","delete","delete_selected","prune","policy"):
    sys.exit(2)
if not re.fullmatch(r"[0-9a-f]{24}",rid) or not re.fullmatch(r"[a-z_]{0,60}",code):
    sys.exit(2)
if snapshot and not re.fullmatch(r"(v1|v2-default|v2-configured):xdrive-backup-[0-9]{8}T[0-9]{6}Z",snapshot):
    sys.exit(2)
if (action in ("verify","preview_delete","drill","restore","delete","delete_selected")) != bool(snapshot):
    sys.exit(2)
if (action in ("verify","preview_delete","verify_all","plan")) != (mode in ("fast","deep")):
    sys.exit(2)
if not (re.fullmatch(r"20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z",started) and
        re.fullmatch(r"20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z",finished)):
    sys.exit(2)
old=[]
if os.path.lexists(path):
    st=os.lstat(path)
    if not stat.S_ISREG(st.st_mode) or st.st_size>32768:
        sys.exit(2)
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,"rb") as f: raw=f.read(32769)
    if len(raw)>32768: sys.exit(2)
    data=json.loads(raw)
    if not isinstance(data,dict) or data.get("protocol")!="xdrive-backup-admin-history-v1":
        sys.exit(2)
    old=data.get("operations")
    if not isinstance(old,list) or len(old)>30: sys.exit(2)
if action in ("drill","preview_delete","delete_selected") and not snapshot.startswith(("v2-default:","v2-configured:")): sys.exit(2)
entry=dict(protocol="xdrive-backup-admin-v1",request_id=rid,action=action,
    snapshot_id=snapshot,mode=mode,state=state,started_at=started,
    finished_at=finished,error_code=code)

# New Host verification evidence is optional; older history remains usable.
# Strictly allowlist fixed-schema counters and enumerations. Raw logs, CAS
# digests, and Host paths never enter this persistent shared record.
if action=="verify" and proof_path:
    try:
        fd=os.open(proof_path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        with os.fdopen(fd,"rb") as f:
            st=os.fstat(f.fileno())
            if not stat.S_ISREG(st.st_mode) or not 0 < st.st_size <= 2048:
                raise ValueError("unsafe report file")
            raw_report=f.read(2049)
        if not 0 < len(raw_report) <= 2048:
            raise ValueError("oversized report")
        def reject_duplicates(pairs):
            value={}
            for key,item in pairs:
                if key in value: raise ValueError("duplicate field")
                value[key]=item
            return value
        proof=json.loads(raw_report.decode("utf-8"),object_pairs_hook=reject_duplicates)
        required={"protocol","state","format","scope","cas_objects_checked","cas_bytes_hashed"}
        optional={"failure_category"}
        allowed={"missing_object","object_sha256_mismatch","object_size_mismatch",
            "unsafe_repository","unsafe_snapshot","unsafe_object_bucket",
            "unreadable_or_unsafe_object","object_read_failed","measurement_overflow",
            "invalid_object_index","invalid_legacy_archive",
            "snapshot_outside_repository","invalid_cas_report",
            "snapshot_verification_failed"}
        category=proof.get("failure_category","") if isinstance(proof,dict) else ""
        fmt="v1" if snapshot.startswith("v1:") else "v2"
        if (not isinstance(proof,dict) or not required <= proof.keys() or
            set(proof)-required-optional or
            proof["protocol"]!="xdrive-host-backup-verify-v1" or
            proof["state"] not in ("success","failed") or
            proof["format"]!=fmt or proof["scope"]!="backup_snapshot_and_referenced_cas" or
            (state=="success" and proof["state"]!="success") or
            type(category) is not str or (category and category not in allowed) or
            (proof["state"]=="failed" and not category)):
            raise ValueError("invalid verification schema")
        for key in ("cas_objects_checked","cas_bytes_hashed"):
            if type(proof[key]) is not int or not 0 <= proof[key] <= 9007199254740991:
                raise ValueError("invalid count")
        if fmt=="v1" and (proof["cas_objects_checked"] or proof["cas_bytes_hashed"]):
            raise ValueError("impossible v1 CAS counts")
        entry["verification"]=proof
    except (OSError,ValueError,UnicodeError,TypeError,KeyError):
        pass  # Never fabricate evidence, and never leak raw error details.
# A successful Host drill must include its real, schema-checked file+SQL receipt.
# No CLI stdout is trusted as a production destructive-recovery attestation.
if action=="drill" and proof_path:
    try:
        fd=os.open(proof_path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        with os.fdopen(fd,"rb") as f:
            st=os.fstat(f.fileno())
            if not stat.S_ISREG(st.st_mode) or not 0 < st.st_size <= 2048:
                raise ValueError("unsafe drill report")
            raw=f.read(2049)
        if not 0 < len(raw) <= 2048: raise ValueError("oversized drill report")
        def unique(pairs):
            out={}
            for k,v in pairs:
                if k in out: raise ValueError("duplicate key")
                out[k]=v
            return out
        d=json.loads(raw.decode("utf-8"),object_pairs_hook=unique)
        keys={"protocol","state","environment","snapshot","started_at","finished_at",
              "files_restored","postgresql_restored","production_verified","max_mib","failure_category"}
        failure={"unsafe_snapshot","invalid_snapshot_checksum","sandbox_quota_exceeded",
                 "runtime_unavailable","file_restore_failed","postgresql_restore_failed",
                 "repository_busy","drill_failed"}
        if (not isinstance(d,dict) or set(d)!=keys or
            d["protocol"]!="xdrive-host-isolated-drill-v1" or
            d["environment"]!="host_ephemeral_offline_tmpfs" or
            d["snapshot"]!=snapshot.split(":",1)[1] or type(d["max_mib"]) is not int or
            d["max_mib"]!=1024 or d["production_verified"] is not False or
            type(d["files_restored"]) is not bool or type(d["postgresql_restored"]) is not bool or
            not isinstance(d["started_at"],str) or not isinstance(d["finished_at"],str) or
            not re.fullmatch(r"20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z",d["started_at"]) or
            not re.fullmatch(r"20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z",d["finished_at"]) or
            d["finished_at"]<d["started_at"] or
            ((d["state"]=="success" and
              not (d["files_restored"] and d["postgresql_restored"] and d["failure_category"]=="")) or
             (d["state"]=="failed" and
              not (d["failure_category"] in failure and d["postgresql_restored"] is False))) or
            d["state"] not in ("success","failed") or
            (state=="success" and d["state"]!="success")):
            raise ValueError("invalid drill receipt")
        entry["drill"]=d
    except (OSError,ValueError,UnicodeError,TypeError,KeyError):
        pass
# A successful selected-v2 retirement MUST have an exact, structured
# source-owned report; otherwise do not record a durable success.
if action=="delete_selected" and state=="success":
    if not proof_path:
        sys.exit(2)
    try:
        fd=os.open(proof_path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        with os.fdopen(fd,"rb") as f:
            st=os.fstat(f.fileno())
            if not stat.S_ISREG(st.st_mode) or not 0<st.st_size<=2048:
                raise ValueError("unsafe retirement receipt")
            raw=f.read(2049)
        def unique_selected(pairs):
            obj={}
            for k,v in pairs:
                if k in obj: raise ValueError("duplicate retirement property")
                obj[k]=v
            return obj
        d=json.loads(raw.decode("utf-8"),object_pairs_hook=unique_selected)
        keys={"mode","keep_last","retired_snapshots","recovered_transactions",
              "deleted_cas_objects","deleted_cas_logical_bytes",
              "deleted_snapshot_files","deleted_snapshot_file_bytes",
              "verification","automatic"}
        if (not isinstance(d,dict) or set(d)!=keys or
            d["mode"]!="manual_selected" or d["automatic"] is not False or
            d["verification"]!="exclusive_lock_and_full_cas_sha256" or
            d["retired_snapshots"]!=[snapshot.split(":",1)[1]]):
            raise ValueError("untrusted selected retirement")
        for key in keys-{"mode","retired_snapshots","verification","automatic"}:
            value=d[key]
            ceiling=1000 if key=="keep_last" else 1000000000 if key.endswith(("objects","files","transactions")) else 9007199254740991
            if type(value) is not int or value < (1 if key=="keep_last" else 0) or value>ceiling:
                raise ValueError("invalid retirement counter")
        entry["selected_delete"]=d
    except (OSError,ValueError,KeyError,TypeError,UnicodeError):
        sys.exit(2)
events=[entry]+[x for x in old if isinstance(x,dict) and x.get("request_id")!=rid]
raw=(json.dumps(dict(protocol="xdrive-backup-admin-history-v1",operations=events[:30]),
                ensure_ascii=False,separators=(",",":"))+"\n").encode()
if len(raw)>32768: sys.exit(2)
fd,tmp=tempfile.mkstemp(prefix=".backup-admin-history.",dir=os.path.dirname(path))
try:
    with os.fdopen(fd,"wb") as f:
        os.fchmod(f.fileno(),0o660)
        f.write(raw); f.flush(); os.fsync(f.fileno())
    os.replace(tmp,path)
    # A renamed receipt is crash-durable only after syncing the containing
    # directory. A failure remains a warning and cannot falsify backup status.
    directory_fd=os.open(os.path.dirname(path),os.O_RDONLY|os.O_DIRECTORY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
finally:
    if os.path.exists(tmp): os.unlink(tmp)
PY
}

backup_admin_write_policy() {
  local fmt="$1" days="$2" expected="$3" tmp install_lock="$STATE_DIR/install.lock"
  local backup_admin_format backup_admin_days backup_admin_repo backup_admin_revision
  [[ "$fmt" == v1 || "$fmt" == v2 ]] || return 1
  [[ "$days" =~ ^[0-9]{1,4}$ ]] || return 1
  (( 10#$days <= 3650 )) || return 1
  backup_admin_policy_values || return 1
  [[ "$expected" == "$backup_admin_revision" ]] || return 1
  [[ "$fmt" == v2 || -z "$backup_admin_repo" ]] || return 1
  [[ -f "$ENV_PATH" && ! -L "$ENV_PATH" ]] || return 1
  # The installer owns this lock while writing deployment config; a remote
  # policy edit cannot overwrite an in-progress upgrade transaction.
  [[ ! -L "$install_lock" && ( ! -e "$install_lock" || -f "$install_lock" ) ]] || return 1
  exec 4>>"$install_lock"
  flock -n 4 || { exec 4>&-; return 1; }
  # Re-read under the installer lease: a policy change between the first
  # revision comparison and this lock must fail rather than overwrite it.
  backup_admin_policy_values || { flock -u 4; exec 4>&-; return 1; }
  [[ "$expected" == "$backup_admin_revision" ]] || { flock -u 4; exec 4>&-; return 1; }
  tmp="$(mktemp "$CONFIG_DIR/.backup-admin-env.XXXXXX")" || return 1
  awk '!/^XD_BACKUP_SCHEDULE_FORMAT=/ && !/^XD_BACKUP_RETENTION_DAYS=/' "$ENV_PATH" > "$tmp" || { rm -f "$tmp"; return 1; }
  printf 'XD_BACKUP_SCHEDULE_FORMAT=%s\nXD_BACKUP_RETENTION_DAYS=%s\n' "$fmt" "$days" >> "$tmp"
  chmod --reference="$ENV_PATH" "$tmp" || { rm -f "$tmp"; return 1; }
  chown --reference="$ENV_PATH" "$tmp" 2>/dev/null || true
  mv -f "$tmp" "$ENV_PATH"
  local exit_code=$?
  flock -u 4
  exec 4>&-
  return "$exit_code"
}

backup_admin_delete_v1() {
  local id="$1" target file name root remaining=0 retired fmt candidate_root
  local backup_admin_format backup_admin_days backup_admin_repo backup_admin_revision
  local -a recovery_roots
  [[ "$id" == v1:xdrive-backup-* ]] || return 1
  target="$(backup_admin_snapshot_directory "$id")" || return 1
  backup_admin_snapshot_complete "$target" v1 || return 1
  root="$XDRIVE_HOME/backups/snapshots"
  recovery_roots=("$root" "$XDRIVE_HOME/backups/incremental/snapshots")
  # Count all valid, independent recovery points including a configured v2
  # repository; never use a path supplied by the remote administrator.
  backup_admin_policy_values || return 1
  if [[ "$backup_admin_format" == v2 && -n "$backup_admin_repo" ]]; then
    candidate_root="$backup_admin_repo/snapshots"
    [[ -d "$candidate_root" && ! -L "$candidate_root" ]] || return 1
    if [[ "$candidate_root" != "$XDRIVE_HOME/backups/incremental/snapshots" ]]; then
      recovery_roots+=("$candidate_root")
    fi
  fi
  for candidate_root in "${recovery_roots[@]}"; do
    [[ -d "$candidate_root" && ! -L "$candidate_root" ]] || continue
    for file in "$candidate_root"/xdrive-backup-*; do
      [[ -d "$file" && "$file" != "$target" && ! -L "$file" ]] || continue
      fmt=v1
      [[ "$candidate_root" == "$root" ]] || fmt=v2
      if [[ "$fmt" == v1 ]] &&
         grep -Eq '"file_data_included"[[:space:]]*:[[:space:]]*false' "$file/manifest.json" 2>/dev/null; then
        continue
      fi
      # Filenames or metadata alone do not prove another recovery point.
      if backup_admin_snapshot_complete "$file" "$fmt" &&
         XD_CONFIG_DIR="$XDRIVE_HOME" "$MANAGER" backup verify "$file" >/dev/null 2>&1; then
        remaining=$((remaining + 1))
      fi
    done
  done
  (( remaining > 0 )) || return 1
  for file in "$target"/*; do
    [[ -f "$file" && ! -L "$file" ]] || return 1
    name="$(basename "$file")"
    case "$name" in
      database.dump|blobs.tar|verify.json|manifest.json|SHA256SUMS.txt) ;;
      *) return 1 ;;
    esac
  done
  retired="$root/.backup-admin-retired-$(basename "$target")"
  [[ ! -e "$retired" && ! -L "$retired" ]] || return 1
  mv -- "$target" "$retired" || return 1
  for name in database.dump blobs.tar verify.json manifest.json SHA256SUMS.txt; do
    if [[ -f "$retired/$name" && ! -L "$retired/$name" ]]; then
      rm -- "$retired/$name" || return 1
    fi
  done
  rmdir -- "$retired"
}

backup_admin_valid_drill_result() {
  local path="$1" snapshot="$2" expect="$3"
  python3 - "$path" "$snapshot" "$expect" <<'PY'
import json,os,re,stat,sys
path,snapshot,expect=sys.argv[1:]
try:
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,"rb") as f:
        st=os.fstat(f.fileno())
        if not stat.S_ISREG(st.st_mode) or not 0<st.st_size<=2048: raise ValueError("report size")
        raw=f.read(2049)
    if not 0<len(raw)<=2048: raise ValueError("report oversized")
    def unique(pairs):
        result={}
        for key,value in pairs:
            if key in result: raise ValueError("duplicate JSON key")
            result[key]=value
        return result
    x=json.loads(raw.decode("utf-8"),object_pairs_hook=unique)
    keys={"protocol","state","environment","snapshot","started_at","finished_at",
          "files_restored","postgresql_restored","production_verified","max_mib","failure_category"}
    failures={"unsafe_snapshot","invalid_snapshot_checksum","sandbox_quota_exceeded",
              "runtime_unavailable","file_restore_failed","postgresql_restore_failed",
              "repository_busy","drill_failed"}
    if not isinstance(x,dict) or set(x)!=keys: raise ValueError("report keys")
    if x["protocol"]!="xdrive-host-isolated-drill-v1" or x["environment"]!="host_ephemeral_offline_tmpfs":
        raise ValueError("unexpected protocol")
    if x["snapshot"]!=snapshot.split(":",1)[1] or x["max_mib"]!=1024 or type(x["max_mib"]) is not int:
        raise ValueError("wrong snapshot/limit")
    if x["production_verified"] is not False or type(x["files_restored"]) is not bool or type(x["postgresql_restored"]) is not bool:
        raise ValueError("invalid state")
    for name in ("started_at","finished_at"):
        if not isinstance(x[name],str) or not re.fullmatch(r"20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z",x[name]):
            raise ValueError("invalid timestamps")
    if x["finished_at"]<x["started_at"] or x["state"]!=expect:
        raise ValueError("inconsistent timestamp/state")
    if expect=="success" and not (x["files_restored"] and x["postgresql_restored"] and x["failure_category"]==""):
        raise ValueError("not fully restored")
    if expect=="failed" and (x["failure_category"] not in failures or x["postgresql_restored"] is not False):
        raise ValueError("invalid failure")
except (OSError,ValueError,TypeError,KeyError,UnicodeError):
    sys.exit(1)
PY
}


# Fixed Host-only verification of all locally discovered committed generations.
# This is not a browser loop: the same Host operation lock survives navigation.
backup_admin_verify_all() {
  local mode="$1" id="$2" report="$3" progress="$4"
  local backup_admin_format backup_admin_days backup_admin_repo backup_admin_revision
  local configured=""
  [[ "$mode" == fast || "$mode" == deep ]] || return 2
  [[ "$id" =~ ^[0-9a-f]{24}$ && -n "$report" && -n "$progress" ]] || return 2
  backup_admin_policy_values || return 2
  if [[ "$backup_admin_format" == v2 && -n "$backup_admin_repo" ]]; then
    configured="$backup_admin_repo/snapshots"
  fi
  XD_CONFIG_DIR="$XDRIVE_HOME" python3 - "$MANAGER" \
    "$XDRIVE_HOME/backups/snapshots" "$XDRIVE_HOME/backups/incremental/snapshots" \
    "$configured" "$mode" "$id" "$report" "$progress" <<'PY'
import datetime, json, os, re, stat, subprocess, sys, tempfile
from pathlib import Path

manager, root_v1, root_v2, root_custom, mode, rid, report, progress = sys.argv[1:]
now = lambda: datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
started = now()
roots = [("v1", root_v1), ("v2-default", root_v2)]
if root_custom and os.path.realpath(root_custom) != os.path.realpath(root_v2):
    roots.append(("v2-configured", root_custom))
snapshots, v2_repos, sample = [], set(), []
abort = ""
checked = passed = failed = deep_checked = deep_failed = 0
name_re = re.compile(r"xdrive-backup-[0-9]{8}T[0-9]{6}Z\Z")
categories = {
    "missing_object", "object_sha256_mismatch", "object_size_mismatch",
    "unsafe_repository", "unsafe_snapshot", "unsafe_object_bucket",
    "unreadable_or_unsafe_object", "object_read_failed", "measurement_overflow",
    "invalid_object_index", "invalid_legacy_archive", "snapshot_outside_repository",
    "invalid_cas_report", "snapshot_verification_failed",
}

def write(path, value):
    data = (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    if len(data) > 16384: raise ValueError("report too large")
    folder = os.path.dirname(path)
    fd, temp = tempfile.mkstemp(prefix=".backup-admin-verify-all.", dir=folder)
    try:
        with os.fdopen(fd, "wb") as f:
            os.fchmod(f.fileno(), 0o660)
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, path)
        dirfd = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try: os.fsync(dirfd)
        finally: os.close(dirfd)
    finally:
        if os.path.lexists(temp): os.unlink(temp)

def publish_progress():
    write(progress, dict(protocol="xdrive-host-verify-all-progress-v1",
        request_id=rid, total=len(snapshots), checked=checked, passed=passed, failed=failed))

try:
    for scope, name in roots:
        root = Path(name)
        if not os.path.lexists(root): continue
        if not stat.S_ISDIR(root.lstat().st_mode):
            abort = "unsafe_repository"; break
        with os.scandir(root) as entries:
            for entry in entries:
                if not entry.name.startswith("xdrive-backup-"): continue
                if not name_re.fullmatch(entry.name) or not entry.is_dir(follow_symlinks=False):
                    abort = "unsafe_snapshot"; break
                if len(snapshots) == 1000:
                    abort = "snapshot_limit_exceeded"; break
                snapshots.append((scope + ":" + entry.name, entry.path, scope))
                if scope != "v1": v2_repos.add(os.path.realpath(root.parent))
        if abort: break
    if not snapshots and not abort: abort = "no_snapshots"
except (OSError, ValueError):
    abort = "unsafe_repository"

snapshots.sort(reverse=True)
try:
    publish_progress()
    if not abort:
        for identity, target, scope in snapshots:
            good = False
            category = "snapshot_verification_failed"
            try:
                with tempfile.TemporaryFile() as output:
                    result = subprocess.run([manager, "backup", "verify", "--json", target],
                        stdin=subprocess.DEVNULL, stdout=output, stderr=sys.stderr,
                        timeout=1800, check=False)
                    output.seek(0)
                    raw = output.read(2049)
                def unique_fields(pairs):
                    values = {}
                    for key, value in pairs:
                        if key in values: raise ValueError("duplicate report property")
                        values[key] = value
                    return values
                proof = json.loads(raw, object_pairs_hook=unique_fields) if 0 < len(raw) <= 2048 else {}
                expected_format = "v1" if scope == "v1" else "v2"
                expected_fields = {"protocol", "state", "format", "scope",
                                   "cas_objects_checked", "cas_bytes_hashed"}
                good = (result.returncode == 0 and isinstance(proof, dict) and
                    set(proof) == expected_fields and
                    proof.get("protocol") == "xdrive-host-backup-verify-v1" and
                    proof.get("state") == "success" and proof.get("format") == expected_format and
                    proof.get("scope") == "backup_snapshot_and_referenced_cas" and
                    type(proof.get("cas_objects_checked")) is int and
                    type(proof.get("cas_bytes_hashed")) is int and
                    0 <= proof["cas_objects_checked"] <= 9007199254740991 and
                    0 <= proof["cas_bytes_hashed"] <= 9007199254740991 and
                    (scope != "v1" or (proof["cas_objects_checked"] == 0 and
                        proof["cas_bytes_hashed"] == 0)))
                if not good and isinstance(proof, dict) and proof.get("state") == "failed":
                    c = proof.get("failure_category")
                    if isinstance(c, str) and c in categories: category = c
            except (OSError, ValueError, TypeError, subprocess.TimeoutExpired):
                good = False
            checked += 1
            if good: passed += 1
            else:
                failed += 1
                if len(sample) < 20:
                    sample.append(dict(snapshot_id=identity, category=category))
            publish_progress()
        if mode == "deep":
            # One additional orphan-CAS audit per unique v2 repository, not
            # one full repository scan per snapshot.
            for repo in sorted(v2_repos):
                deep_checked += 1
                try:
                    with tempfile.TemporaryFile() as output:
                        result = subprocess.run([manager, "backup", "retention-plan",
                            "--repository-dir", repo, "--keep-last", "1", "--mode", "deep"],
                            stdin=subprocess.DEVNULL, stdout=output, stderr=sys.stderr,
                            timeout=1800, check=False)
                        output.seek(0)
                        raw = output.read(131073)
                    def unique_fields(pairs):
                        values = {}
                        for key, value in pairs:
                            if key in values: raise ValueError("duplicate deep report field")
                            values[key] = value
                        return values
                    proof = json.loads(raw, object_pairs_hook=unique_fields) if 0 < len(raw) <= 131072 else {}
                    valid = (
                        result.returncode == 0 and isinstance(proof, dict) and
                        proof.get("mode") == "read_only" and
                        proof.get("validation") == "snapshot_sha256_and_full_cas_sha256" and
                        type(proof.get("keep_last")) is int and proof["keep_last"] == 1 and
                        proof.get("delete_enabled") is False and
                        type(proof.get("committed_snapshots")) is int and
                        1 <= proof["committed_snapshots"] <= 1000 and
                        type(proof.get("hashed_objects")) is int and
                        0 <= proof["hashed_objects"] <= 1000000000 and
                        type(proof.get("hashed_bytes")) is int and
                        0 <= proof["hashed_bytes"] <= 9007199254740991
                    )
                    if not valid: deep_failed += 1
                except (OSError, ValueError, TypeError, subprocess.TimeoutExpired):
                    deep_failed += 1
    state = ("success" if not abort and checked > 0 and checked == len(snapshots) and
             failed == 0 and deep_failed == 0 else "failed")
    result = dict(protocol="xdrive-host-verify-all-v1", request_id=rid,
        mode=mode, state=state, started_at=started, finished_at=now(),
        total_snapshots=len(snapshots), checked_snapshots=checked,
        passed_snapshots=passed, failed_snapshots=failed,
        unverified_snapshots=len(snapshots)-checked,
        deep_repositories_checked=deep_checked, deep_repositories_failed=deep_failed,
        failure_sample=sample, failure_sample_truncated=failed > len(sample),
        failure_category=abort)
    write(report, result)
    sys.exit(0 if state == "success" else 1)
except (OSError, ValueError, TypeError):
    print("bulk verification could not persist a bounded Host report", file=sys.stderr)
    sys.exit(1)
PY
}

backup_admin_publish_verify_all_progress() {
  local dir="$1" action="$2" id="$3" started="$4"
  [[ "$action" == verify_all ]] || return 0
  local progress checked total passed failed stage
  progress="$(python3 - "$dir/backup-admin-verify-all-progress.json" "$id" <<'PY'
import json, os, stat, sys
path,rid=sys.argv[1:]
try:
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,"rb") as f:
        if not stat.S_ISREG(os.fstat(f.fileno()).st_mode) or os.fstat(f.fileno()).st_size>2048:
            sys.exit(1)
        v=json.load(f)
    if v.get("protocol")!="xdrive-host-verify-all-progress-v1" or v.get("request_id")!=rid:
        sys.exit(1)
    fields=[v.get(k) for k in ("checked","total","passed","failed")]
    if any(type(x) is not int or x<0 or x>1000 for x in fields): sys.exit(1)
    checked,total,passed,failed=fields
    if checked>total or passed+failed!=checked: sys.exit(1)
    print(str(checked)+" "+str(total)+" "+str(passed)+" "+str(failed))
except (ValueError,KeyError,TypeError,OSError,AttributeError):
    sys.exit(1)
PY
)" || return 0
  read -r checked total passed failed <<< "$progress"
  stage="已校验 $checked/$total 代（通过 $passed，失败 $failed）"
  backup_admin_status "$dir" running "$action" "$id" "" "" \
    "宿主机正在逐代校验备份。" "$started" "" "$stage" 0 0
}

# Read-only deep evidence is necessary but never sufficient to delete.
# This fence verifies the last successful Host preview and its exact identity;
# the immutable-CAS retirement helper independently performs a fresh full deep
# audit under its exclusive repository lock before any mutation.
backup_admin_valid_selected_deletion_preview() {
  local dir="$1" expected_id="$2" expected_snapshot="$3"
  [[ "$expected_id" =~ ^[0-9a-f]{24}$ &&
     "$expected_snapshot" =~ ^v2-(default|configured):xdrive-backup-[0-9]{8}T[0-9]{6}Z$ ]] || return 1
  python3 - "$dir/backup-admin-selected-preview.json" "$dir/backup-admin-history.json" \
      "$expected_id" "$expected_snapshot" <<'PY'
import datetime, json, os, re, stat, sys
preview_path, history_path, expected_id, expected_snapshot = sys.argv[1:]
def load(path, max_bytes):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as f:
        st = os.fstat(f.fileno())
        if not stat.S_ISREG(st.st_mode) or not 0 < st.st_size <= max_bytes:
            raise ValueError("unsafe host record")
        raw = f.read(max_bytes + 1)
    def unique_pairs(pairs):
        out = {}
        for key, value in pairs:
            if key in out: raise ValueError("duplicate key")
            out[key] = value
        return out
    return json.loads(raw.decode("utf-8"), object_pairs_hook=unique_pairs)
try:
    p = load(preview_path, 4096)
    h = load(history_path, 32768)
    if not isinstance(p, dict) or set(p) != {
        "protocol","request_id","snapshot_id","mode","report"}:
        raise ValueError("unsafe preview envelope")
    if (p["protocol"] != "xdrive-host-selected-v2-preview-v1"
        or p["request_id"] != expected_id
        or p["snapshot_id"] != expected_snapshot or p["mode"] != "deep"):
        raise ValueError("deep preview mismatch")
    report = p["report"]
    expected_fields = {
        "protocol","mode","validation","snapshot","committed_snapshots",
        "surviving_snapshots","selected_snapshot_bytes","selected_cas_objects",
        "shared_cas_objects","exclusive_cas_objects","exclusive_cas_bytes",
        "unreferenced_objects","unreferenced_bytes","potential_logical_bytes",
        "hashed_objects","hashed_bytes","delete_enabled"}
    if not isinstance(report, dict) or set(report) != expected_fields:
        raise ValueError("unsafe preview report")
    if (report["protocol"] != "xdrive-backup-selected-prune-plan-v1"
        or report["mode"] != "read_only"
        or report["validation"] != "snapshot_sha256_and_full_cas_sha256"
        or report["snapshot"] != expected_snapshot.split(":",1)[1]
        or report["delete_enabled"] is not False):
        raise ValueError("preview cannot authorize deletion")
    numeric = expected_fields - {"protocol","mode","validation","snapshot","delete_enabled"}
    for key in numeric:
        maximum = 1000000000 if key.endswith("objects") or key.endswith("snapshots") else 9007199254740991
        if type(report[key]) is not int or not 0 <= report[key] <= maximum:
            raise ValueError("invalid preview count")
    if (not 2 <= report["committed_snapshots"] <= 1000 or
        report["surviving_snapshots"] != report["committed_snapshots"] - 1 or
        report["selected_cas_objects"] != report["shared_cas_objects"] +
                report["exclusive_cas_objects"] or
        report["hashed_objects"] < report["selected_cas_objects"] + report["unreferenced_objects"] or
        report["hashed_bytes"] < report["exclusive_cas_bytes"] + report["unreferenced_bytes"] or
        report["potential_logical_bytes"] != report["selected_snapshot_bytes"] +
                report["exclusive_cas_bytes"] + report["unreferenced_bytes"]):
        raise ValueError("unsafe preview totals")
    events = h.get("operations") if isinstance(h, dict) and h.get("protocol") == "xdrive-backup-admin-history-v1" else None
    if not isinstance(events, list) or not 1 <= len(events) <= 30:
        raise ValueError("missing host audit receipt")
    last = events[0]
    if not isinstance(last,dict) or (last.get("action"),last.get("state"),
        last.get("request_id"),last.get("snapshot_id"),last.get("mode")) != (
            "preview_delete","success",expected_id,expected_snapshot,"deep"):
        raise ValueError("stale or mismatched history")
    ended = datetime.datetime.fromisoformat(last["finished_at"].replace("Z","+00:00"))
    now = datetime.datetime.now(datetime.timezone.utc)
    if not 0 <= (now-ended).total_seconds() < 900:
        raise ValueError("expired deep preview")
except (OSError,ValueError,TypeError,KeyError,AttributeError,UnicodeError,OverflowError):
    sys.exit(1)
PY
}

# Validate exact source-owned retirement JSON. Exit zero alone cannot
# attest which snapshot was retired or whether exclusive CAS hashing ran.
backup_admin_valid_selected_deletion_result() {
  local proof="$1" selected="$2"
  python3 - "$proof" "$selected" <<'PY'
import json,os,re,stat,sys
path,selected=sys.argv[1:]
try:
    if not re.fullmatch(r"v2-(default|configured):xdrive-backup-[0-9]{8}T[0-9]{6}Z", selected):
        raise ValueError("invalid selected identity")
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,"rb") as f:
        st=os.fstat(f.fileno())
        if not stat.S_ISREG(st.st_mode) or not 0<st.st_size<=2048: raise ValueError("unsafe proof")
        raw=f.read(2049)
    def unique(pairs):
        out={}
        for key,val in pairs:
            if key in out: raise ValueError("duplicate proof key")
            out[key]=val
        return out
    d=json.loads(raw.decode("utf-8"),object_pairs_hook=unique)
    keys={"mode","keep_last","retired_snapshots","recovered_transactions",
        "deleted_cas_objects","deleted_cas_logical_bytes","deleted_snapshot_files",
        "deleted_snapshot_file_bytes","verification","automatic"}
    if (not isinstance(d,dict) or set(d)!=keys or
        d["mode"]!="manual_selected" or d["automatic"] is not False or
        d["verification"]!="exclusive_lock_and_full_cas_sha256" or
        d["retired_snapshots"]!=[selected.split(":",1)[1]]): raise ValueError("invalid proof")
    for key in keys-{"mode","retired_snapshots","verification","automatic"}:
        value=d[key]
        limit=1000 if key=="keep_last" else 1000000000 if key.endswith(("objects","files","transactions")) else 9007199254740991
        if type(value) is not int or value<(1 if key=="keep_last" else 0) or value>limit:
            raise ValueError("invalid counter")
except (OSError,ValueError,KeyError,TypeError,UnicodeError):
    sys.exit(1)
PY
}

# A successful Manager exit is insufficient: require a new canonical generation
# and independently verify it before acknowledging an Admin CREATE as success.
backup_admin_create_verified() {
  local fmt="$1" root="" created="" name="" candidate=""
  local backup_admin_format backup_admin_days backup_admin_repo backup_admin_revision
  local -A previous=()
  case "$fmt" in
    v1) root="$XDRIVE_HOME/backups/snapshots" ;;
    v2)
      backup_admin_policy_values || return 2
      if [[ "$backup_admin_format" == v2 && -n "$backup_admin_repo" ]]; then
        root="$backup_admin_repo/snapshots"
      else
        root="$XDRIVE_HOME/backups/incremental/snapshots"
      fi ;;
    *) return 2 ;;
  esac
  if [[ -e "$root" || -L "$root" ]]; then
    [[ -d "$root" && ! -L "$root" ]] || return 78
    for candidate in "$root"/xdrive-backup-*; do
      [[ -e "$candidate" || -L "$candidate" ]] || continue
      previous["$(basename -- "$candidate")"]=1
    done
  fi
  if [[ "$fmt" == v1 ]]; then
    created="$(XD_CONFIG_DIR="$XDRIVE_HOME" "$MANAGER" backup)" || return
  elif [[ "$backup_admin_format" == v2 && -n "$backup_admin_repo" ]]; then
    created="$(XD_CONFIG_DIR="$XDRIVE_HOME" "$MANAGER" backup --incremental --repository-dir "$backup_admin_repo")" || return
  else
    created="$(XD_CONFIG_DIR="$XDRIVE_HOME" "$MANAGER" backup --incremental)" || return
  fi
  # Never trust an output-provided path outside the Host-selected repository.
  [[ -d "$root" && ! -L "$root" ]] || return 78
  root="$(cd "$root" && pwd -P)" || return 78
  name="$(basename -- "$created")"
  [[ "$name" =~ ^xdrive-backup-[0-9]{8}T[0-9]{6}Z$ ]] || return 78
  [[ "$created" == "$root/$name" ]] || return 78
  [[ -z "${previous[$name]:-}" ]] || return 78
  [[ -d "$created" && ! -L "$created" ]] || return 78
  backup_admin_snapshot_complete "$created" "$fmt" || return 78
  # Do not delete or retry an unverified generation automatically.
  XD_CONFIG_DIR="$XDRIVE_HOME" "$MANAGER" backup verify "$created" >/dev/null || return 78
  printf 'Verified newly created %s snapshot: %s\n' "$fmt" "$created"
}

backup_admin_execute() {
  local action="$1" snapshot="$2" fmt="$3" mode="$4" keep="$5" days="$6" revision="$7" confirm="$8" preview_id="${9:-}"
  local target install_guard="$STATE_DIR/install.lock"
  # A standalone Host installer may be upgrading the Server outside this
  # controller's process. Never overlap its transactional install.lock with
  # backup/restore/GC. Policy changes already own the same lock internally.
  if [[ "$action" != policy ]]; then
    [[ ! -L "$install_guard" && ( ! -e "$install_guard" || -f "$install_guard" ) ]] || return 75
    exec 4>>"$install_guard"
    flock -n 4 || { exec 4>&-; return 75; }
    # fd 4 remains inherited by backup/restore subprocesses until they exit.
  fi
  case "$action" in
    create)
      [[ -z "$snapshot" && -z "$confirm" && ( "$fmt" == v1 || "$fmt" == v2 ) ]] || return 2
      backup_admin_create_verified "$fmt" ;;
    verify_all)
      [[ -z "$snapshot" && -z "$fmt" && -z "$confirm" && ( -z "$keep" || "$keep" == 0 ) && -z "$revision" ]] || return 2
      [[ "$mode" == fast || "$mode" == deep ]] || return 2
      backup_admin_verify_all "$mode" "$XD_BACKUP_ADMIN_REQUEST_ID"         "$XD_BACKUP_ADMIN_BULK_REPORT_FILE" "$XD_BACKUP_ADMIN_BULK_PROGRESS_FILE" ;;
    verify)
      [[ "$mode" == fast || "$mode" == deep ]] || return 2
      target="$(backup_admin_snapshot_directory "$snapshot")" || return 2
      if [[ -n "${XD_BACKUP_ADMIN_VERIFY_JSON_FILE:-}" ]]; then
        XD_CONFIG_DIR="$XDRIVE_HOME" "$MANAGER" backup verify --json "$target" > "$XD_BACKUP_ADMIN_VERIFY_JSON_FILE" || return
      else
        XD_CONFIG_DIR="$XDRIVE_HOME" "$MANAGER" backup verify "$target" || return
      fi
      if [[ "$mode" == deep && "$snapshot" == v2-* ]]; then
        XD_CONFIG_DIR="$XDRIVE_HOME" "$MANAGER" backup retention-plan --repository-dir "$(dirname "$(dirname "$target")")" --keep-last 1 --mode deep
      fi ;;
    preview_delete)
      [[ "$snapshot" == v2-* && ( "$mode" == fast || "$mode" == deep ) &&
         -z "$fmt" && -z "$confirm" && ( -z "$keep" || "$keep" == 0 ) &&
         ( -z "$days" || "$days" == 0 ) && -z "$revision" ]] || return 2
      target="$(backup_admin_snapshot_directory "$snapshot")" || return 2
      # The Server never supplies a Host path. The Host resolves a recognized
      # committed v2 identity, then invokes the read-only confined helper.
      XD_CONFIG_DIR="$XDRIVE_HOME" "$MANAGER" backup preview-delete-snapshot \
        --snapshot "${snapshot#*:}" --mode "$mode" \
        --repository-dir "$(dirname "$(dirname "$target")")" ;;
    drill)
      [[ "$snapshot" == v2-* && "$confirm" == "DRILL $snapshot" ]] || return 2
      target="$(backup_admin_snapshot_directory "$snapshot")" || return 2
      # Fixed RAM ceiling: the browser never supplies a Docker image, path,
      # shell command, capacity override or access to the live PostgreSQL.
      [[ -n "${XD_BACKUP_ADMIN_DRILL_JSON_FILE:-}" ]] || return 2
      if XD_CONFIG_DIR="$XDRIVE_HOME" bash "$MANAGER" backup drill "$target" --max-mib 1024           > "$XD_BACKUP_ADMIN_DRILL_JSON_FILE"; then
        backup_admin_valid_drill_result "$XD_BACKUP_ADMIN_DRILL_JSON_FILE" "$snapshot" success || return 78
      else
        local drill_rc=$?
        backup_admin_valid_drill_result "$XD_BACKUP_ADMIN_DRILL_JSON_FILE" "$snapshot" failed || true
        return "$drill_rc"
      fi ;;
    plan)
      [[ "$keep" =~ ^[1-9][0-9]{0,3}$ ]] || return 2
      [[ "$mode" == fast || "$mode" == deep ]] || return 2
      (( keep <= 1000 )) || return 2
      XD_CONFIG_DIR="$XDRIVE_HOME" "$MANAGER" backup retention-plan --keep-last "$keep" --mode "$mode" ;;
    restore)
      [[ "$confirm" == "RESTORE $snapshot" ]] || return 2
      target="$(backup_admin_snapshot_directory "$snapshot")" || return 2
      # Database-only legacy snapshots require a separately selected recovery
      # mode. Never let a full restore attempt clear live file storage when
      # the selected generation did not actually include any file data.
      if [[ "$snapshot" == v1:* ]] &&
         grep -Eq '"file_data_included"[[:space:]]*:[[:space:]]*false' "$target/manifest.json"; then
        return 2
      fi
      XD_CONFIG_DIR="$XDRIVE_HOME" "$MANAGER" backup verify "$target" || return
      XD_CONFIG_DIR="$XDRIVE_HOME" "$MANAGER" restore "$target" --yes ;;
    delete_selected)
      [[ "$snapshot" == v2-* && "$confirm" == "DELETE $snapshot" &&
         "$preview_id" =~ ^[0-9a-f]{24}$ && -z "$fmt" && -z "$mode" &&
         ( -z "$keep" || "$keep" == 0 ) &&
         ( -z "$days" || "$days" == 0 ) && -z "$revision" ]] || return 2
      # Second, Host-owned fence. The browser may not provide a repository,
      # live filesystem path, image or a fallback deletion strategy.
      backup_admin_valid_selected_deletion_preview "$(control_dir)" "$preview_id" "$snapshot" || return 76
      target="$(backup_admin_snapshot_directory "$snapshot")" || return 2
      [[ -n "$XD_BACKUP_ADMIN_SELECTED_DELETE_JSON_FILE" ]] || return 78
      XD_CONFIG_DIR="$XDRIVE_HOME" "$MANAGER" backup delete-snapshot \
        --snapshot "${snapshot#*:}" --yes \
        --repository-dir "$(dirname "$(dirname "$target")")" > "$XD_BACKUP_ADMIN_SELECTED_DELETE_JSON_FILE" || return
      # A missing or forged CLI result is a failure even if the target vanished.
      backup_admin_valid_selected_deletion_result "$XD_BACKUP_ADMIN_SELECTED_DELETE_JSON_FILE" "$snapshot" || return 78
      [[ ! -e "$target" && ! -L "$target" ]] || return 78 ;;
    delete)
      [[ "$confirm" == "DELETE $snapshot" ]] || return 2
      backup_admin_delete_v1 "$snapshot" ;;
    prune)
      [[ "$keep" =~ ^[1-9][0-9]{0,3}$ && "$confirm" == "PRUNE $keep" ]] || return 2
      (( keep <= 1000 )) || return 2
      XD_CONFIG_DIR="$XDRIVE_HOME" "$MANAGER" backup prune --keep-last "$keep" --yes ;;
    policy)
      [[ -z "$snapshot" && -z "$confirm" ]] || return 2
      backup_admin_write_policy "$fmt" "$days" "$revision" ;;
    *) return 2 ;;
  esac
}

backup_admin_json_int() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  sed -nE 's/.*"'$key'"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "$file" | head -n1
}

# Persist only a complete, strictly validated, bounded read-only Host report.
# This report never grants deletion authority or supplies a browser Host path.
backup_admin_persist_selected_preview() {
  local dir="$1" log="$2" request_id="$3" snapshot="$4" mode="$5"
  local tmp
  tmp="$(mktemp "$dir/.backup-admin-selected-preview.XXXXXX")" || return 1
  if ! python3 - "$log" "$tmp" "$request_id" "$snapshot" "$mode" <<'PY'
import json, os, re, stat, sys
source, target, rid, snapshot, mode = sys.argv[1:]
required = {
    "protocol", "mode", "validation", "snapshot", "committed_snapshots",
    "surviving_snapshots", "selected_snapshot_bytes", "selected_cas_objects",
    "shared_cas_objects", "exclusive_cas_objects", "exclusive_cas_bytes",
    "unreferenced_objects", "unreferenced_bytes", "potential_logical_bytes",
    "hashed_objects", "hashed_bytes", "delete_enabled"
}
try:
    if not re.fullmatch(r"[0-9a-f]{24}", rid):
        raise ValueError("invalid request id")
    if not re.fullmatch(r"v2-(default|configured):xdrive-backup-[0-9]{8}T[0-9]{6}Z", snapshot):
        raise ValueError("invalid selected snapshot")
    if mode not in ("fast", "deep"):
        raise ValueError("invalid validation mode")
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as f:
        st = os.fstat(f.fileno())
        if not stat.S_ISREG(st.st_mode) or not 0 < st.st_size <= 4096:
            raise ValueError("invalid source report size")
        raw = f.read(4097)
    def unique_fields(pairs):
        data = {}
        for key, value in pairs:
            if key in data: raise ValueError("duplicate report key")
            data[key] = value
        return data
    data = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_fields)
    if not isinstance(data, dict) or set(data) != required:
        raise ValueError("invalid report fields")
    expected = ("snapshot_sha256_and_full_cas_sha256" if mode == "deep"
                else "snapshot_sha256_and_cas_size")
    if (data["protocol"] != "xdrive-backup-selected-prune-plan-v1"
            or data["mode"] != "read_only"
            or data["validation"] != expected
            or data["snapshot"] != snapshot.split(":", 1)[1]
            or data["delete_enabled"] is not False):
        raise ValueError("mismatched read-only preview")
    ints = required - {"protocol", "mode", "validation", "snapshot", "delete_enabled"}
    for key in ints:
        ceiling = 1000000000 if key.endswith("objects") or key.endswith("snapshots") else 9007199254740991
        if type(data[key]) is not int or not 0 <= data[key] <= ceiling:
            raise ValueError("invalid preview counter")
    if (data["committed_snapshots"] < 2 or
            data["surviving_snapshots"] != data["committed_snapshots"] - 1 or
            data["selected_cas_objects"] != data["shared_cas_objects"] + data["exclusive_cas_objects"] or
            (mode == "deep" and (data["hashed_objects"] <
                data["selected_cas_objects"] + data["unreferenced_objects"] or
                data["hashed_bytes"] < data["exclusive_cas_bytes"] + data["unreferenced_bytes"])) or
            data["potential_logical_bytes"] != data["selected_snapshot_bytes"] +
                data["exclusive_cas_bytes"] + data["unreferenced_bytes"]):
        raise ValueError("inconsistent preview totals")
    envelope = dict(protocol="xdrive-host-selected-v2-preview-v1",
                    request_id=rid, snapshot_id=snapshot, mode=mode, report=data)
    with open(target, "w", encoding="utf-8") as f:
        json.dump(envelope, f, ensure_ascii=True, separators=(",", ":"))
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
except (OSError, ValueError, KeyError, TypeError, UnicodeError):
    sys.exit(1)
PY
  then
    rm -f -- "$tmp"
    return 1
  fi
  chmod 0660 "$tmp" && mv -f -- "$tmp" "$dir/backup-admin-selected-preview.json" || {
    rm -f -- "$tmp"
    return 1
  }
}

backup_admin_process_request() {
  local dir="$1" request="$dir/backup-admin-request.json" active="$dir/backup-admin-active.json"
  local protocol id action snapshot fmt mode keep days revision confirm preview_id created started result=0 log tmp
  local progress_file="$dir/backup-admin-progress.env"
  local verify_file="" drill_file="" selected_delete_file="" bulk_file="" bulk_progress="$dir/backup-admin-verify-all-progress.json"
  [[ -f "$request" && ! -L "$request" && ! -e "$active" && ! -L "$active" ]] || return 0
  mv -- "$request" "$active" || return 0
  protocol="$(json_value "$active" protocol)"
  id="$(json_value "$active" request_id)"
  action="$(json_value "$active" action)"
  snapshot="$(json_value "$active" snapshot_id)"
  fmt="$(json_value "$active" format)"
  mode="$(json_value "$active" mode)"
  keep="$(backup_admin_json_int "$active" keep_last)"
  days="$(backup_admin_json_int "$active" retention_days)"
  revision="$(json_value "$active" revision)"
  confirm="$(json_value "$active" confirmation)"
  preview_id="$(json_value "$active" preview_request_id)"
  created="$(json_value "$active" created_at)"
  if [[ "$protocol" != "$backup_admin_protocol" || ! "$id" =~ ^[0-9a-f]{24}$ ]] ||
     ! request_time_is_fresh "$created"; then
    backup_admin_status "$dir" failed "$action" "$id" "$snapshot" invalid_request "请求无效或已过期。" "" "$(now_utc)"
    rm -f "$active"
    return 0
  fi
  started="$(now_utc)"
  backup_admin_status "$dir" running "$action" "$id" "$snapshot" "" "宿主机正在执行备份操作。" "$started" ""
  log="$LOG_DIR/backup-admin-last.log"
  if [[ "$action" == verify ]]; then
    # Only Host-owned random temporary inode; no predictable browser path.
    verify_file="$(mktemp "$LOG_DIR/.backup-admin-verify.XXXXXXXX" 2>/dev/null || true)"
  elif [[ "$action" == drill ]]; then
    drill_file="$(mktemp "$LOG_DIR/.backup-admin-drill.XXXXXXXX" 2>/dev/null || true)"
  elif [[ "$action" == delete_selected ]]; then
    selected_delete_file="$(mktemp "$LOG_DIR/.backup-admin-selected-delete.XXXXXXXX" 2>/dev/null || true)"
  elif [[ "$action" == verify_all ]]; then
    bulk_file="$(mktemp "$LOG_DIR/.backup-admin-verify-all.XXXXXXXX" 2>/dev/null || true)"
  fi
  # Keep the Host Control heartbeat fresh during long pg_dump, hashing and
  # restoration. The backup-operation flock is inherited by the child: a
  # crashed runner cannot overlap a still-running privileged backup command.
  local pid tick=0 guard="$STATE_DIR/backup-admin-operation.lock"
  local scheduled_guard="$STATE_DIR/scheduled-backup.lock"
  # The existing v1/v2 scheduled runner owns scheduled-backup.lock. Reuse it
  # so a remote Admin restore/deletion cannot race scheduled snapshot creation
  # or the legacy v1 retention job. Preserve the Host-only operation lock as
  # a fence against a Host Control restart while a child is still running.
  if [[ -L "$guard" || ( -e "$guard" && ! -f "$guard" ) ||
        -L "$scheduled_guard" || ( -e "$scheduled_guard" && ! -f "$scheduled_guard" ) ||
        -L "$progress_file" || ( -e "$progress_file" && ! -f "$progress_file" ) ]]; then
    result=75
  else
    exec 6>>"$guard"
    if ! flock -n 6; then
      result=75
    else
      exec 5>>"$scheduled_guard"
      if ! flock -n 5; then
        result=75
      else
        rm -f -- "$progress_file"
        ( umask 077
          if [[ "$action" == create ]]; then export XD_BACKUP_PROGRESS_FILE="$progress_file"; fi
          if [[ "$action" == verify ]]; then export XD_BACKUP_ADMIN_VERIFY_JSON_FILE="$verify_file"; fi
          if [[ "$action" == drill ]]; then export XD_BACKUP_ADMIN_DRILL_JSON_FILE="$drill_file"; fi
          if [[ "$action" == delete_selected ]]; then export XD_BACKUP_ADMIN_SELECTED_DELETE_JSON_FILE="$selected_delete_file"; fi
          if [[ "$action" == verify_all ]]; then
            export XD_BACKUP_ADMIN_REQUEST_ID="$id"
            export XD_BACKUP_ADMIN_BULK_REPORT_FILE="$bulk_file"
            export XD_BACKUP_ADMIN_BULK_PROGRESS_FILE="$bulk_progress"
          fi
          XD_CONFIG_DIR="$XDRIVE_HOME" backup_admin_execute "$action" "$snapshot" "$fmt" "$mode" "$keep" "$days" "$revision" "$confirm" "$preview_id"
        ) > "$log" 2>&1 &
        pid=$!
        while kill -0 "$pid" 2>/dev/null; do
          touch_heartbeat
          tick=$((tick + 1))
          if (( tick % 2 == 0 )); then
            backup_admin_publish_live_progress "$dir" "$action" "$id" "$snapshot" "$started" || true
            backup_admin_publish_verify_all_progress "$dir" "$action" "$id" "$started" || true
          fi
          if (( tick % 25 == 0 )); then backup_admin_inventory "$dir" || true; fi
          sleep 1
        done
        if wait "$pid"; then result=0; else result=$?; fi
        flock -u 5
      fi
      exec 5>&-
      flock -u 6
    fi
    exec 6>&-
  fi
  if [[ "$result" == 0 && "$action" == preview_delete ]]; then
    backup_admin_persist_selected_preview "$dir" "$log" "$id" "$snapshot" "$mode" || result=1
  fi
  if [[ "$result" == 0 && "$action" == plan ]]; then
    tmp="$(mktemp "$dir/.backup-retention.XXXXXX")" || result=1
    if [[ "$result" == 0 ]]; then
      if (( $(wc -c < "$log") > 32768 )); then result=1
      else cp "$log" "$tmp" && chmod 0660 "$tmp" &&
        mv -f "$tmp" "$dir/backup-admin-retention-report.json" || result=1
      fi
      [[ "$result" == 0 ]] || rm -f "$tmp"
    fi
  fi
  # Retain a bounded Host-executed report even for verification failures.
  # No success is possible if the report was not durably published.
  if [[ "$action" == verify_all ]]; then
    if [[ -n "$bulk_file" && -f "$bulk_file" && ! -L "$bulk_file" &&
          -s "$bulk_file" ]] && (( $(wc -c < "$bulk_file") <= 16384 )); then
      tmp="$(mktemp "$dir/.backup-admin-verify-all-report.XXXXXX")" || result=1
      if [[ -n "$tmp" && -f "$tmp" ]]; then
        if cp -- "$bulk_file" "$tmp" && chmod 0660 "$tmp" &&
           sync -f "$tmp" && mv -f "$tmp" "$dir/backup-admin-verify-all-report.json"; then
          :
        else
          result=1
        fi
        [[ -e "$tmp" ]] && rm -f -- "$tmp"
      fi
    elif [[ "$result" == 0 ]]; then
      result=1
    fi
  fi
  local finished="$(now_utc)" history_state=success history_error="" selected_history_written=0
  # A destructive success must not precede its durable Host evidence.
  # Failure to persist is an uncertain outcome requiring operator inspection.
  if [[ "$result" == 0 && "$action" == delete_selected ]]; then
    if backup_admin_history_append "$dir" success "$action" "$id" "$snapshot" "$mode" "$started" "$finished" "" "$selected_delete_file"; then
      selected_history_written=1
    else
      result=78
    fi
  fi
  if [[ "$result" == 0 ]]; then
    backup_admin_status "$dir" success "$action" "$id" "$snapshot" "" "备份操作已完成。" "$started" "$finished"
  else
    history_state=failed
    history_error=operation_failed
    local failure_message="操作失败；请查看宿主机私有日志。"
    if [[ "$result" == 75 ]]; then
      history_error=lock_busy
    elif [[ "$action" == create && "$result" == 78 ]]; then
      history_error=create_unverified
      failure_message="新快照未获得可信校验成功凭据；可能已创建，请刷新清单并手动验证，勿直接重试。"
    elif [[ "$action" == delete_selected && "$result" == 76 ]]; then
      history_error=deep_preview_missing_or_stale
      failure_message="深度预览缺失、过期或不匹配，请重新执行 deep 只读预览。"
    elif [[ "$action" == delete_selected && "$result" == 78 ]]; then
      history_error=selected_delete_unverified
      failure_message="删除结果无法核实；请先刷新备份清单并检查宿主机私有日志，不要自动重试。"
    fi
    backup_admin_status "$dir" failed "$action" "$id" "$snapshot" "$history_error" "$failure_message" "$started" "$finished"
  fi
  # Other actions remain best-effort; selected destructive success requires
  # a durable receipt before publishing its terminal success status.
  if [[ "$selected_history_written" != 1 ]]; then
    backup_admin_history_append "$dir" "$history_state" "$action" "$id" "$snapshot" "$mode" "$started" "$finished" "$history_error" "${verify_file:-${drill_file:-$selected_delete_file}}" ||
      echo "[xDrive] warning: private backup history not persisted" >&2
  fi
  rm -f "$active"
  if [[ -n "$verify_file" && -f "$verify_file" && ! -L "$verify_file" ]]; then
    rm -f -- "$verify_file"
  fi
  if [[ -n "$drill_file" && -f "$drill_file" && ! -L "$drill_file" ]]; then
    rm -f -- "$drill_file"
  fi
  if [[ -n "$selected_delete_file" && -f "$selected_delete_file" && ! -L "$selected_delete_file" ]]; then
    rm -f -- "$selected_delete_file"
  fi
  if [[ -n "$bulk_file" && -f "$bulk_file" && ! -L "$bulk_file" ]]; then
    rm -f -- "$bulk_file"
  fi
  if [[ -f "$bulk_progress" && ! -L "$bulk_progress" ]]; then
    rm -f -- "$bulk_progress"
  fi
  if [[ -f "$progress_file" && ! -L "$progress_file" ]]; then rm -f -- "$progress_file"; fi
  backup_admin_inventory "$dir" || true
}


backup_admin_recover_interrupted() {
  local dir="$1" interrupted_request="$dir/backup-admin-active.json"
  if [[ ! -f "$interrupted_request" && ! -f "$dir/backup-admin-request.json" ]]; then
    return 0
  fi
  # No queued or active destructive action is replayed across Host restarts.
  # A new explicit Admin confirmation is required after inspecting the state.
  [[ -f "$interrupted_request" ]] || interrupted_request="$dir/backup-admin-request.json"
  local old_action old_id old_snapshot old_mode finished
  old_action="$(json_value "$interrupted_request" action)"
  old_id="$(json_value "$interrupted_request" request_id)"
  old_snapshot="$(json_value "$interrupted_request" snapshot_id)"
  old_mode="$(json_value "$interrupted_request" mode)"
  finished="$(now_utc)"
  backup_admin_status "$dir" failed "$old_action" "$old_id" "$old_snapshot" interrupted "上次备份操作被中断；如需继续请重新确认。" "" "$finished"
  backup_admin_history_append "$dir" failed "$old_action" "$old_id" "$old_snapshot" "$old_mode" "$finished" "$finished" interrupted || true
  rm -f -- "$dir/backup-admin-active.json" "$dir/backup-admin-request.json"
  # Interrupted jobs are never replayed; discard any stale stage evidence.
  if [[ -f "$dir/backup-admin-progress.env" && ! -L "$dir/backup-admin-progress.env" ]]; then
    rm -f -- "$dir/backup-admin-progress.env"
  fi
  if [[ -f "$dir/backup-admin-verify-all-progress.json" &&
        ! -L "$dir/backup-admin-verify-all-progress.json" ]]; then
    rm -f -- "$dir/backup-admin-verify-all-progress.json"
  fi
}

serve_cmd() {
  [[ $# -eq 0 ]] || { echo "usage: server-control.sh serve" >&2; return 2; }
  local dir pid_file existing lock_dir="" source channel interrupted_backup_file_data
  local storage_inventory_interval last_storage_inventory_at last_backup_admin_at last_caddy_observation_at now
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
  # Identify the code that THIS daemon actually loaded. A new installer
  # can then detect an older live runner without killing a running update.
  caddy_host_control_mark_runner "$dir" || true
  # Never keep a plaintext reveal after the Host runner itself restarts.
  rm -f -- "$dir/caddy-env-secret-result.json"
  # A lost Host ACK during Docker recreate cannot become phantom success.
  # On restart recover only the pinned original Caddy baseline, or leave a
  # sticky failed record for operator reconciliation.
  caddy_env_recover_interrupted "$dir" || true

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

    # A crashed enable must never become an implicit success.
  if [[ -f "$dir/photo-host-control-active.json" ||
        -f "$dir/photo-host-control-recovery" ]]; then
    photo_host_control_recover || true
    rm -f "$dir/photo-host-control-active.json"
    photo_host_control_refresh
    local previous_status="$dir/photo-host-control-status.json"
    photo_host_control_write_status failed \
      "$(photo_host_control_uint "$previous_status" revision)" \
      "$(photo_host_control_uint "$previous_status" applied_revision)" \
      false "" "$(photo_host_control_probe)" false
  fi

# Publish liveness before any externally visible idle/recovery status. This
  # prevents API/UI consumers from observing a ready-looking status while the
  # host-control heartbeat is still absent during startup.
  touch_heartbeat
  # Incomplete privileged operations are not silently retried on restart.
  backup_admin_recover_interrupted "$dir"
  backup_admin_inventory "$dir" || true

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
  caddy_env_refresh || true
  if caddy_host_refresh; then
    caddy_host_control_mark_main_sample "$dir" || true
  fi
  photo_intelligence_host_refresh || true
  photo_host_control_refresh || true
  last_storage_inventory_at="$(date +%s)"
  last_backup_admin_at="$last_storage_inventory_at"
  last_caddy_observation_at="$last_storage_inventory_at"

  while true; do
    touch_heartbeat
    [[ -f "$dir/backup-admin-request.json" ]] && backup_admin_process_request "$dir"
    [[ -f "$dir/request.json" ]] && process_request
    [[ -f "$dir/caddy-env-request.json" ]] && caddy_env_process
    [[ -f "$dir/media-worker-control-request.json" ]] && media_worker_control_process
    media_worker_control_refresh
    [[ -f "$dir/photo-host-control-request.json" ]] && photo_host_control_process
    photo_host_control_refresh || true
    now="$(date +%s)"
    caddy_env_reap_secret_result "$dir/caddy-env-secret-result.json" "$now"
    if (( now - last_caddy_observation_at >= 15 )); then
      if caddy_host_refresh; then
        caddy_host_control_mark_main_sample "$dir" || true
      fi
      caddy_env_refresh || true
      photo_intelligence_host_refresh || true
      last_caddy_observation_at="$now"
    fi
    if (( now - last_backup_admin_at >= 30 )); then
      backup_admin_inventory "$dir" || true
      last_backup_admin_at="$now"
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
    # A previously installed Caddy may be healthy while an older Bash runner
    # still emits heartbeat but has NO caddy-runtime-status.json producer.
    # Never interrupt that process (it could be in a live server update).
    # Even a current-source Runner needs a read-only repair when the fixed
    # Caddy snapshot is absent or stale; its code marker is not health proof.
    if ! caddy_host_control_current_runner "$dir" "$pid" ||
        ! caddy_host_snapshot_fresh "$dir" ||
        ! caddy_host_env_snapshot_fresh "$dir"; then
      start_caddy_compat_observer "$dir" || true
    fi
    echo "Host control already running (pid $pid)."
    return 0
  fi
  rm -f -- "$dir/caddy-observer-stop"
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
  # Stop the supplemental read-only observer cooperatively, without signaling
  # a potentially unrelated PID and without touching Docker or Caddy.
  if [[ -d "$dir" ]]; then : > "$dir/caddy-observer-stop"; fi
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
    # Once per minute, independently of the long-running Host process.
    printf '* * * * * XD_CONFIG_DIR=%q %q caddy-watchdog-once >> %q 2>&1 # xdrive-managed-control\n' \
      "$XDRIVE_HOME" "$BIN_DIR/server-control.sh" "$LOG_DIR/caddy-watchdog.log" >> "$tmp"
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
  caddy-observe) caddy_compat_observe_cmd "$@" ;;
  caddy-watchdog-once) caddy_watchdog_once "$@" ;;
  caddy-rescue) caddy_rescue_manual "$@" ;;
  stop) stop_cmd "$@" ;;
  status) status_cmd "$@" ;;
  remove-schedule) remove_schedule ;;
  *) echo "usage: server-control.sh <install|start|serve|caddy-observe|caddy-watchdog-once|caddy-rescue|stop|status|remove-schedule>" >&2; exit 2 ;;
esac
