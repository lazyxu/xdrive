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
  "inspect --format {{.State.Pid}} xdrive-photo-face")
    printf '%s\n' "${XD_TEST_PHOTO_WRONG_PID:-${XD_TEST_PHOTO_PID:-0}}" ;;
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

# Action-time generation is pinned; status refresh must never re-seal it.
# The synthetic digest below is a fixture, not production model evidence.
sealed_digest="$(printf '%064d' 7)"
photo_host_control_write_status success 2 2 true '0123456789abcdef01234567' healthy true "$sealed_digest"
test "$(json_value "$status" applied_instance_digest)" = "$sealed_digest"
photo_host_control_refresh
test "$(json_value "$status" applied_instance_digest)" = "$sealed_digest"
photo_host_control_write_status success 2 2 true '0123456789abcdef01234567' healthy true invalid
test -z "$(json_value "$status" applied_instance_digest)"
photo_host_control_write_status failed 3 2 true '0123456789abcdef01234567' unhealthy false "$sealed_digest"
test -z "$(json_value "$status" applied_instance_digest)"
photo_host_control_write_status success 2 2 true '0123456789abcdef01234567' healthy true "$sealed_digest"

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


# P1-PH1b2c2b2b2b1: model-side authentication with a *real* local Unix
# peer. The client must verify Linux SO_PEERCRED PID before sending secrets.
mkdir -p "$temp/state/photo-face"
export XD_PHOTO_HOST_TEST_SOCKET="$temp/state/photo-face/photo-face.sock"
export XD_TEST_PHOTO_TOKEN="$(printf 'a%.0s' {1..64})"
export XD_TEST_PHOTO_DIGEST="$(printf '%064d' 7)"
export XD_TEST_PHOTO_WRONG_ACK_FLAG="$temp/invalid-ack.flag"
cat > "$temp/test-photo-ack-server.py" <<'PY'
import json
import os
import socket
import sys

path, token, digest, mismatch_file = sys.argv[1:]
listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
listener.bind(path)
listener.listen(8)
try:
    while True:
        peer, _ = listener.accept()
        with peer:
            peer.settimeout(3)
            raw = b""
            try:
                while b"\r\n\r\n" not in raw and len(raw) < 2048:
                    next_part = peer.recv(2048)
                    if not next_part:
                        break
                    raw += next_part
                if b"\r\n\r\n" not in raw:
                    continue
                header, body = raw.split(b"\r\n\r\n", 1)
                if b"Authorization: Bearer " + token.encode() not in header:
                    continue
                size = 0
                for line in header.decode("ascii").split("\r\n"):
                    if line.lower().startswith("content-length:"):
                        size = int(line.split(":", 1)[1].strip())
                if size <= 0 or size > 256:
                    continue
                while len(body) < size:
                    part = peer.recv(size - len(body))
                    if not part:
                        break
                    body += part
                req = json.loads(body[:size])
                if req.get("runtime_instance_sha256") != digest:
                    continue
                response_id = req["request_id"]
                if os.path.exists(mismatch_file):
                    response_id = "0" * 24
                response = json.dumps({
                    "acknowledged": True,
                    "revision": req["revision"],
                    "request_id": response_id,
                    "runtime_instance_sha256": digest,
                }, separators=(",", ":")).encode("ascii")
                headers = (
                    "HTTP/1.1 200 OK\r\n"
                    "Content-Type: application/json\r\n"
                    "Connection: close\r\n"
                    "Content-Length: " + str(len(response)) + "\r\n\r\n"
                ).encode("ascii")
                peer.sendall(headers + response)
            except (OSError, ValueError, KeyError, UnicodeError):
                continue
finally:
    listener.close()
PY
python3 "$temp/test-photo-ack-server.py" "$XD_PHOTO_HOST_TEST_SOCKET" \
  "$XD_TEST_PHOTO_TOKEN" "$XD_TEST_PHOTO_DIGEST" "$XD_TEST_PHOTO_WRONG_ACK_FLAG" &
socket_pid="$!"
export XD_TEST_PHOTO_PID="$socket_pid"
trap 'kill "${socket_pid:-}" 2>/dev/null || true; rm -rf "$temp"' EXIT
for _ in $(seq 1 30); do
  [[ -S "$XD_PHOTO_HOST_TEST_SOCKET" ]] && break
  sleep 0.1
done
test -S "$XD_PHOTO_HOST_TEST_SOCKET"
printf 'COMPOSE_PROFILES=media-worker\nXD_UNRELATED=keep\nXD_PHOTO_HOST_APPLY_TOKEN=%s\nXD_PHOTO_FACE_RUNTIME_DIR=%s\n' \
  "$XD_TEST_PHOTO_TOKEN" "$temp/state/photo-face" > "$temp/config/.env"
# Only the kernel listener owner lookup is isolated by the fixture; the new
# host-model client independently verifies true SO_PEERCRED and /proc ticks.
photo_intelligence_socket_owner_observed() { return 0; }
photo_intelligence_socket_owned_by_pid() { return 0; }
photo_intelligence_healthcheck_digest() { printf '%s\n' "$XD_TEST_PHOTO_DIGEST"; }
make_request 4 true
photo_host_control_process
test "$(json_value "$status" state)" = success
test "$(json_bool_value "$status" model_ack_at_apply)" = true
test "$(json_value "$status" applied_instance_digest)" = "$XD_TEST_PHOTO_DIGEST"
photo_host_control_refresh
test "$(json_bool_value "$status" model_ack_at_apply)" = true
# A model response that acknowledges another request cannot become true.
touch "$XD_TEST_PHOTO_WRONG_ACK_FLAG"
make_request 5 true
photo_host_control_process
test "$(json_value "$status" state)" = success
test "$(json_bool_value "$status" model_ack_at_apply)" = false
rm -f "$XD_TEST_PHOTO_WRONG_ACK_FLAG"
# A forged Docker PID cannot obtain the secret from the legitimate Socket:
# SO_PEERCRED disagrees, so the same safe host operation has no model proof.
export XD_TEST_PHOTO_WRONG_PID="$$"
make_request 6 true
photo_host_control_process
test "$(json_value "$status" state)" = success
test "$(json_bool_value "$status" model_ack_at_apply)" = false
unset XD_TEST_PHOTO_WRONG_PID
# Missing or malformed operator credential fails closed, while the original
# audited enable-only operation remains valid and does not stop any work.
sed -i '/^XD_PHOTO_HOST_APPLY_TOKEN=/d' "$temp/config/.env"
make_request 7 true
photo_host_control_process
test "$(json_value "$status" state)" = success
test "$(json_bool_value "$status" model_ack_at_apply)" = false
printf 'XD_PHOTO_HOST_APPLY_TOKEN=not-a-token\n' >> "$temp/config/.env"
make_request 8 true
photo_host_control_process
test "$(json_value "$status" state)" = success
test "$(json_bool_value "$status" model_ack_at_apply)" = false
photo_host_control_write_status failed 9 8 true '0123456789abcdef01234567' \
  unhealthy false "$XD_TEST_PHOTO_DIGEST" true
test "$(json_bool_value "$status" model_ack_at_apply)" = false
kill "$socket_pid" 2>/dev/null || true
wait "$socket_pid" 2>/dev/null || true
echo "Fixed peer-credential Photo Host receipt and fail-closed paths: OK"
