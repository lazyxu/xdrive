#!/usr/bin/env bash
set -euo pipefail
umask 077

XDRIVE_HOME="${XD_CONFIG_DIR:-$HOME/.xd}"
OUTPUT_ROOT=""
ALLOW_INCONSISTENT=0
LEAVE_SERVER_STOPPED=0
INCLUDE_FILE_DATA=1

usage() {
  cat <<'EOF'
Usage: server-backup.sh [--config-dir DIR] [--output-dir DIR] [--allow-inconsistent] [--leave-server-stopped] [--skip-file-data]

Creates an xDrive backup directory containing:
  database.dump   PostgreSQL custom-format dump
  blobs.tar       uncompressed file-data snapshot (omitted with --skip-file-data)
  verify.json     pre-backup consistency report
  manifest.json   backup metadata
  SHA256SUMS.txt  SHA-256 checksums

The API and pull-worker services are stopped for the consistency check and
snapshot so metadata and blobs represent one maintenance-window backup point.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config-dir) XDRIVE_HOME="$2"; shift 2 ;;
    --output-dir) OUTPUT_ROOT="$2"; shift 2 ;;
    --allow-inconsistent) ALLOW_INCONSISTENT=1; shift ;;
    --leave-server-stopped) LEAVE_SERVER_STOPPED=1; shift ;;
    --skip-file-data) INCLUDE_FILE_DATA=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

CONFIG_DIR="$XDRIVE_HOME/config"
COMPOSE_PATH="$CONFIG_DIR/docker-compose.yml"
ENV_PATH="$CONFIG_DIR/.env"
[[ -f "$COMPOSE_PATH" ]] || { echo "missing $COMPOSE_PATH" >&2; exit 1; }
[[ -f "$ENV_PATH" ]] || { echo "missing $ENV_PATH" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum is required" >&2; exit 1; }
command -v df >/dev/null 2>&1 || { echo "df is required" >&2; exit 1; }

if [[ -z "$OUTPUT_ROOT" ]]; then
  OUTPUT_ROOT="$XDRIVE_HOME/backups/snapshots"
fi
mkdir -p "$OUTPUT_ROOT"
OUTPUT_ROOT="$(cd "$OUTPUT_ROOT" && pwd)"

compose() {
  docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@" </dev/null
}

env_value() {
  local key="$1"
  grep "^${key}=" "$ENV_PATH" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '\r' || true
}


BACKUP_PROGRESS_FILE="${XD_BACKUP_PROGRESS_FILE:-}"
BACKUP_PROGRESS_STAGE_CURRENT="${XD_BACKUP_PROGRESS_STAGE_CURRENT:-0}"
BACKUP_PROGRESS_STAGE_TOTAL="${XD_BACKUP_PROGRESS_STAGE_TOTAL:-0}"
BACKUP_PROGRESS_STAGE_NAME="${XD_BACKUP_PROGRESS_STAGE_NAME:-create backup}"
BACKUP_PROGRESS_LOG_INTERVAL="${XD_BACKUP_PROGRESS_LOG_INTERVAL_SECONDS:-5}"
case "$BACKUP_PROGRESS_LOG_INTERVAL" in
  ''|*[!0-9]*) BACKUP_PROGRESS_LOG_INTERVAL=5 ;;
esac
(( BACKUP_PROGRESS_LOG_INTERVAL >= 1 )) || BACKUP_PROGRESS_LOG_INTERVAL=1

write_backup_progress() {
  local service="${1:-}" bytes_done="${2:-0}" bytes_total="${3:-0}" target="$BACKUP_PROGRESS_FILE" tmp
  [[ -n "$target" ]] || return 0
  [[ "$bytes_done" =~ ^[0-9]+$ ]] || bytes_done=0
  [[ "$bytes_total" =~ ^[0-9]+$ ]] || bytes_total=0
  mkdir -p "$(dirname "$target")" 2>/dev/null || return 0
  tmp="$(mktemp "$(dirname "$target")/.backup-progress.XXXXXX" 2>/dev/null)" || return 0
  {
    printf 'stage_current=%s\n' "$BACKUP_PROGRESS_STAGE_CURRENT"
    printf 'stage_total=%s\n' "$BACKUP_PROGRESS_STAGE_TOTAL"
    printf 'stage=%s\n' "$BACKUP_PROGRESS_STAGE_NAME"
    printf 'service=%s\n' "$service"
    printf 'bytes_done=%s\n' "$bytes_done"
    printf 'bytes_total=%s\n' "$bytes_total"
  } > "$tmp"
  chmod 0644 "$tmp" 2>/dev/null || true
  mv -f "$tmp" "$target" 2>/dev/null || rm -f "$tmp"
}

format_bytes() {
  awk -v bytes="${1:-0}" 'BEGIN {
    split("B KiB MiB GiB TiB PiB EiB", unit, " ");
    n = bytes + 0; i = 1;
    while (n >= 1024 && i < 7) { n /= 1024; i++ }
    if (i == 1) printf "%.0f %s", n, unit[i]; else printf "%.1f %s", n, unit[i]
  }'
}

file_size_bytes() {
  local file="$1"
  stat -c %s "$file" 2>/dev/null || printf '0\n'
}

print_backup_progress() {
  local label="$1" bytes_done="${2:-0}" bytes_total="${3:-0}" pct
  if (( bytes_total > 0 )); then
    (( bytes_done > bytes_total )) && bytes_done="$bytes_total"
    pct=$(( bytes_done * 100 / bytes_total ))
    printf '[xDrive] backup: %s | %s / %s (%s%%)\n' \
      "$label" "$(format_bytes "$bytes_done")" "$(format_bytes "$bytes_total")" "$pct" >&2
  elif (( bytes_done > 0 )); then
    printf '[xDrive] backup: %s | %s written\n' "$label" "$(format_bytes "$bytes_done")" >&2
  else
    printf '[xDrive] backup: %s\n' "$label" >&2
  fi
}

run_to_file_with_progress() {
  local label="$1" output="$2" bytes_total="${3:-0}" pid status=0 bytes_done=0 now last_log=0
  shift 3

  write_backup_progress "$label" 0 "$bytes_total"
  print_backup_progress "$label" 0 "$bytes_total"
  "$@" > "$output" &
  pid=$!

  while kill -0 "$pid" 2>/dev/null; do
    bytes_done="$(file_size_bytes "$output")"
    [[ "$bytes_done" =~ ^[0-9]+$ ]] || bytes_done=0
    if (( bytes_total > 0 && bytes_done > bytes_total )); then
      bytes_done="$bytes_total"
    fi
    write_backup_progress "$label" "$bytes_done" "$bytes_total"
    now="$(date +%s)"
    if (( now - last_log >= BACKUP_PROGRESS_LOG_INTERVAL )); then
      print_backup_progress "$label" "$bytes_done" "$bytes_total"
      last_log="$now"
    fi
    sleep 1
  done

  if wait "$pid"; then
    status=0
  else
    status=$?
  fi
  bytes_done="$(file_size_bytes "$output")"
  [[ "$bytes_done" =~ ^[0-9]+$ ]] || bytes_done=0
  if (( status == 0 && bytes_total > 0 )); then
    bytes_done="$bytes_total"
  elif (( bytes_total > 0 && bytes_done > bytes_total )); then
    bytes_done="$bytes_total"
  fi
  write_backup_progress "$label" "$bytes_done" "$bytes_total"
  print_backup_progress "$label" "$bytes_done" "$bytes_total"
  return "$status"
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
  echo "xDrive API did not become ready after backup" >&2
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

restart_services() {
  if [[ "$LEAVE_SERVER_STOPPED" == "1" ]]; then
    return
  fi
  if [[ "$server_was_running" == "1" ]]; then
    compose start server >/dev/null 2>&1 || return
    wait_server || return
  fi
  if [[ "$worker_was_running" == "1" && "$server_was_running" == "1" ]]; then
    compose start worker >/dev/null 2>&1 || true
  fi
}
trap restart_services EXIT INT TERM

compose up -d postgres >/dev/null
wait_postgres

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

write_backup_progress "计算备份大小" 0 0
print_backup_progress "计算备份大小" 0 0

blob_bytes=0
if [[ "$INCLUDE_FILE_DATA" == "1" ]]; then
  blob_bytes="$(docker run --rm --entrypoint sh \
    -v "$data_source:/data:ro" \
    "$postgres_image" \
    -c "du -sk /data | awk '{print \$1 * 1024}'" </dev/null)"
fi
database_bytes="$(compose exec -T postgres psql -U xdrive -d postgres -Atqc "SELECT pg_database_size('xdrive')" | tr -d '\r')"
available_bytes="$(df -PB1 "$OUTPUT_ROOT" | awk 'NR==2 {print $4}')"
for pair in "blob_bytes=$blob_bytes" "database_bytes=$database_bytes" "available_bytes=$available_bytes"; do
  value="${pair#*=}"
  [[ "$value" =~ ^[0-9]+$ ]] || {
    echo "backup space preflight failed: invalid ${pair%%=*} value: $value" >&2
    exit 1
  }
done
estimated_source_bytes=$(( blob_bytes + database_bytes ))
required_bytes=$(( estimated_source_bytes + estimated_source_bytes / 10 + 64 * 1024 * 1024 ))
echo "[xDrive] backup space preflight: source≈$(format_bytes "$estimated_source_bytes"), required≈$(format_bytes "$required_bytes"), available=$(format_bytes "$available_bytes")" >&2
if (( available_bytes < required_bytes )); then
  echo "backup aborted: insufficient free space in $OUTPUT_ROOT" >&2
  echo "required approximately $(format_bytes "$required_bytes"); available $(format_bytes "$available_bytes")." >&2
  exit 1
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
final_dir="$OUTPUT_ROOT/xdrive-backup-$stamp"
partial_dir="$final_dir.partial"
[[ ! -e "$final_dir" && ! -e "$partial_dir" ]] || { echo "backup path already exists: $final_dir" >&2; exit 1; }
mkdir -p "$partial_dir"

if [[ "$worker_was_running" == "1" ]]; then
  compose stop worker >/dev/null 2>&1 || true
fi
compose stop server >/dev/null 2>&1 || true

write_backup_progress "一致性检查" 0 0
print_backup_progress "一致性检查" 0 0
verify_status=0
compose run -T --rm --no-deps server storage verify --json </dev/null > "$partial_dir/verify.json" || verify_status=$?
if [[ "$verify_status" != "0" && "$ALLOW_INCONSISTENT" != "1" ]]; then
  echo "xDrive consistency verification failed; backup aborted." >&2
  cat "$partial_dir/verify.json" >&2 || true
  rm -rf "$partial_dir"
  exit "$verify_status"
fi

run_to_file_with_progress "备份数据库" "$partial_dir/database.dump" 0 \
  compose exec -T postgres pg_dump -U xdrive -d xdrive -Fc

if [[ "$INCLUDE_FILE_DATA" == "1" ]]; then
  run_to_file_with_progress "备份文件数据" "$partial_dir/blobs.tar" "$blob_bytes" \
    docker run --rm --entrypoint sh \
      -v "$data_source:/data:ro" \
      "$postgres_image" \
      -c 'cd /data && tar -cf - .'
else
  write_backup_progress "跳过文件数据备份" 0 0
  print_backup_progress "跳过文件数据备份（升级选项未开启）" 0 0
fi

write_backup_progress "生成备份清单" 0 0
print_backup_progress "生成备份清单" 0 0

created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
server_image="$(compose config --images | grep 'xdrive-server' | head -n1 || true)"
caddy_image="$(compose config --images | grep 'xdrive-caddy' | head -n1 || true)"
release_channel="$(env_value XD_RELEASE_CHANNEL)"
release_commit="$(env_value XD_RELEASE_COMMIT)"
update_source="$(env_value XD_UPDATE_SOURCE)"
docker_mode="$(env_value XD_DOCKER_MODE)"
cat > "$partial_dir/manifest.json" <<EOF
{
  "format_version": 1,
  "created_at_utc": "$created_at",
  "database": {"file": "database.dump", "format": "pg_dump_custom"},
  "blobs": $([[ "$INCLUDE_FILE_DATA" == "1" ]] && printf '{"file":"blobs.tar","format":"tar"}' || printf 'null'),
  "file_data_included": $([[ "$INCLUDE_FILE_DATA" == "1" ]] && echo true || echo false),
  "consistency_verified": $([[ "$verify_status" == "0" ]] && echo true || echo false),
  "server_image": "$server_image",
  "caddy_image": "$caddy_image",
  "release_channel": "$release_channel",
  "release_commit": "$release_commit",
  "update_source": "$update_source",
  "docker_mode": "$docker_mode",
  "estimated_blob_bytes": $blob_bytes,
  "estimated_database_bytes": $database_bytes,
  "preflight_required_bytes": $required_bytes,
  "preflight_available_bytes": $available_bytes
}
EOF

checksum_files=(database.dump verify.json manifest.json)
[[ "$INCLUDE_FILE_DATA" == "1" ]] && checksum_files+=(blobs.tar)
checksum_total=0
for checksum_name in "${checksum_files[@]}"; do
  checksum_size="$(file_size_bytes "$partial_dir/$checksum_name")"
  [[ "$checksum_size" =~ ^[0-9]+$ ]] || checksum_size=0
  checksum_total=$(( checksum_total + checksum_size ))
done
checksum_done=0
: > "$partial_dir/SHA256SUMS.txt"
for checksum_name in "${checksum_files[@]}"; do
  write_backup_progress "校验备份完整性 · $checksum_name" "$checksum_done" "$checksum_total"
  print_backup_progress "校验备份完整性 · $checksum_name" "$checksum_done" "$checksum_total"
  (
    cd "$partial_dir"
    sha256sum "$checksum_name"
  ) >> "$partial_dir/SHA256SUMS.txt"
  checksum_size="$(file_size_bytes "$partial_dir/$checksum_name")"
  [[ "$checksum_size" =~ ^[0-9]+$ ]] || checksum_size=0
  checksum_done=$(( checksum_done + checksum_size ))
  write_backup_progress "校验备份完整性 · $checksum_name" "$checksum_done" "$checksum_total"
done
(
  cd "$partial_dir"
  sha256sum -c SHA256SUMS.txt >/dev/null
)
write_backup_progress "完成升级前备份" "$checksum_total" "$checksum_total"
print_backup_progress "完成升级前备份" "$checksum_total" "$checksum_total"

mv "$partial_dir" "$final_dir"
printf '%s\n' "$final_dir"
