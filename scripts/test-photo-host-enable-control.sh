#!/usr/bin/env bash
set -euo pipefail
trap 'rc=$?; echo "photo-host test failed near line $LINENO ($BASH_COMMAND), exit $rc" >&2; exit "$rc"' ERR
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temp="$(mktemp -d)"
trap 'rm -rf "$temp"' EXIT
export XD_CONFIG_DIR="$temp"
export XD_PHOTO_HOST_FAKE_STATE="$temp/photo-running"
export XD_PHOTO_HOST_FAKE_CALLS="$temp/docker-calls"
mkdir -p "$temp/config" "$temp/fakebin" "$temp/logs"
printf 'COMPOSE_PROFILES=media-worker\nXD_UNRELATED=keep\n' > "$temp/config/.env"
printf 'services:\n  photo-face:\n    image: fixture\n' > "$temp/config/docker-compose.yml"
cat > "$temp/fakebin/docker" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$XD_PHOTO_HOST_FAKE_CALLS"
case "$*" in
  "info") exit 0 ;;
  "inspect --format {{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{end}} xdrive-photo-face")
    if [[ -f "$XD_PHOTO_HOST_FAKE_STATE" ]]; then
      [[ -z "${XD_PHOTO_HOST_FAKE_UNHEALTHY:-}" ]] && echo 'true|healthy' || echo 'true|unhealthy'
    else
      echo 'false|'
    fi
    ;;
  *"config --quiet") exit 0 ;;
  *"up -d --no-deps photo-face")
    [[ -z "${XD_PHOTO_HOST_FAKE_FAIL_UP:-}" ]] || exit 1
    touch "$XD_PHOTO_HOST_FAKE_STATE"
    ;;
  *"stop photo-face") rm -f "$XD_PHOTO_HOST_FAKE_STATE" ;;
  *) printf 'unexpected Docker command: %s\n' "$*" >&2; exit 2 ;;
esac
FAKE
chmod +x "$temp/fakebin/docker"
export PATH="$temp/fakebin:$PATH"
export XD_HOST_CONTROL_SOURCE_ONLY=1
source "$ROOT/scripts/server-control.sh"
unset XD_HOST_CONTROL_SOURCE_ONLY
dir="$(prepare_dir)"
status="$dir/photo-host-control-status.json"
photo_host_control_refresh
test "$(json_value "$status" state)" = idle
test "$(photo_host_control_uint "$status" applied_revision)" = 0
make_request() {
  local revision="$1" enabled="$2" time="${3:-$(now_utc)}"
  printf '{"request_id":"0123456789abcdef01234567","revision":%s,"enabled":%s,"created_at":"%s"}\n' \
    "$revision" "$enabled" "$time" > "$dir/photo-host-control-request.json"
}
make_request 1 true
photo_host_control_process
test "$(json_value "$status" state)" = success
test "$(photo_host_control_uint "$status" applied_revision)" = 1
test "$(json_bool_value "$status" profile_verified)" = true
test -f "$XD_PHOTO_HOST_FAKE_STATE"
grep -Fxq 'COMPOSE_PROFILES=media-worker,photo-intelligence' "$temp/config/.env"
grep -Fxq 'XD_UNRELATED=keep' "$temp/config/.env"
test ! -e "$dir/photo-host-control-active.json"
test ! -e "$dir/photo-host-control-recovery"

# An already-healthy fixed container can acknowledge a new revision without
# a second start or any force-recreation of in-flight Photo Intelligence work.
before="$(grep -c 'up -d --no-deps photo-face' "$XD_PHOTO_HOST_FAKE_CALLS")"
make_request 2 true
photo_host_control_process
test "$(json_value "$status" state)" = success
test "$(photo_host_control_uint "$status" applied_revision)" = 2
test "$(grep -c 'up -d --no-deps photo-face' "$XD_PHOTO_HOST_FAKE_CALLS")" = "$before"

# Disable is strictly rejected, not translated into an unauthorized stop.
make_request 3 false
photo_host_control_process
test "$(json_value "$status" state)" = failed
test "$(photo_host_control_uint "$status" applied_revision)" = 2
test -f "$XD_PHOTO_HOST_FAKE_STATE"
grep -Fxq 'COMPOSE_PROFILES=media-worker,photo-intelligence' "$temp/config/.env"

# A stale request must not invoke a host action.
before="$(wc -l < "$XD_PHOTO_HOST_FAKE_CALLS")"
make_request 1 true
photo_host_control_process
test "$(json_value "$status" state)" = failed
test "$(wc -l < "$XD_PHOTO_HOST_FAKE_CALLS")" -ge "$before"
test "$(photo_host_control_uint "$status" applied_revision)" = 2

# Never restart or force-recreate an unhealthy running analyzer.
export XD_PHOTO_HOST_FAKE_UNHEALTHY=1
make_request 3 true
photo_host_control_process
test "$(json_value "$status" state)" = failed
test "$(photo_host_control_uint "$status" applied_revision)" = 2
unset XD_PHOTO_HOST_FAKE_UNHEALTHY

# A failed new start reverts only the Profile; it cannot advance revision.
rm -f "$XD_PHOTO_HOST_FAKE_STATE"
printf 'COMPOSE_PROFILES=media-worker\nXD_UNRELATED=keep\n' > "$temp/config/.env"
export XD_PHOTO_HOST_FAKE_FAIL_UP=1
make_request 3 true
photo_host_control_process
test "$(json_value "$status" state)" = failed
test "$(photo_host_control_uint "$status" applied_revision)" = 2
test ! -f "$XD_PHOTO_HOST_FAKE_STATE"
grep -Fxq 'COMPOSE_PROFILES=media-worker' "$temp/config/.env"
grep -Fxq 'XD_UNRELATED=keep' "$temp/config/.env"
unset XD_PHOTO_HOST_FAKE_FAIL_UP

# A recorded photo-only .env mutation can recover after an interrupted runner.
printf 'media-worker\nfalse\n' > "$dir/photo-host-control-recovery"
printf 'COMPOSE_PROFILES=media-worker,photo-intelligence\nXD_UNRELATED=keep\n' > "$temp/config/.env"
touch "$XD_PHOTO_HOST_FAKE_STATE"
photo_host_control_recover
test ! -f "$XD_PHOTO_HOST_FAKE_STATE"
test ! -e "$dir/photo-host-control-recovery"
grep -Fxq 'COMPOSE_PROFILES=media-worker' "$temp/config/.env"
grep -Fxq 'XD_UNRELATED=keep' "$temp/config/.env"

! grep -Eq '(^| )(down|restart|kill|rm|exec)( |$)|force-recreate' "$XD_PHOTO_HOST_FAKE_CALLS"
! grep -E '(up -d|stop) .* (server|worker|media-worker|postgres|caddy)$' "$XD_PHOTO_HOST_FAKE_CALLS"
echo "Restricted photo host enable, revision fences and safe rollback: OK"
