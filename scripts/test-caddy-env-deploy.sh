#!/usr/bin/env bash
# Offline, fixed Docker CLI fixture for the Caddy-only deployment transaction.
# No Docker daemon, DNS, credentials or real HTTPS endpoint is touched.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# Give CI a failing line while keeping all .env values out of logs.
trap 'printf "Caddy-only deploy fixture failed near line %s\n" "$LINENO" >&2' ERR
export XD_CONFIG_DIR="$TMP/xd"
export XD_HOST_CONTROL_SOURCE_ONLY=1
export MOCK_DOCKER_LOG="$TMP/docker.log"
export MOCK_FAIL_NEW=0
mkdir -p "$XD_CONFIG_DIR/config" "$XD_CONFIG_DIR/state" "$XD_CONFIG_DIR/bin" "$TMP/fakebin"
chmod 0700 "$XD_CONFIG_DIR" "$XD_CONFIG_DIR/config" "$XD_CONFIG_DIR/state"
cp "$ROOT/scripts/caddy-env-config.py" "$XD_CONFIG_DIR/bin/caddy-env-config.py"
chmod 0700 "$XD_CONFIG_DIR/bin/caddy-env-config.py"
cat > "$XD_CONFIG_DIR/config/.env" <<'ENV'
XD_DOMAIN=original.example.com
XD_LAN_HTTPS_IP=192.168.1.9
ALIYUN_ACCESS_KEY_ID=examplekeyid
ALIYUN_ACCESS_KEY_SECRET=examplekeysecret
POSTGRES_PASSWORD=unmodified-example
XD_JWT_SECRET=also-unmodified-example
ENV
chmod 0600 "$XD_CONFIG_DIR/config/.env"
printf 'services:\n  caddy:\n    image: fixture\n' > "$XD_CONFIG_DIR/config/docker-compose.yml"
cat > "$TMP/fakebin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$1" == compose ]]; then
  [[ "$*" == *" up -d --no-deps --force-recreate caddy" ]] || exit 91
  printf '%s\n' "$*" >> "$MOCK_DOCKER_LOG"
  if [[ "$MOCK_FAIL_NEW" == 1 ]] &&
      grep -q '^XD_DOMAIN=broken.example.com$' "$XD_CONFIG_DIR/config/.env"; then
    exit 1
  fi
  exit 0
fi
if [[ "$1" == exec ]]; then
  [[ "$2" == xdrive-caddy && "$3" == wget ]] || exit 92
  exit 0
fi
exit 93
DOCKER
chmod 0700 "$TMP/fakebin/docker"
export PATH="$TMP/fakebin:$PATH"

source "$ROOT/scripts/server-control.sh"
# Only the transport is under test: existing independent tests verify the
# REAL TLS/CA/SAN helper implementations. Never weaken production probes.
caddy_local_tls_state() { printf 'verified\n'; }
caddy_local_lan_tls_state() { printf 'verified\n'; }

fingerprint() {
  XD_CONFIG_DIR="$XD_CONFIG_DIR" python3 "$XD_CONFIG_DIR/bin/caddy-env-config.py" snapshot |
    python3 -c 'import sys,json; print(json.load(sys.stdin)["sha256"])'
}
save_domain() {
  local desired="$1" before
  before="$(fingerprint)"
  printf '{"operation":"save","request_id":"0123456789abcdef01234567","expected_sha256":"%s","https":{"enabled":true,"domain":"%s","lan_enabled":true,"lan_ip":"192.168.1.9"}}\n' \
    "$before" "$desired" |
    XD_CONFIG_DIR="$XD_CONFIG_DIR" python3 "$XD_CONFIG_DIR/bin/caddy-env-config.py" save >/dev/null
}
deploy() {
  local sha="$1" id="$2"
  printf '{"operation":"deploy","request_id":"%s","expected_sha256":"%s"}\n' "$id" "$sha" > "$TMP/active.json"
  caddy_env_deploy "$id" "$TMP/active.json" "$TMP/result.json"
}

save_domain next.example.com
sha="$(fingerprint)"
deploy "$sha" 111111111111111111111111
python3 - "$TMP/result.json" "$sha" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
assert r["state"] == "deployed" and r["sha256"] == sys.argv[2]
PY
grep -q '^XD_DOMAIN=next.example.com$' "$XD_CONFIG_DIR/config/.env"
grep -q '^POSTGRES_PASSWORD=unmodified-example$' "$XD_CONFIG_DIR/config/.env"
grep -q '^XD_JWT_SECRET=also-unmodified-example$' "$XD_CONFIG_DIR/config/.env"
[[ ! -e "$XD_CONFIG_DIR/state/caddy-env/previous.env" ]]
[[ ! -e "$XD_CONFIG_DIR/state/caddy-env/pending.json" ]]

export MOCK_FAIL_NEW=1
save_domain broken.example.com
sha="$(fingerprint)"
deploy "$sha" 222222222222222222222222
python3 - "$TMP/result.json" "$sha" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
assert r["state"] == "failed" and r["rolled_back"] is True
assert r["sha256"] == sys.argv[2]
PY
grep -q '^XD_DOMAIN=next.example.com$' "$XD_CONFIG_DIR/config/.env"
grep -q '^POSTGRES_PASSWORD=unmodified-example$' "$XD_CONFIG_DIR/config/.env"
[[ ! -e "$XD_CONFIG_DIR/state/caddy-env/pending.json" ]]
[[ ! -e "$XD_CONFIG_DIR/state/caddy-env/previous.env" ]]
[[ "$(wc -l < "$MOCK_DOCKER_LOG")" == 3 ]]
if grep -q '^XD_DOMAIN=broken.example.com$' "$XD_CONFIG_DIR/config/.env"; then
  echo "failed Caddy deployment was not rolled back" >&2
  exit 1
fi

# A concurrent server upgrade holds install.lock. Refuse without starting the
# candidate OR rolling back the previous running Caddy.
export MOCK_FAIL_NEW=0
save_domain blocked.example.com
sha="$(fingerprint)"
exec 7>"$XD_CONFIG_DIR/state/install.lock"
flock -x 7
deploy "$sha" 333333333333333333333333
python3 - "$TMP/result.json" "$sha" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
assert r["state"] == "failed" and r["rolled_back"] is False
assert r["sha256"] == sys.argv[2]
assert r["error"] == "installer-busy"
PY
grep -q '^XD_DOMAIN=blocked\.example\.com$' "$XD_CONFIG_DIR/config/.env"
[[ -e "$XD_CONFIG_DIR/state/caddy-env/pending.json" ]]
[[ "$(wc -l < "$MOCK_DOCKER_LOG")" == 3 ]]
flock -u 7
exec 7>&-
deploy "$sha" 444444444444444444444444
python3 - "$TMP/result.json" <<'PY'
import json,sys
assert json.load(open(sys.argv[1]))["state"] == "deployed"
PY
[[ "$(wc -l < "$MOCK_DOCKER_LOG")" == 4 ]]
[[ ! -e "$XD_CONFIG_DIR/state/caddy-env/pending.json" ]]


# An interrupted Host runner must NOT replay a possibly broken candidate.
# The pinned original configuration is restored and exactly Caddy recreated.
save_domain interrupted.example.com
sha="$(fingerprint)"
dir="$(prepare_dir)"
printf '{"operation":"deploy","request_id":"555555555555555555555555","expected_sha256":"%s"}\n' "$sha" \
  > "$dir/caddy-env-active.json"
chmod 0600 "$dir/caddy-env-active.json"
# An installer holding install.lock must block interrupted Caddy recovery
# without changing either the candidate env file or the Caddy container.
exec 7>"$XD_CONFIG_DIR/state/install.lock"
flock -x 7
prior_calls="$(wc -l < "$MOCK_DOCKER_LOG")"
if caddy_env_recover_interrupted "$dir"; then
  echo "interrupted recovery bypassed the installer lock" >&2
  exit 1
fi
[[ -f "$dir/caddy-env-active.json" ]]
grep -Fxq "XD_DOMAIN=interrupted.example.com" "$XD_CONFIG_DIR/config/.env"
[[ "$(wc -l < "$MOCK_DOCKER_LOG")" == "$prior_calls" ]]
flock -u 7
exec 7>&-
caddy_env_recover_interrupted "$dir"
python3 - "$dir/caddy-env-result.json" "$sha" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
assert r["state"] == "failed"
assert r["rolled_back"] is True
assert r["sha256"] == sys.argv[2]
assert r["error"] == "interrupted-deploy"
PY
grep -q '^XD_DOMAIN=blocked\.example\.com$' "$XD_CONFIG_DIR/config/.env"
[[ ! -e "$dir/caddy-env-active.json" ]]
[[ ! -e "$XD_CONFIG_DIR/state/caddy-env/pending.json" ]]
[[ "$(wc -l < "$MOCK_DOCKER_LOG")" == 5 ]]


# The Host must publish its new canonical .env snapshot before Save ACK.
# The cross-replica Server may read the snapshot as soon as the result exists.
before="$(fingerprint)"
dir="$(prepare_dir)"
printf '{"operation":"save","request_id":"666666666666666666666666","created_at":"%s","expected_sha256":"%s","https":{"enabled":true,"domain":"published.example.com","lan_enabled":true,"lan_ip":"192.168.1.9"}}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$before" > "$dir/caddy-env-request.json"
chmod 0660 "$dir/caddy-env-request.json"
caddy_env_process
python3 - "$dir/caddy-env-result.json" "$dir/caddy-env-observed.json" <<'PY'
import json,sys
result=json.load(open(sys.argv[1]))
snapshot=json.load(open(sys.argv[2]))
assert result["state"] == "saved"
assert result["sha256"] == snapshot["sha256"]
assert result["domain"] == snapshot["domain"] == "published.example.com"
assert snapshot["pending_redeploy"] is True
PY
sha="$(fingerprint)"
printf '{"operation":"restore","request_id":"666666666666666666666666","expected_sha256":"%s"}\n' "$sha" |
  XD_CONFIG_DIR="$XD_CONFIG_DIR" python3 "$XD_CONFIG_DIR/bin/caddy-env-config.py" restore >/dev/null
grep -q '^XD_DOMAIN=blocked\.example\.com$' "$XD_CONFIG_DIR/config/.env"
echo "Caddy-only Host deploy and rollback fixtures: OK"
