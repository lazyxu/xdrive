#!/usr/bin/env bash
# P0-B2b2b-1: two genuine cmd/server processes, SAME PostgreSQL, JWT key and
# Local CAS. A real Caddy proxy reloads; Chrome keeps its original JWT.
set -euo pipefail
for v in XD_PWA_B2B2B1_A_ROOT XD_PWA_B2B2B1_B_ROOT \
 XD_PWA_B2B2B1_A_SERVER XD_PWA_B2B2B1_B_SERVER \
 XD_PWA_B2B2B1_OUTPUT XD_TEST_DATABASE_URL XDRIVE_BROWSER_EXECUTABLE \
 XDRIVE_PLAYWRIGHT_MODULE; do
  test -n "$(printenv "$v")" || { echo "missing isolated test prerequisite $v" >&2; exit 1; }
done
A="$XD_PWA_B2B2B1_A_ROOT"
B="$XD_PWA_B2B2B1_B_ROOT"
ASHA="$(git -C "$A" rev-parse HEAD)"
BSHA="$(git -C "$B" rev-parse HEAD)"
test "$ASHA" = "e6018a4c260d1d7fff5e1718421cfb2a21f9dbd4"
test "$ASHA" != "$BSHA"
test -x "$XD_PWA_B2B2B1_A_SERVER" && test -x "$XD_PWA_B2B2B1_B_SERVER"
docker image inspect caddy:2.10.2-alpine >/dev/null
test -f "$B/deploy/Caddyfile.common"
test -f "$B/desktop/scripts/pwa-go-hot-session-b2b2b1.cjs"
test -f "$B/deploy/pwa-archive-assets.sh"
WORK="$(mktemp -d)"
chmod 700 "$WORK"
OUT="$XD_PWA_B2B2B1_OUTPUT"
mkdir -p "$OUT"
CADDY_NAME="xdrive-pwa-b2b2b1-$$"
PORT_A=19901
PORT_B=19902
PORT_CADDY=19903
A_PID=""
B_PID=""
cleanup() {
  docker rm -f "$CADDY_NAME" >/dev/null 2>&1 || true
  for pid in "$B_PID" "$A_PID"; do
    if test -n "$pid" && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$WORK"
}
trap cleanup EXIT

PUBLIC="$WORK/public"
CAS="$WORK/shared-physical-cas"
mkdir -p "$PUBLIC" "$CAS"
chmod 700 "$CAS"
cp -a "$A/web/dist/." "$PUBLIC/"
rm -rf "$PUBLIC/assets"
mkdir "$PUBLIC/assets"
sh "$B/deploy/pwa-archive-assets.sh" "$A/web/dist/assets" "$PUBLIC/assets"
sh "$B/deploy/pwa-archive-assets.sh" "$B/web/dist/assets" "$PUBLIC/assets"

export XD_DATABASE_URL="$XD_TEST_DATABASE_URL"
export XD_JWT_SECRET="pwa-b2b2b1-synthetic-shared-ci-key-only-2026"
export XD_STORAGE_ROOT="$CAS"
export XD_ALLOWED_ORIGIN="http://127.0.0.1:$PORT_CADDY"
export XD_MAX_UPLOAD_BYTES="33554432"
export XD_ACCESS_TOKEN_TTL="40m"

XD_LISTEN_ADDR="127.0.0.1:$PORT_A" "$XD_PWA_B2B2B1_A_SERVER" > "$WORK/private-go-A.log" 2>&1 &
A_PID="$!"
wait_ready() {
  local port="$1" pid="$2"
  for attempt in $(seq 1 140); do
    if curl --silent --fail --max-time 2 "http://127.0.0.1:$port/api/v1/readyz" >/dev/null; then
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "real Go process crashed before ready on port $port" >&2
      return 1
    fi
    sleep 1
  done
  echo "real Go process never became ready on port $port" >&2
  return 1
}
wait_ready "$PORT_A" "$A_PID"
printf '%s\n' "Pwa-B2b2b1-Synthetic-Only_2026!" |
  XD_LISTEN_ADDR="127.0.0.1:$PORT_A" "$XD_PWA_B2B2B1_A_SERVER" \
  admin create --username pwa-b2b2b1-owner --password-stdin \
    > "$WORK/private-admin.log" 2>&1 ||
  { echo "isolated real Go admin bootstrap failed" >&2; exit 1; }

XD_LISTEN_ADDR="127.0.0.1:$PORT_B" "$XD_PWA_B2B2B1_B_SERVER" > "$WORK/private-go-B.log" 2>&1 &
B_PID="$!"
wait_ready "$PORT_B" "$B_PID"

COMMON="$WORK/Caddyfile.common"
CADDYFILE="$WORK/Caddyfile"
grep -Fq "reverse_proxy server:8080" "$B/deploy/Caddyfile.common"
sed "s/server:8080/127.0.0.1:$PORT_A/g" "$B/deploy/Caddyfile.common" > "$COMMON"
cat > "$CADDYFILE" <<EOF
import /etc/caddy/Caddyfile.common
:$PORT_CADDY {
  import xdrive_app
}
EOF
docker run --rm --network host \
 -v "$PUBLIC:/srv:ro" -v "$COMMON:/etc/caddy/Caddyfile.common:ro" \
 -v "$CADDYFILE:/etc/caddy/Caddyfile:ro" \
 caddy:2.10.2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
docker run -d --rm --network host --name "$CADDY_NAME" \
 -v "$PUBLIC:/srv:ro" -v "$COMMON:/etc/caddy/Caddyfile.common:ro" \
 -v "$CADDYFILE:/etc/caddy/Caddyfile:ro" \
 caddy:2.10.2-alpine caddy run --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
for attempt in $(seq 1 50); do
  if curl --silent --fail --max-time 2 "http://127.0.0.1:$PORT_CADDY/index.html" >/dev/null; then
    break
  fi
  docker inspect "$CADDY_NAME" >/dev/null 2>&1 || { echo "real Caddy exited" >&2; exit 1; }
  sleep 1
done
curl --silent --fail --max-time 5 "http://127.0.0.1:$PORT_CADDY/index.html" >/dev/null

XD_PWA_B2B2B1_OUTPUT="$OUT" \
XD_PWA_B2B2B1_CADDY_COMMON="$COMMON" \
XD_PWA_B2B2B1_CADDY_PORT="$PORT_CADDY" \
XD_PWA_B2B2B1_A_PORT="$PORT_A" \
XD_PWA_B2B2B1_B_PORT="$PORT_B" \
XD_PWA_B2B2B1_CADDY_NAME="$CADDY_NAME" \
XD_PWA_B2B2B1_A_DIST="$A/web/dist" \
XD_PWA_B2B2B1_B_DIST="$B/web/dist" \
XD_PWA_B2B2B1_A_SHA="$ASHA" \
XD_PWA_B2B2B1_B_SHA="$BSHA" \
node "$B/desktop/scripts/pwa-go-hot-session-b2b2b1.cjs"

node - "$OUT/summary.json" "$ASHA" "$BSHA" <<'NODE'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const [file, a, b] = process.argv.slice(2)
const result = JSON.parse(fs.readFileSync(file, 'utf8'))
assert(result.passed && result.actualCaddyReload && result.actualCmdServerAB)
assert(result.samePostgresAndCAS && result.originalJWTReused && result.sameOwnerAndFolder)
assert(!result.realUploadDuringSwitch && !result.oldSWHeldWaiting && !result.physicalIOS)
assert(result.sourceA === a && result.sourceB === b)
assert.equal(result.passes.length, 1)
assert(result.passes[0].originalFolder200 && result.passes[0].archivedAandBLazySHA256)
NODE
echo "PWA_B2B2B1_REAL_GO_SHARED_JWT_AND_CADDY_RELOAD_PASSED"
