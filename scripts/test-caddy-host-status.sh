#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
export XD_CONFIG_DIR="$scratch"
export XD_CADDY_TEST_FIXTURE="$scratch/caddy-health"
mkdir -p "$scratch/config" "$scratch/logs" "$scratch/fakebin"
printf 'XD_DOMAIN=example.invalid\n' > "$scratch/config/.env"
printf 'services:\n  caddy:\n    image: fixture\n' > "$scratch/config/docker-compose.yml"
cat > "$scratch/fakebin/docker" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$#" == 4 && "$1" == inspect && "$2" == --format &&
      "$3" == '{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}' &&
      "$4" == xdrive-caddy ]]; then
  [[ -f "$XD_CADDY_TEST_FIXTURE" ]] || exit 1
  cat "$XD_CADDY_TEST_FIXTURE"
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
status="$dir/caddy-runtime-status.json"

printf 'true|healthy\n' > "$XD_CADDY_TEST_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" state)" = healthy
test "$(json_bool_value "$status" https_configured)" = true
! grep -q 'example.invalid' "$status"
test "$(stat -c %a "$status")" = 660

printf 'true|unhealthy\n' > "$XD_CADDY_TEST_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" state)" = unhealthy
printf 'true|starting\n' > "$XD_CADDY_TEST_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" state)" = starting
printf 'true|\n' > "$XD_CADDY_TEST_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" state)" = running-unverified
printf 'false|unhealthy\n' > "$XD_CADDY_TEST_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" state)" = stopped

printf 'XD_DOMAIN=\n' > "$scratch/config/.env"
printf 'true|healthy\n' > "$XD_CADDY_TEST_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" state)" = healthy
test "$(json_bool_value "$status" https_configured)" = false

rm -f "$XD_CADDY_TEST_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" state)" = unknown
echo "Caddy fixed-target runtime health, HTTPS intent and no-domain-leak: OK"
