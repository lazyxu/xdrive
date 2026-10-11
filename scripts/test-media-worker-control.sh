#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temp="$(mktemp -d)"
trap 'rm -rf "$temp"' EXIT
export XD_CONFIG_DIR="$temp"
export XDRIVE_MEDIA_FAKE_STATE="$temp/media-running"
export XDRIVE_MEDIA_FAKE_CALLS="$temp/docker-calls"
mkdir -p "$temp/config" "$temp/bin" "$temp/logs" "$temp/fakebin"
printf 'COMPOSE_PROFILES=photo-intelligence\nXD_MEDIA_WORKER_MEMORY_LIMIT=768m\nXD_MEDIA_WORKER_CPU_LIMIT=0.75\nXD_TEST_UNRELATED=keep\n' > "$temp/config/.env"
printf 'services:\n  media-worker:\n    image: fixture\n' > "$temp/config/docker-compose.yml"
cat > "$temp/fakebin/docker" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$XDRIVE_MEDIA_FAKE_CALLS"
case "$*" in
  *"ps --status running --services media-worker")
    if [[ -f "$XDRIVE_MEDIA_FAKE_STATE" ]]; then echo media-worker; fi
    ;;
  *"inspect --format {{.HostConfig.Memory}} xdrive-media-worker")
    [[ -f "$XDRIVE_MEDIA_FAKE_STATE" ]] || exit 1
    memory="$(sed -nE 's/^XD_MEDIA_WORKER_MEMORY_LIMIT=([0-9]+)m$/\1/p' "$XD_CONFIG_DIR/config/.env" | tail -n 1)"
    [[ "$memory" =~ ^[0-9]+$ ]] || exit 1
    printf '%s\n' "$(( memory * 1048576 ))"
    ;;
  *"inspect --format {{.HostConfig.NanoCpus}} xdrive-media-worker")
    [[ -f "$XDRIVE_MEDIA_FAKE_STATE" ]] || exit 1
    if [[ -n "${XDRIVE_MEDIA_FAKE_CPU_DRIFT:-}" ]]; then
      printf '%s\n' "$XDRIVE_MEDIA_FAKE_CPU_DRIFT"
    else
      cpu="$(sed -nE 's/^XD_MEDIA_WORKER_CPU_LIMIT=([0-9]+\.[0-9]+)$/\1/p' "$XD_CONFIG_DIR/config/.env" | tail -n 1)"
      [[ -n "$cpu" ]] || exit 1
      awk -v cpu="$cpu" 'BEGIN { printf "%.0f\n", cpu * 1000000000 }'
    fi
    ;;
  *"up -d --no-deps --force-recreate media-worker") touch "$XDRIVE_MEDIA_FAKE_STATE" ;;
  *"exec -T media-worker xdrive-server media-worker check")
    [[ -f "$XDRIVE_MEDIA_FAKE_STATE" ]] ;;
  *"stop media-worker") rm -f "$XDRIVE_MEDIA_FAKE_STATE" ;;
  *) echo "unexpected Docker invocation: $*" >&2; exit 2 ;;
esac
FAKE
chmod +x "$temp/fakebin/docker"
export PATH="$temp/fakebin:$PATH"
export XD_HOST_CONTROL_SOURCE_ONLY=1
source "$ROOT/scripts/server-control.sh"
unset XD_HOST_CONTROL_SOURCE_ONLY
media_worker_control_refresh
dir="$(prepare_dir)"
status_file="$dir/media-worker-control-status.json"
test "$(json_value "$status_file" state)" = idle
test "$(json_bool_value "$status_file" observed_enabled)" = false

request_id=0123456789abcdef01234567
make_request() {
  local revision="$1" enabled="$2" memory="$3" cpu="${4:-750}"
  printf '{"request_id":"%s","revision":%s,"enabled":%s,"memory_mib":%s,"cpu_milli":%s,"created_at":"%s"}\n' \
    "$request_id" "$revision" "$enabled" "$memory" "$cpu" "$(now_utc)" > "$dir/media-worker-control-request.json"
}

# Start with the default cgroup memory allocation (768 MiB).
make_request 1 true 768
media_worker_control_process
test "$(json_value "$status_file" state)" = success
test "$(media_worker_control_uint "$status_file" applied_revision)" = 1
test "$(media_worker_control_uint "$status_file" observed_memory_mib)" = 768
test "$(json_bool_value "$status_file" cpu_control_supported)" = true
test "$(media_worker_control_uint "$status_file" observed_cpu_milli)" = 750
test "$(json_bool_value "$status_file" cpu_verified)" = true
test "$(json_bool_value "$status_file" memory_verified)" = true
test "$(json_bool_value "$status_file" observed_enabled)" = true
grep -Fxq 'COMPOSE_PROFILES=photo-intelligence,media-worker' "$temp/config/.env"
grep -Fxq 'XD_TEST_UNRELATED=keep' "$temp/config/.env"

# An invalid resource limit is rejected before recreating anything.
previous_calls="$(wc -l < "$XDRIVE_MEDIA_FAKE_CALLS")"
make_request 2 true 999
media_worker_control_process
test "$(json_value "$status_file" state)" = failed
test "$(media_worker_control_uint "$status_file" applied_revision)" = 1
grep -Fxq 'XD_MEDIA_WORKER_MEMORY_LIMIT=768m' "$temp/config/.env"
# Invalid control must not accidentally run up/stop commands.
test "$(grep -E ' (up -d|stop) ' "$XDRIVE_MEDIA_FAKE_CALLS" | wc -l)" = 1

# Changing only the optional Worker memory re-creates only that container.
make_request 2 true 1024
media_worker_control_process
test "$(json_value "$status_file" state)" = success
test "$(media_worker_control_uint "$status_file" applied_revision)" = 2
test "$(media_worker_control_uint "$status_file" observed_memory_mib)" = 1024
test "$(json_bool_value "$status_file" memory_verified)" = true
grep -Fxq 'XD_MEDIA_WORKER_MEMORY_LIMIT=1024m' "$temp/config/.env"
grep -Fxq 'COMPOSE_PROFILES=photo-intelligence,media-worker' "$temp/config/.env"

# Reject invalid and old-schema CPU requests before touching Docker.
make_request 3 true 1024 251
media_worker_control_process
test "$(json_value "$status_file" state)" = failed
test "$(media_worker_control_uint "$status_file" applied_revision)" = 2
grep -Fxq 'XD_MEDIA_WORKER_CPU_LIMIT=0.75' "$temp/config/.env"
printf '{"request_id":"%s","revision":3,"enabled":true,"memory_mib":1024,"created_at":"%s"}\n' \
  "$request_id" "$(now_utc)" > "$dir/media-worker-control-request.json"
media_worker_control_process
test "$(json_value "$status_file" state)" = failed
test "$(media_worker_control_uint "$status_file" applied_revision)" = 2

# CPU-only change must recreate media-worker and inspect NanoCpus.
make_request 3 true 1024 1250
media_worker_control_process
test "$(json_value "$status_file" state)" = success
test "$(media_worker_control_uint "$status_file" applied_revision)" = 3
test "$(media_worker_control_uint "$status_file" observed_cpu_milli)" = 1250
test "$(json_bool_value "$status_file" cpu_verified)" = true
grep -Fxq 'XD_MEDIA_WORKER_CPU_LIMIT=1.25' "$temp/config/.env"

# CPU drift from actual cgroup state must remove applied status.
export XDRIVE_MEDIA_FAKE_CPU_DRIFT=1000000000
media_worker_control_refresh
test "$(json_value "$status_file" state)" = failed
test "$(media_worker_control_uint "$status_file" observed_cpu_milli)" = 1000
unset XDRIVE_MEDIA_FAKE_CPU_DRIFT
make_request 3 true 1024 1250
media_worker_control_process
test "$(json_value "$status_file" state)" = success

# An old revision cannot alter the live policy or disable the Worker.
make_request 1 false 768 750
media_worker_control_process
test "$(json_value "$status_file" state)" = failed
test "$(media_worker_control_uint "$status_file" applied_revision)" = 3
test "$(json_bool_value "$status_file" observed_enabled)" = true
grep -Fxq 'XD_MEDIA_WORKER_MEMORY_LIMIT=1024m' "$temp/config/.env"

# Disabling keeps the resource setting for the next controlled startup.
make_request 4 false 1024 1250
media_worker_control_process
test "$(json_value "$status_file" state)" = success
test "$(json_bool_value "$status_file" observed_enabled)" = false
test "$(media_worker_control_uint "$status_file" observed_memory_mib)" = 1024
test "$(json_bool_value "$status_file" memory_verified)" = true
test "$(media_worker_control_uint "$status_file" observed_cpu_milli)" = 1250
test "$(json_bool_value "$status_file" cpu_verified)" = true
grep -Fxq 'COMPOSE_PROFILES=photo-intelligence' "$temp/config/.env"
grep -Fxq 'XD_MEDIA_WORKER_MEMORY_LIMIT=1024m' "$temp/config/.env"

# Drift: container appears unexpectedly after disabled status. Detect, then
# explicitly reapply the same revision only after the failed status.
touch "$XDRIVE_MEDIA_FAKE_STATE"
media_worker_control_refresh
test "$(json_value "$status_file" state)" = failed
make_request 4 false 1024 1250
media_worker_control_process
test "$(json_value "$status_file" state)" = success
test "$(json_bool_value "$status_file" observed_enabled)" = false
test "$(media_worker_control_uint "$status_file" applied_revision)" = 4
! grep -Eq '(^| )(down|restart|kill|rm)( |$)' "$XDRIVE_MEDIA_FAKE_CALLS"
! grep -E '(up -d|stop) .* (server|postgres|caddy|photo-face|worker)$' "$XDRIVE_MEDIA_FAKE_CALLS"
grep -Fxq 'XD_TEST_UNRELATED=keep' "$temp/config/.env"
test ! -f "$dir/media-worker-control-request.json"
test ! -f "$dir/media-worker-control-active.json"
echo "Media Worker restricted start/stop/memory/CPU cgroup verification, profile preservation and revision fences: OK"
