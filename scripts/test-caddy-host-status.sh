#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
export XD_CONFIG_DIR="$scratch"
export XD_CADDY_TEST_FIXTURE="$scratch/caddy-health"
export XD_CADDY_RUNTIME_DOMAIN_FIXTURE="$scratch/caddy-runtime-domain"
export XD_CADDY_LIVE_SHA_FIXTURE="$scratch/caddy-live-sha"
export XD_CADDY_MODULE_FIXTURE="$scratch/caddy-module"
export XD_CADDY_LIVE_SHA_NEXT_FIXTURE="$scratch/caddy-live-sha-next"
export XD_CADDY_LIVE_SHA_COUNT_FIXTURE="$scratch/caddy-live-sha-count"
export XD_CADDY_GENERATION_FIXTURE="$scratch/caddy-generation"
export XD_CADDY_GENERATION_NEXT_FIXTURE="$scratch/caddy-generation-next"
export XD_CADDY_GENERATION_COUNT_FIXTURE="$scratch/caddy-generation-count"
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
elif [[ "$#" == 4 && "$1" == inspect && "$2" == --format &&
        "$3" == '{{.Id}}|{{.State.StartedAt}}|{{.State.Pid}}|{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}' &&
        "$4" == xdrive-caddy ]]; then
  [[ -f "$XD_CADDY_GENERATION_FIXTURE" ]] || exit 1
  if [[ -f "$XD_CADDY_GENERATION_NEXT_FIXTURE" ]]; then
    count="$(cat "$XD_CADDY_GENERATION_COUNT_FIXTURE" 2>/dev/null || printf '0')"
    count=$((count + 1))
    printf '%s\n' "$count" > "$XD_CADDY_GENERATION_COUNT_FIXTURE"
    if (( count % 2 == 0 )); then
      cat "$XD_CADDY_GENERATION_NEXT_FIXTURE"
    else
      cat "$XD_CADDY_GENERATION_FIXTURE"
    fi
  else
    cat "$XD_CADDY_GENERATION_FIXTURE"
  fi
elif [[ "$#" == 5 && "$1" == exec && "$2" == xdrive-caddy &&
        "$3" == /bin/sh && "$4" == -ec &&
        "$5" == 'set -o pipefail; wget -q -T 2 -O - http://127.0.0.1:2019/config/ | sha256sum' ]]; then
  [[ -f "$XD_CADDY_LIVE_SHA_FIXTURE" ]] || exit 1
  if [[ -f "$XD_CADDY_LIVE_SHA_NEXT_FIXTURE" ]]; then
    count="$(cat "$XD_CADDY_LIVE_SHA_COUNT_FIXTURE" 2>/dev/null || printf '0')"
    count=$((count + 1))
    printf '%s\n' "$count" > "$XD_CADDY_LIVE_SHA_COUNT_FIXTURE"
    if (( count % 2 == 0 )); then
      cat "$XD_CADDY_LIVE_SHA_NEXT_FIXTURE"
    else
      cat "$XD_CADDY_LIVE_SHA_FIXTURE"
    fi
  else
    cat "$XD_CADDY_LIVE_SHA_FIXTURE"
  fi
elif [[ "$#" == 5 && "$1" == exec && "$2" == xdrive-caddy &&
        "$3" == /bin/sh && "$4" == -ec &&
        "$5" == 'modules="$(caddy list-modules --skip-standard 2>/dev/null)" || exit 2; if printf "%s\n" "$modules" | grep -Fxq dns.providers.alidns; then printf "present-local\n"; else code="$?"; [ "$code" -eq 1 ] || exit 2; printf "absent-local\n"; fi' ]]; then
  [[ -f "$XD_CADDY_MODULE_FIXTURE" ]] || exit 1
  cat "$XD_CADDY_MODULE_FIXTURE"
elif [[ "$#" == 4 && "$1" == exec && "$2" == xdrive-caddy &&
        "$3" == cat && "$4" == /data/caddy/pki/authorities/local/root.crt ]]; then
  [[ -f "$XD_CADDY_LAN_CA_FIXTURE" ]] || exit 1
  cat "$XD_CADDY_LAN_CA_FIXTURE"
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
# Deterministic unit fixtures never open a network socket; the existing
# Rootless E2E separately proves real CA/IP SAN TLS against real Caddy.
export XD_CADDY_LAN_CA_FIXTURE="$scratch/local-ca-root.crt"
head -c 512 /dev/zero | tr '\0' A > "$XD_CADDY_LAN_CA_FIXTURE"
cat > "$scratch/fakebin/ip" <<'FAKEIP'
#!/usr/bin/env bash
set -euo pipefail
[[ "$*" == "-o -4 addr show" ]] || exit 2
printf '2: eth0 inet 192.168.2.4/24 brd 192.168.2.255 scope global eth0\n'
FAKEIP
chmod +x "$scratch/fakebin/ip"
cat > "$scratch/fakebin/curl" <<'FAKECURL'
#!/usr/bin/env bash
set -euo pipefail
[[ " $* " == *' --noproxy * '* ]] || exit 90
[[ " $* " == *' https://192.168.2.4:8443/api/v1/readyz '* ]] || exit 91
[[ " $* " != *' --insecure '* && " $* " != *' -k '* ]] || exit 92
cert=""
prev=""
for arg in "$@"; do
  if [[ "$prev" == --cacert ]]; then cert="$arg"; break; fi
  prev="$arg"
done
[[ -n "$cert" && -s "$cert" ]] || exit 93
[[ "$(stat -c %a "$cert")" == 600 ]] || exit 94
case "${XD_TEST_CADDY_LAN_RESULT:-verified}" in
  verified) exit 0 ;;
  *) exit 5 ;;
esac
FAKECURL
chmod +x "$scratch/fakebin/curl"
printf 'XD_DOMAIN=example.invalid\n' > "$XD_CADDY_RUNTIME_DOMAIN_FIXTURE"
expected_live_sha="$(printf 'a%.0s' {1..64})"
printf '%s  -\n' "$expected_live_sha" > "$XD_CADDY_LIVE_SHA_FIXTURE"
printf 'present-local\n' > "$XD_CADDY_MODULE_FIXTURE"
fixed_caddy_id="$(printf 'c%.0s' {1..64})"
printf '%s|%s|%s|true|healthy\n' "$fixed_caddy_id" '2026-10-16T09:23:45.123456789Z' '2478' > "$XD_CADDY_GENERATION_FIXTURE"
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
test "$(json_value "$status" live_config_sha256)" = "$expected_live_sha"
test "$(json_value "$status" instance_generation_state)" = same-instance-local
test "$(json_value "$status" alidns_module_state)" = present-local
! grep -q 'example.invalid' "$status"
! grep -q "$fixed_caddy_id" "$status"
! grep -q '|2478|' "$status"
! grep -q '2026-10-16T09:23' "$status"
# The optional AliDNS module is independent of a successful HTTPS handshake.
printf 'absent-local\n' > "$XD_CADDY_MODULE_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" alidns_module_state)" = absent-local
test "$(json_value "$status" tls_state)" = verified
printf 'ALIYUN_ACCESS_KEY_SECRET=do-not-serialize\n' > "$XD_CADDY_MODULE_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" alidns_module_state)" = unverified
! grep -q 'do-not-serialize' "$status"
rm -f "$XD_CADDY_MODULE_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" alidns_module_state)" = unverified
printf 'present-local\n' > "$XD_CADDY_MODULE_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" alidns_module_state)" = present-local
# Caddy can hot-reload without a new container/PID. Distinct valid in-memory
# JSON samples in one fixed-generation window revoke stale positive TLS/SNI,
# startup alignment and active config signals. Never expose either digest.
next_live_sha="$(printf 'd%.0s' {1..64})"
printf '%s  -\n' "$next_live_sha" > "$XD_CADDY_LIVE_SHA_NEXT_FIXTURE"
printf '0\n' > "$XD_CADDY_LIVE_SHA_COUNT_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" tls_state)" = unavailable
test "$(json_value "$status" tls_verified_domain_sha256)" = ""
test "$(json_value "$status" runtime_tls_alignment)" = unverified
test "$(json_value "$status" live_config_sha256)" = ""
test "$(json_value "$status" instance_generation_state)" = unverified
! grep -q "$next_live_sha" "$status"
# If a digest cannot be read, only the config observation is unverified;
# local TLS and process generation are independently still observable.
printf 'malformed\n' > "$XD_CADDY_LIVE_SHA_NEXT_FIXTURE"
printf '0\n' > "$XD_CADDY_LIVE_SHA_COUNT_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" tls_state)" = verified
test "$(json_value "$status" instance_generation_state)" = same-instance-local
test "$(json_value "$status" live_config_sha256)" = ""
rm -f "$XD_CADDY_LIVE_SHA_NEXT_FIXTURE" "$XD_CADDY_LIVE_SHA_COUNT_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" tls_state)" = verified
test "$(json_value "$status" live_config_sha256)" = "$expected_live_sha"
# A replaced container/process during successive local checks must revoke
# the TLS SNI digest, startup alignment, live config hash and positive status.
printf '%s|%s|%s|true|healthy\n' "$fixed_caddy_id" '2026-10-16T09:24:00.000000001Z' '2479' > "$XD_CADDY_GENERATION_NEXT_FIXTURE"
printf '0\n' > "$XD_CADDY_GENERATION_COUNT_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" instance_generation_state)" = unverified
test "$(json_value "$status" tls_state)" = unavailable
test "$(json_value "$status" tls_verified_domain_sha256)" = ""
test "$(json_value "$status" runtime_tls_alignment)" = unverified
test "$(json_value "$status" live_config_sha256)" = ""
! grep -q "$fixed_caddy_id" "$status"
rm -f "$XD_CADDY_GENERATION_NEXT_FIXTURE" "$XD_CADDY_GENERATION_COUNT_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" instance_generation_state)" = same-instance-local
test "$(json_value "$status" tls_state)" = verified
# A missing or malformed generation is a neutral result, never proof.
printf 'do-not-serialize-generation-secret\n' > "$XD_CADDY_GENERATION_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" instance_generation_state)" = unverified
test "$(json_value "$status" tls_state)" = unavailable
! grep -q 'do-not-serialize-generation-secret' "$status"
rm -f "$XD_CADDY_GENERATION_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" instance_generation_state)" = unverified
test "$(json_value "$status" live_config_sha256)" = ""
printf '%s|%s|%s|true|healthy\n' "$fixed_caddy_id" '2026-10-16T09:23:45.123456789Z' '2478' > "$XD_CADDY_GENERATION_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" instance_generation_state)" = same-instance-local
# Digest crosses the host boundary, but raw admin JSON, private AliDNS values,
# and all Docker Env entries must never appear in the host status file.
for bad in 'malformed' 'ALIYUN_ACCESS_KEY_SECRET=do-not-leak' \
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  -'; do
  printf '%s\n' "$bad" > "$XD_CADDY_LIVE_SHA_FIXTURE"
  caddy_host_refresh
  test "$(json_value "$status" live_config_sha256)" = ""
  ! grep -q 'do-not-leak' "$status"
done
rm -f "$XD_CADDY_LIVE_SHA_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" live_config_sha256)" = ""
printf '%s  -\n' "$expected_live_sha" > "$XD_CADDY_LIVE_SHA_FIXTURE"
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
test "$(json_value "$status" live_config_sha256)" = ""
test "$(json_value "$status" instance_generation_state)" = unverified
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
test "$(json_value "$status" alidns_module_state)" = unverified

printf 'XD_DOMAIN=\n' > "$scratch/config/.env"
printf 'true|healthy\n' > "$XD_CADDY_TEST_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" state)" = healthy
test "$(json_bool_value "$status" https_configured)" = false
test "$(json_value "$status" tls_state)" = disabled
test "$(json_value "$status" alidns_module_state)" = present-local
test "$(json_value "$status" tls_verified_domain_sha256)" = ""
test "$(json_value "$status" runtime_tls_alignment)" = unverified
test "$(json_value "$status" live_config_sha256)" = ""
test "$(json_value "$status" instance_generation_state)" = unverified

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

# A domainless deployment must test the actual HTTPS IP instead of
# incorrectly reporting plain HTTP, with no root CA bytes in the Server JSON.
printf 'XD_DOMAIN=\nXD_LAN_HTTPS_IP=192.168.2.4\nXD_HTTPS_BIND=192.168.2.4\nXD_HTTPS_PORT=8443\n' > "$scratch/config/.env"
caddy_host_refresh
test "$(json_value "$status" lan_tls_state)" = verified
test "$(json_bool_value "$status" lan_https_configured)" = true
test "$(json_value "$status" tls_state)" = disabled
test "$(json_bool_value "$status" https_configured)" = false
expected_lan_ip_sha="$(printf '192.168.2.4' | sha256sum | awk '{print $1}')"
test "$(json_value "$status" lan_verified_ip_sha256)" = "$expected_lan_ip_sha"
! grep -q '192.168.2.4' "$status"
! grep -q 'AAAAA' "$status"
# A failed curl is never green even if the fake writes a positive message.
export XD_TEST_CADDY_LAN_RESULT=failed
caddy_host_refresh
test "$(json_value "$status" lan_tls_state)" = failed
test "$(json_value "$status" lan_verified_ip_sha256)" = ""
unset XD_TEST_CADDY_LAN_RESULT
rm -f "$XD_CADDY_LAN_CA_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" lan_tls_state)" = unavailable
test "$(json_value "$status" lan_verified_ip_sha256)" = ""
# Spoofed/public IPs, malformed octets and interface-specific mismatches
# fail without probing any other LAN host or broadening CA trust.
for bad in 8.8.8.8 127.0.0.1 192.168.02.4 192.168.2.256; do
  printf 'XD_DOMAIN=\nXD_LAN_HTTPS_IP=%s\n' "$bad" > "$scratch/config/.env"
  caddy_host_refresh
  test "$(json_value "$status" lan_tls_state)" = invalid-config
  test "$(json_value "$status" lan_verified_ip_sha256)" = ""
done
printf 'XD_DOMAIN=\nXD_LAN_HTTPS_IP=192.168.2.4\nXD_HTTPS_BIND=127.0.0.1\n' > "$scratch/config/.env"
caddy_host_refresh
test "$(json_value "$status" lan_tls_state)" = unavailable
printf 'XD_DOMAIN=\n' > "$scratch/config/.env"
caddy_host_refresh
test "$(json_value "$status" lan_tls_state)" = disabled
test "$(json_bool_value "$status" lan_https_configured)" = false

rm -f "$XD_CADDY_TEST_FIXTURE"
caddy_host_refresh
test "$(json_value "$status" state)" = unknown
echo "Caddy fixed runtime health, process-generation and double config-sample fences, TLS, startup Env, fail-closed privacy: OK"
