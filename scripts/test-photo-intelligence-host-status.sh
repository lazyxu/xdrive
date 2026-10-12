#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
export XD_CONFIG_DIR="$scratch"
export XD_PHOTO_HOST_FIXTURE="$scratch/photo-host-health"
export XD_PHOTO_HOST_CALLS="$scratch/docker-calls"
export XD_PHOTO_HOST_FAKE_DIGEST="$(printf '%064d' 0)"
export XD_PHOTO_HOST_FAKE_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
mkdir -p "$scratch/config" "$scratch/fakebin" "$scratch/logs"
printf 'COMPOSE_PROFILES=media-worker,photo-intelligence\nXD_PHOTO_FACE_ANALYZER_TOKEN=never-log-this\n' > "$scratch/config/.env"
printf 'services:\n  photo-face:\n    image: fixture\n' > "$scratch/config/docker-compose.yml"
cat > "$scratch/fakebin/docker" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$XD_PHOTO_HOST_CALLS"
if [[ "$#" -eq 4 && "$1" == inspect && "$2" == --format &&
      "$3" == '{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}' &&
      "$4" == xdrive-photo-face ]]; then
  [[ -f "$XD_PHOTO_HOST_FIXTURE" ]] || exit 1
  cat "$XD_PHOTO_HOST_FIXTURE"
elif [[ "$#" -eq 4 && "$1" == inspect && "$2" == --format &&
        "$3" == '{{range .State.Health.Log}}{{printf "%v|%v|%s\n" .End .ExitCode .Output}}{{end}}' &&
        "$4" == xdrive-photo-face ]]; then
  # The fixed Go-template adds a record separator even when an older
  # healthcheck Output lacks its own trailing newline.
  case "${XD_PHOTO_HOST_FAKE_LOG_CASE:-single}" in
    previous_unterminated)
      printf '%s|1|prior-output-without-lf\n' "$XD_PHOTO_HOST_FAKE_TIME"
      ;;
    latest_failed)
      printf '%s|0|XD_PHOTO_INSTANCE_SHA256=%s\n' \
        "$XD_PHOTO_HOST_FAKE_TIME" "$XD_PHOTO_HOST_FAKE_DIGEST"
      printf '%s|1|latest-healthcheck-failed\n' "$XD_PHOTO_HOST_FAKE_TIME"
      exit 0
      ;;
  esac
  printf '%s|0|XD_PHOTO_INSTANCE_SHA256=%s\n' \
    "$XD_PHOTO_HOST_FAKE_TIME" "$XD_PHOTO_HOST_FAKE_DIGEST"
else
  exit 2
fi
FAKE
chmod +x "$scratch/fakebin/docker"
export PATH="$scratch/fakebin:$PATH"
export XD_HOST_CONTROL_SOURCE_ONLY=1
source "$ROOT/scripts/server-control.sh"
unset XD_HOST_CONTROL_SOURCE_ONLY
dir="$(prepare_dir)"
status="$dir/photo-intelligence-runtime-status.json"

printf 'true|healthy\n' > "$XD_PHOTO_HOST_FIXTURE"
photo_intelligence_host_refresh
test "$(json_value "$status" state)" = healthy
test "$(json_bool_value "$status" profile_configured)" = true
test "$(json_value "$status" healthcheck_session_digest)" = "$XD_PHOTO_HOST_FAKE_DIGEST"
! grep -q 'never-log-this' "$status"
test "$(stat -c %a "$status")" = 660

# Health records must be separated by the fixed template, even if a prior
# Docker healthcheck Output had no newline. Only the *last* result counts.
export XD_PHOTO_HOST_FAKE_LOG_CASE=previous_unterminated
photo_intelligence_host_refresh
test "$(json_value "$status" healthcheck_session_digest)" = "$XD_PHOTO_HOST_FAKE_DIGEST"
export XD_PHOTO_HOST_FAKE_LOG_CASE=latest_failed
photo_intelligence_host_refresh
test -z "$(json_value "$status" healthcheck_session_digest)"
unset XD_PHOTO_HOST_FAKE_LOG_CASE
# The Host Manager refuses malformed or stale runtime evidence.
export XD_PHOTO_HOST_FAKE_DIGEST=malformed
photo_intelligence_host_refresh
test -z "$(json_value "$status" healthcheck_session_digest)"
export XD_PHOTO_HOST_FAKE_DIGEST="$(printf '%064d' 0)"
export XD_PHOTO_HOST_FAKE_TIME="$(date -u -d '3 minutes ago' +%Y-%m-%dT%H:%M:%SZ)"
photo_intelligence_host_refresh
test -z "$(json_value "$status" healthcheck_session_digest)"
export XD_PHOTO_HOST_FAKE_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'true|unhealthy\n' > "$XD_PHOTO_HOST_FIXTURE"
photo_intelligence_host_refresh
test "$(json_value "$status" state)" = unhealthy
test -z "$(json_value "$status" healthcheck_session_digest)"
printf 'true|starting\n' > "$XD_PHOTO_HOST_FIXTURE"
photo_intelligence_host_refresh
test "$(json_value "$status" state)" = starting
printf 'true|\n' > "$XD_PHOTO_HOST_FIXTURE"
photo_intelligence_host_refresh
test "$(json_value "$status" state)" = running-unverified
printf 'false|unhealthy\n' > "$XD_PHOTO_HOST_FIXTURE"
photo_intelligence_host_refresh
test "$(json_value "$status" state)" = stopped

# A disabled profile is intent only; a manually running container must still
# be observed but never called a verified/administrator-applied revision.
printf 'COMPOSE_PROFILES=media-worker\n' > "$scratch/config/.env"
printf 'true|healthy\n' > "$XD_PHOTO_HOST_FIXTURE"
photo_intelligence_host_refresh
test "$(json_value "$status" state)" = healthy
test "$(json_bool_value "$status" profile_configured)" = false
printf 'COMPOSE_PROFILES=photo-intelligence-extra,media-worker\n' > "$scratch/config/.env"
photo_intelligence_host_refresh
test "$(json_bool_value "$status" profile_configured)" = false
printf 'COMPOSE_PROFILES=photo-intelligence\n' > "$scratch/config/.env"
photo_intelligence_host_refresh
test "$(json_bool_value "$status" profile_configured)" = true

# Missing/malformed Docker evidence is unknown even if the profile is staged.
printf 'true|error\n' > "$XD_PHOTO_HOST_FIXTURE"
photo_intelligence_host_refresh
test "$(json_value "$status" state)" = unknown
rm -f "$XD_PHOTO_HOST_FIXTURE"
photo_intelligence_host_refresh
test "$(json_value "$status" state)" = unknown

# The runner must never issue Compose up/stop, Docker control or arbitrary
# inspect arguments while building this read-only observation.
! grep -E '(^| )(up|stop|restart|exec|rm|run|kill|start)( |$)' "$XD_PHOTO_HOST_CALLS"
test "$(grep -Fc 'inspect --format {{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{end}} xdrive-photo-face' "$XD_PHOTO_HOST_CALLS")" -eq 14
echo "Photo Intelligence fixed Docker observation/profile intent/no secret/no mutation: OK"
