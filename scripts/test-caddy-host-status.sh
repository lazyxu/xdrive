#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
export XD_CONFIG_DIR="$scratch"
export XD_CADDY_TEST_FIXTURE="$scratch/caddy-health"
export XD_CADDY_RUNTIME_DOMAIN_FIXTURE="$scratch/caddy-runtime-domain"
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
elif [[ "$#" == 4 && "$1" == inspect && "$2" == --format &&
        "$3" == '{{range .Config.Env}}{{if eq (index (split . "=") 0) "XD_DOMAIN"}}{{println .}}{{end}}{{end}}' &&
        "$4" == xdrive-caddy ]]; then
  [[ -f "$XD_CADDY_RUNTIME_DOMAIN_FIXTURE" ]] || exit 1
  cat "$XD_CADDY_RUNTIME_DOMAIN_FIXTURE"
else
  exit 2
fi
FAKE
chmod +x "$scratch/fakebin/docker"
cat > "$scratch/fakebin/openssl" <<'TLSFAKE'
#!/usr/bin/env bash
set -euo pipefail
[[ "$#" == 9 && "$1" == s_client && "$2" == -connect &&
   "$3" == 127.0.0.1:8443 && "$4" == -servername &&
   "$5" == example.invalid && "$6" == -verify_hostname &&
   "$7" == example.invalid && "$8" == -verify_return_error &&
   "$9" == -brief ]] || exit 40
case "${XD_TEST_CADDY_TLS_RESULT:-verified}" in
  verified) printf 'Verification: OK\n' >&2 ;;
  false-success) printf 'Verification: OK\n' >&2; exit 3 ;;
  *) printf 'TLS verification error\n' >&2; exit 5 ;;
esac
TLSFAKE
chmod +x "$scratch/fakebin/openssl"
printf 'XD_DOMAIN=example.invalid\n' > "$XD_CADDY_RUNTIME_DOMAIN_FIXTURE"
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
test "$(json_bool_value "$status" tls_check_supported)" = true
test "$(json_value "$status" tls_state)" = verified
# Only the successful local TLS chain/hostname handshake may attach a
# lowercased, non-reversible SNI digest. Never write the raw deployment FQDN.
expected_tls_sni_sha="$(printf '%s' example.invalid | sha256sum | awk '{print $1}')"
test "$(json_value "$status" tls_verified_domain_sha256)" = "$expected_tls_sni_sha"
test "$(json_value "$status" runtime_tls_alignment)" = matched-local
! grep -q 'example.invalid' "$status"
# This is the fixed running container's startup XD_DOMAIN, not the host's
# current .env. A changed host .env with an old running container is visible.
printf 'XD_DOMAIN=old.example.invalid\n' > "$XD_CADDY_RUNTIME_DOMAIN_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" runtime_tls_alignment)" = mismatch-local
! grep -q 'old.example.invalid' "$status"
# Matching is ASCII case insensitive, still not evidence of applied revision.
printf 'XD_DOMAIN=EXAMPLE.INVALID\n' > "$XD_CADDY_RUNTIME_DOMAIN_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" runtime_tls_alignment)" = matched-local
# Missing, duplicate, malformed and untrusted Docker output never produces
# a positive match. No AliDNS secret or full environment is returned.
for fake in 'XD_DOMAIN=example.invalid=bad' 'XD_DOMAIN=127.0.0.1' \
    'ALIYUN_ACCESS_KEY_SECRET=do-not-leak' 'XD_DOMAIN='; do
  printf '%s\n' "$fake" > "$XD_CADDY_RUNTIME_DOMAIN_FIXTURE"
  caddy_host_refresh
  test "$(json_value "$status" runtime_tls_alignment)" = unverified
  ! grep -q 'do-not-leak' "$status"
done
printf 'XD_DOMAIN=example.invalid\nXD_DOMAIN=old.example.invalid\n' > "$XD_CADDY_RUNTIME_DOMAIN_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" runtime_tls_alignment)" = unverified
rm -f "$XD_CADDY_RUNTIME_DOMAIN_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" runtime_tls_alignment)" = unverified
printf 'XD_DOMAIN=example.invalid\n' > "$XD_CADDY_RUNTIME_DOMAIN_FIXTURE"
# A misleading success string must NEVER override a failed TLS command.
export XD_TEST_CADDY_TLS_RESULT=false-success
caddy_host_refresh
test "$(json_value "$status" tls_state)" = failed
test "$(json_value "$status" tls_verified_domain_sha256)" = ""
test "$(json_value "$status" runtime_tls_alignment)" = unverified
export XD_TEST_CADDY_TLS_RESULT=failed
caddy_host_refresh
test "$(json_value "$status" tls_state)" = failed
unset XD_TEST_CADDY_TLS_RESULT
caddy_host_refresh
test "$(json_value "$status" tls_state)" = verified
test "$(stat -c %a "$status")" = 660

printf 'true|unhealthy\n' > "$XD_CADDY_TEST_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" state)" = unhealthy
test "$(json_value "$status" tls_state)" = unavailable
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
test "$(json_value "$status" tls_state)" = disabled
test "$(json_value "$status" tls_verified_domain_sha256)" = ""
test "$(json_value "$status" runtime_tls_alignment)" = unverified

# A non-loopback-only bind cannot be concluded TLS-broken from localhost.
printf 'XD_DOMAIN=example.invalid\nXD_HTTPS_BIND=192.0.2.23\n' > "$scratch/config/.env"
caddy_host_refresh
test "$(json_value "$status" tls_state)" = unavailable

# Reject invalid deployment domains, ports and flag-like injection before openssl.
printf 'XD_DOMAIN=-danger.example.invalid\n' > "$scratch/config/.env"
caddy_host_refresh
test "$(json_value "$status" tls_state)" = invalid-config
# Numeric IP literals are not DNS hostnames and must not reach the SNI probe.
printf 'XD_DOMAIN=127.0.0.1\n' > "$scratch/config/.env"
caddy_host_refresh
test "$(json_value "$status" tls_state)" = invalid-config
printf 'XD_DOMAIN=example.invalid\nXD_HTTPS_PORT=65536\n' > "$scratch/config/.env"
caddy_host_refresh
test "$(json_value "$status" tls_state)" = invalid-config
test "$(json_value "$status" tls_verified_domain_sha256)" = ""
printf 'XD_DOMAIN=example.invalid\nXD_HTTPS_PORT=8443\n' > "$scratch/config/.env"
caddy_host_refresh
test "$(json_value "$status" tls_state)" = verified

rm -f "$XD_CADDY_TEST_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" state)" = unknown
echo "Caddy fixed Docker health, verified local TLS vs running container startup Env, invalid settings and no-secret disclosure: OK"
