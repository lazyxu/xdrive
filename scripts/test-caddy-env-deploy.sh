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
export MOCK_FAIL_OLD=0
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
  if [[ "$MOCK_FAIL_OLD" == 1 ]] &&
      grep -q '^XD_DOMAIN=missing-commit-ack.example.com$' "$XD_CONFIG_DIR/config/.env"; then
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
# Verify the REAL Host request processing path, not only caddy_env_deploy().
# An upgrade can hold install.lock while the handler publishes a final receipt.
# A failing snapshot must NOT erase the unambiguous installer-busy code.
save_domain queued.example.com
sha="$(fingerprint)"
dir="$(prepare_dir)"
printf '{"operation":"deploy","request_id":"777777777777777777777777","created_at":"%s","expected_sha256":"%s"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$sha" > "$dir/caddy-env-request.json"
chmod 0660 "$dir/caddy-env-request.json"
before_calls="$(wc -l < "$MOCK_DOCKER_LOG")"
exec 7>"$XD_CONFIG_DIR/state/install.lock"
flock -x 7
caddy_env_process
python3 - "$dir/caddy-env-result.json" "$sha" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
assert r["protocol"] == "xdrive.caddy.host-env.v1"
assert r["state"] == "failed" and r["error"] == "installer-busy"
assert r["sha256"] == sys.argv[2] and r["rolled_back"] is False
PY
[[ ! -e "$dir/caddy-env-active.json" ]]
[[ ! -e "$dir/caddy-env-request.json" ]]
[[ -f "$XD_CONFIG_DIR/state/caddy-env/pending.json" ]]
grep -Fxq "XD_DOMAIN=queued.example.com" "$XD_CONFIG_DIR/config/.env"
grep -Fxq "POSTGRES_PASSWORD=unmodified-example" "$XD_CONFIG_DIR/config/.env"
[[ "$(wc -l < "$MOCK_DOCKER_LOG")" == "$before_calls" ]]
flock -u 7
exec 7>&-
deploy "$sha" 888888888888888888888888
python3 - "$TMP/result.json" <<'PY'
import json,sys
assert json.load(open(sys.argv[1]))["state"] == "deployed"
PY
[[ ! -e "$XD_CONFIG_DIR/state/caddy-env/pending.json" ]]
[[ "$(wc -l < "$MOCK_DOCKER_LOG")" == "$((before_calls + 1))" ]]


# A terminal result survives later singleton mutations and Host runner restarts,
# without archiving any Save/Reveal payload or broad credential text.
archive_dir="$dir/caddy-deploy-results"
busy_receipt="$archive_dir/777777777777777777777777.json"
[[ -f "$busy_receipt" && ! -L "$busy_receipt" ]]
[[ "$(stat -c '%a' "$archive_dir")" == "2750" ]]
[[ "$(stat -c '%a' "$busy_receipt")" == "640" ]]
python3 - "$busy_receipt" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
assert set(r) == {"protocol", "state", "request_id", "sha256", "error"}
assert r["state"] == "failed" and r["error"] == "installer-busy"
assert "ALIYUN" not in json.dumps(r) and "POSTGRES_PASSWORD" not in json.dumps(r)
PY
printf '{"protocol":"xdrive.caddy.host-env.v1","state":"deployed","request_id":"%s","sha256":"%s"}\n' \
  "999999999999999999999999" "$sha" > "$dir/caddy-env-result.json"
python3 - "$busy_receipt" <<'PY'
import json,sys
assert json.load(open(sys.argv[1]))["request_id"] == "777777777777777777777777"
PY
# Reject both duplicate request IDs and a smuggled credential field.
if printf '{"protocol":"xdrive.caddy.host-env.v1","state":"failed","request_id":"777777777777777777777777","sha256":"%s","error":"installer-busy"}\n' "$sha" |
  XD_CADDY_DEPLOY_RECEIPT_DIR="$dir" python3 "$XD_CONFIG_DIR/bin/caddy-env-config.py" archive-deploy >/dev/null 2>&1; then
  echo "archive overwrote immutable receipt" >&2
  exit 1
fi
if printf '{"protocol":"xdrive.caddy.host-env.v1","state":"deployed","request_id":"aaaaaaaaaaaaaaaaaaaaaaaa","sha256":"%s","access_key_secret":"DO-NOT-STORE"}\n' "$sha" |
  XD_CADDY_DEPLOY_RECEIPT_DIR="$dir" python3 "$XD_CONFIG_DIR/bin/caddy-env-config.py" archive-deploy >/dev/null 2>&1; then
  echo "archive accepted forbidden secret" >&2
  exit 1
fi
[[ ! -e "$archive_dir/aaaaaaaaaaaaaaaaaaaaaaaa.json" ]]


# A physical Caddy check can succeed and Host Python can publish a durable
# commit decision before Bash receives an ACK. SIGKILL in either half of the
# cleanup MUST preserve that exact success rather than restore older ingress.
# Only these test-only environments can inject the forced Python _exit.
simulate_committed_host_crash() {
  local mode="$1" id="$2" name="$3" dir sha before
  save_domain "$name"
  sha="$(fingerprint)"
  dir="$(prepare_dir)"
  printf '{"operation":"deploy","request_id":"%s","expected_sha256":"%s"}\n' \
    "$id" "$sha" > "$dir/caddy-env-active.json"
  chmod 0600 "$dir/caddy-env-active.json"
  before="$(wc -l < "$MOCK_DOCKER_LOG")"
  # The fake Docker/Ready and local TLS checks intentionally model the
  # operation's already-verified physical entry, never public/WAN proof.
  docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" \
    up -d --no-deps --force-recreate caddy >/dev/null
  [[ "$(caddy_local_tls_state "$name")" == verified ]]
  exec 6>"$XD_CONFIG_DIR/state/install.lock"
  flock -n 6
  local crash_after_archive=0 crash_after_marker=0 crash_after_link=0
  [[ "$mode" != after-link ]] || crash_after_link=1
  [[ "$mode" != after-archive ]] || crash_after_archive=1
  [[ "$mode" != after-marker ]] || crash_after_marker=1
  if printf '{"operation":"commit","request_id":"%s","expected_sha256":"%s"}\n' "$id" "$sha" |
      XD_CONFIG_DIR="$XD_CONFIG_DIR" XD_CADDY_DEPLOY_RECEIPT_DIR="$dir" \
      XD_CADDY_INSTALL_LOCK_INHERITED_FD=6 XD_CADDY_COMMIT_DURABLE=1 \
      XD_CADDY_TEST_COMMIT_CRASH_AFTER_LINK="$crash_after_link" \
      XD_CADDY_TEST_COMMIT_CRASH_AFTER_ARCHIVE="$crash_after_archive" \
      XD_CADDY_TEST_COMMIT_CRASH_AFTER_MARKER="$crash_after_marker" \
      python3 "$XD_CONFIG_DIR/bin/caddy-env-config.py" commit >/dev/null; then
    [[ "$mode" == after-completed ]] || {
      echo "missing expected interrupted Python commit" >&2
      exit 1
    }
  else
    [[ "$mode" != after-completed ]] || {
      echo "completed Python commit unexpectedly failed" >&2
      exit 1
    }
  fi
  flock -u 6
  exec 6>&-
  [[ -f "$dir/caddy-env-active.json" ]]
  local receipt="$dir/caddy-deploy-results/$id.json"
  python3 - "$receipt" "$id" "$sha" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
assert r=={"protocol":"xdrive.caddy.host-env.v1","state":"deployed",
          "request_id":sys.argv[2],"sha256":sys.argv[3]}
PY
  # This is the precise crash window between the durable decision and Host
  # journal cleanup. Neither wrong rollback nor a second recreate is allowed.
  if [[ "$mode" == after-archive || "$mode" == after-link ]]; then
    [[ -f "$XD_CONFIG_DIR/state/caddy-env/pending.json" ]]
    [[ -f "$XD_CONFIG_DIR/state/caddy-env/previous.env" ]]
  elif [[ "$mode" == after-marker ]]; then
    [[ ! -e "$XD_CONFIG_DIR/state/caddy-env/pending.json" ]]
    [[ -f "$XD_CONFIG_DIR/state/caddy-env/previous.env" ]]
  else
    [[ ! -e "$XD_CONFIG_DIR/state/caddy-env/pending.json" ]]
    [[ ! -e "$XD_CONFIG_DIR/state/caddy-env/previous.env" ]]
  fi
  if [[ "$mode" == after-link ]]; then
    [[ "$(stat -c '%h' "$receipt")" == 2 ]]
  fi
  local calls_after_commit="$(wc -l < "$MOCK_DOCKER_LOG")"
  [[ "$calls_after_commit" == "$((before + 1))" ]]
  caddy_env_recover_interrupted "$dir"
  python3 - "$dir/caddy-env-result.json" "$id" "$sha" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
assert r == {"protocol":"xdrive.caddy.host-env.v1","state":"deployed",
             "request_id":sys.argv[2],"sha256":sys.argv[3]}
PY
  [[ ! -e "$dir/caddy-env-active.json" ]]
  [[ ! -e "$XD_CONFIG_DIR/state/caddy-env/pending.json" ]]
  [[ ! -e "$XD_CONFIG_DIR/state/caddy-env/previous.env" ]]
  [[ "$(stat -c '%h' "$receipt")" == 1 ]]
  [[ "$(wc -l < "$MOCK_DOCKER_LOG")" == "$calls_after_commit" ]]
  grep -Fxq "XD_DOMAIN=$name" "$XD_CONFIG_DIR/config/.env"
  grep -Fxq "POSTGRES_PASSWORD=unmodified-example" "$XD_CONFIG_DIR/config/.env"
  [[ "$(fingerprint)" == "$sha" ]]
}

simulate_committed_host_crash after-link "050505050505050505050505" "crash-after-publish-link.example.com"
simulate_committed_host_crash after-archive "101010101010101010101010" "crash-before-cleanup.example.com"
simulate_committed_host_crash after-marker "202020202020202020202020" "crash-after-marker.example.com"
simulate_committed_host_crash after-completed "303030303030303030303030" "crash-after-python-ack.example.com"

# A lost Python commit ACK within an uninterrupted Host process also must
# return one credible success, never roll back or send a false failure.
save_domain missing-commit-ack.example.com
sha="$(fingerprint)"
before="$(wc -l < "$MOCK_DOCKER_LOG")"
export XD_CADDY_TEST_COMMIT_CRASH_AFTER_ARCHIVE=1
deploy "$sha" "454545454545454545454545"
unset XD_CADDY_TEST_COMMIT_CRASH_AFTER_ARCHIVE
python3 - "$TMP/result.json" "$sha" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
assert r["state"] == "deployed" and r["sha256"] == sys.argv[2]
PY
[[ "$(wc -l < "$MOCK_DOCKER_LOG")" == "$((before + 1))" ]]
[[ ! -e "$XD_CONFIG_DIR/state/caddy-env/pending.json" ]]

# A record that is not the exact terminal SUCCESS must never authorize
# commit cleanup, revert a possibly committed candidate or clear active.
save_domain forged-receipt.example.com
dir="$(prepare_dir)"
sha="$(fingerprint)"
id="404040404040404040404040"
printf '{"operation":"deploy","request_id":"%s","expected_sha256":"%s"}\n' \
  "$id" "$sha" > "$dir/caddy-env-active.json"
chmod 0600 "$dir/caddy-env-active.json"
printf '{"protocol":"xdrive.caddy.host-env.v1","state":"failed","request_id":"%s","sha256":"%s","error":"installer-busy"}\n' \
  "$id" "$sha" |
  XD_CADDY_DEPLOY_RECEIPT_DIR="$dir" \
    python3 "$XD_CONFIG_DIR/bin/caddy-env-config.py" archive-deploy
before="$(wc -l < "$MOCK_DOCKER_LOG")"
if caddy_env_recover_interrupted "$dir"; then
  echo "non-success Host receipt silently finalized a Caddy deployment" >&2
  exit 1
fi
[[ -f "$dir/caddy-env-active.json" ]]
[[ -f "$XD_CONFIG_DIR/state/caddy-env/previous.env" ]]
[[ "$(wc -l < "$MOCK_DOCKER_LOG")" == "$before" ]]
rm -f "$dir/caddy-deploy-results/$id.json"
caddy_env_recover_interrupted "$dir"
[[ ! -e "$dir/caddy-env-active.json" ]]
grep -Fxq "XD_DOMAIN=missing-commit-ack.example.com" "$XD_CONFIG_DIR/config/.env"
[[ "$(wc -l < "$MOCK_DOCKER_LOG")" == "$((before + 1))" ]]

# P0-01 double failure: restoring .env does NOT verify the previous Caddy.
export MOCK_FAIL_NEW=1 MOCK_FAIL_OLD=1
save_domain broken.example.com
sha="$(fingerprint)"
dir="$(prepare_dir)"
id="515151515151515151515151"
printf '{"operation":"deploy","request_id":"%s","created_at":"%s","expected_sha256":"%s"}\n' \
  "$id" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$sha" > "$dir/caddy-env-request.json"
chmod 0660 "$dir/caddy-env-request.json"
before="$(wc -l < "$MOCK_DOCKER_LOG")"
caddy_env_process
python3 - "$dir/caddy-env-result.json" "$dir/caddy-deploy-results/$id.json" "$sha" <<'PY'
import json,sys
for path in sys.argv[1:3]:
    r=json.load(open(path))
    assert r["state"] == "failed" and r.get("rolled_back", False) is False
    assert r["error"] == "caddy-deploy-or-verify-failed" and r["sha256"] == sys.argv[3]
PY
[[ "$(wc -l < "$MOCK_DOCKER_LOG")" == "$((before + 2))" ]]
grep -Fxq 'XD_DOMAIN=missing-commit-ack.example.com' "$XD_CONFIG_DIR/config/.env"
[[ ! -e "$XD_CONFIG_DIR/state/caddy-env/previous.env" ]]
[[ ! -e "$XD_CONFIG_DIR/state/caddy-env/pending.json" ]]
[[ -f "$dir/caddy-env-active.json" && ! -L "$dir/caddy-env-active.json" ]]
[[ ! -e "$dir/caddy-env-request.json" ]]
# No queued Save may run while the previous instance remains unverified.
printf '{"operation":"save","request_id":"525252525252525252525252","created_at":"%s","expected_sha256":"%s","https":{"enabled":true,"domain":"must-not-run.example.com","lan_enabled":true,"lan_ip":"192.168.1.9"}}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(fingerprint)" > "$dir/caddy-env-request.json"
chmod 0660 "$dir/caddy-env-request.json"
caddy_env_process
[[ ! -e "$dir/caddy-env-request.json" && -f "$dir/caddy-env-active.json" ]]
[[ "$(wc -l < "$MOCK_DOCKER_LOG")" == "$((before + 2))" ]]
grep -Fxq 'XD_DOMAIN=missing-commit-ack.example.com' "$XD_CONFIG_DIR/config/.env"
# The queued request was discarded; a later recovery must not replay it.
# A restart must not upgrade the immutable FAILED result into SUCCESS.
export MOCK_FAIL_NEW=0 MOCK_FAIL_OLD=0
if caddy_env_recover_interrupted "$dir"; then
  echo "unknown previous gateway falsely recovered" >&2
  exit 1
fi
[[ -f "$dir/caddy-env-active.json" ]]
[[ "$(wc -l < "$MOCK_DOCKER_LOG")" == "$((before + 2))" ]]
python3 - "$dir/caddy-env-result.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
assert r["state"] == "failed" and r["error"] == "caddy-deploy-or-verify-failed"
assert r.get("rolled_back", False) is False
PY

echo "Caddy-only Host deploy and rollback fixtures: OK"
