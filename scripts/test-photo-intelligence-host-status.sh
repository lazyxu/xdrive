#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
export XD_CONFIG_DIR="$scratch"
export XD_PHOTO_HOST_FIXTURE="$scratch/photo-host-health"
export XD_PHOTO_HOST_CALLS="$scratch/docker-calls"
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
! grep -q 'never-log-this' "$status"
test "$(stat -c %a "$status")" = 660

printf 'true|unhealthy\n' > "$XD_PHOTO_HOST_FIXTURE"
photo_intelligence_host_refresh
test "$(json_value "$status" state)" = unhealthy
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
test "$(wc -l < "$XD_PHOTO_HOST_CALLS")" -eq 10
echo "Photo Intelligence fixed Docker observation/profile intent/no secret/no mutation: OK"
