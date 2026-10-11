#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temp="$(mktemp -d)"
trap 'rm -rf "$temp"' EXIT
export XD_CONFIG_DIR="$temp"
export XDRIVE_MEDIA_FAKE_STATE="$temp/media-running"
export XDRIVE_MEDIA_FAKE_CALLS="$temp/docker-calls"
mkdir -p "$temp/config" "$temp/bin" "$temp/logs" "$temp/fakebin"
printf 'COMPOSE_PROFILES=photo-intelligence\nXD_TEST_UNRELATED=keep\n' > "$temp/config/.env"
printf 'services:\n  media-worker:\n    image: fixture\n' > "$temp/config/docker-compose.yml"
cat > "$temp/fakebin/docker" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$XDRIVE_MEDIA_FAKE_CALLS"
case "$*" in
  *"ps --status running --services media-worker")
    if [[ -f "$XDRIVE_MEDIA_FAKE_STATE" ]]; then echo media-worker; fi
    ;;
  *"up -d --no-deps media-worker") touch "$XDRIVE_MEDIA_FAKE_STATE" ;;
  *"exec -T media-worker xdrive-server media-worker check")
    [[ -f "$XDRIVE_MEDIA_FAKE_STATE" ]] ;;
  *"stop media-worker") rm -f "$XDRIVE_MEDIA_FAKE_STATE" ;;
  *) echo "unexpected Docker invocation" >&2; exit 2 ;;
esac
FAKE
chmod +x "$temp/fakebin/docker"
export PATH="$temp/fakebin:$PATH"
export XD_HOST_CONTROL_SOURCE_ONLY=1
# Load only the restricted Host Manager functions; no real service starts.
source "$ROOT/scripts/server-control.sh"
unset XD_HOST_CONTROL_SOURCE_ONLY
media_worker_control_refresh
dir="$(prepare_dir)"
status_file="$dir/media-worker-control-status.json"
test "$(json_value "$status_file" state)" = idle
test "$(json_bool_value "$status_file" observed_enabled)" = false

request_id=0123456789abcdef01234567
printf '{"request_id":"%s","revision":1,"enabled":true,"created_at":"%s"}\n' \
  "$request_id" "$(now_utc)" > "$dir/media-worker-control-request.json"
media_worker_control_process
test "$(json_value "$status_file" state)" = success
test "$(media_worker_control_uint "$status_file" applied_revision)" = 1
test "$(json_bool_value "$status_file" observed_enabled)" = true
grep -Fxq 'COMPOSE_PROFILES=photo-intelligence,media-worker' "$temp/config/.env"
grep -Fxq 'XD_TEST_UNRELATED=keep' "$temp/config/.env"
# A stale revision is rejected before executing any command.
before="$(wc -l < "$XDRIVE_MEDIA_FAKE_CALLS")"
printf '{"request_id":"%s","revision":1,"enabled":false,"created_at":"%s"}\n' \
  "$request_id" "$(now_utc)" > "$dir/media-worker-control-request.json"
media_worker_control_process
test "$(json_value "$status_file" state)" = failed
test "$(json_bool_value "$status_file" observed_enabled)" = true
test "$(media_worker_control_uint "$status_file" applied_revision)" = 1
grep -Fxq 'COMPOSE_PROFILES=photo-intelligence,media-worker' "$temp/config/.env"
# Allow a new audited revision to stop ONLY the optional media-worker.
printf '{"request_id":"%s","revision":2,"enabled":false,"created_at":"%s"}\n' \
  "$request_id" "$(now_utc)" > "$dir/media-worker-control-request.json"
media_worker_control_process
test "$(json_value "$status_file" state)" = success
test "$(json_bool_value "$status_file" observed_enabled)" = false
test "$(media_worker_control_uint "$status_file" applied_revision)" = 2
grep -Fxq 'COMPOSE_PROFILES=photo-intelligence' "$temp/config/.env"
grep -Fxq 'XD_TEST_UNRELATED=keep' "$temp/config/.env"
! grep -Eq '(^| )(down|restart|kill|rm)( |$)' "$XDRIVE_MEDIA_FAKE_CALLS"
test ! -f "$dir/media-worker-control-request.json"
test ! -f "$dir/media-worker-control-active.json"
# Detect real drift and permit re-applying the SAME revision only after
# observed failure. A successful version must not be blindly replayed.
touch "$XDRIVE_MEDIA_FAKE_STATE"
media_worker_control_refresh
test "$(json_value "$status_file" state)" = failed
printf '{"request_id":"%s","revision":2,"enabled":false,"created_at":"%s"}\n' \
  "$request_id" "$(now_utc)" > "$dir/media-worker-control-request.json"
media_worker_control_process
test "$(json_value "$status_file" state)" = success
test "$(json_bool_value "$status_file" observed_enabled)" = false
test "$(media_worker_control_uint "$status_file" applied_revision)" = 2
echo "Media Worker Host Manager restricted on/off, revision fence, drift retry and profile persistence: OK"
