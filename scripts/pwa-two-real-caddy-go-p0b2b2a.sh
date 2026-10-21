#!/usr/bin/env bash
# P0-B2b2a: real Docker Caddy using the unchanged xdrive_app route block
# (only "server:8080" upstream patched to an isolated real Gin fixture).
set -euo pipefail
for key in XD_PWA_B2B2_A_ROOT XD_PWA_B2B2_B_ROOT XD_PWA_B2B2_A_GO \
  XD_PWA_B2B2_B_GO XD_PWA_B2B2_OUTPUT XDRIVE_BROWSER_EXECUTABLE \
  XDRIVE_PLAYWRIGHT_MODULE XD_TEST_DATABASE_URL; do
  test -n "$(printenv "$key")" || { echo "missing B2b2a test prerequisite $key" >&2; exit 1; }
done

A="$XD_PWA_B2B2_A_ROOT"
B="$XD_PWA_B2B2_B_ROOT"
A_SHA="$(git -C "$A" rev-parse HEAD)"
B_SHA="$(git -C "$B" rev-parse HEAD)"
test "$A_SHA" = "e6018a4c260d1d7fff5e1718421cfb2a21f9dbd4"
test "$B_SHA" != "$A_SHA"
test -x "$XD_PWA_B2B2_A_GO"
test -x "$XD_PWA_B2B2_B_GO"
test -f "$B/deploy/Caddyfile.common"
grep -q 'server:8080' "$B/deploy/Caddyfile.common"
test -f "$B/desktop/scripts/pwa-two-real-caddy-go-p0b2b2a.cjs"

OUT="$XD_PWA_B2B2_OUTPUT"
mkdir -p "$OUT"
WORK="$(mktemp -d)"
CONTAINER=""
GO_PID=""
cleanup() {
  if test -n "$CONTAINER"; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
  if test -n "$GO_PID" && kill -0 "$GO_PID" 2>/dev/null; then
    kill "$GO_PID" 2>/dev/null || true
    wait "$GO_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

docker image inspect caddy:2.10.2-alpine >/dev/null
run_case() {
  CASE="$1"
  WEB_ROOT="$2"
  GO_BINARY="$3"
  WEB_SHA="$4"
  GO_SHA="$5"
  CADDY_PORT="$6"

  LOCAL="$WORK/$CASE"
  PUBLIC="$LOCAL/www"
  READY="$LOCAL/private-ready.json"
  CONFIG="$LOCAL/Caddyfile"
  COMMON="$LOCAL/Caddyfile.common"
  CASE_OUTPUT="$OUT/$CASE"
  mkdir -p "$PUBLIC" "$CASE_OUTPUT"
  # Both genuine independent Web builds remain immutable on disk.
  cp -a "$WEB_ROOT/web/dist/." "$PUBLIC/"
  rm -rf "$PUBLIC/assets"
  mkdir "$PUBLIC/assets"
  sh "$B/deploy/pwa-archive-assets.sh" "$A/web/dist/assets" "$PUBLIC/assets"
  sh "$B/deploy/pwa-archive-assets.sh" "$B/web/dist/assets" "$PUBLIC/assets"

  XD_PWA_S2B3_REAL_GIN=1 \
  XD_PWA_S2B3_READY_FILE="$READY" \
  XD_PWA_S2B3_DIST="$WEB_ROOT/web/dist" \
  XD_TEST_DATABASE_URL="$XD_TEST_DATABASE_URL" \
  "$GO_BINARY" -test.run='^TestPWAS2B3RealGinAuthFixture$' \
    -test.count=1 -test.v -test.timeout=9m \
    > "$LOCAL/private-gin.log" 2>&1 &
  GO_PID="$!"
  for attempt in $(seq 1 180); do
    if test -s "$READY"; then break; fi
    if ! kill -0 "$GO_PID" 2>/dev/null; then
      echo "authentic $CASE Go fixture exited before ready" >&2
      exit 1
    fi
    sleep 1
  done
  test -s "$READY" || { echo "authentic $CASE Gin readiness missing" >&2; exit 1; }
  API_PORT="$(node -e 'const f=require("fs");const r=JSON.parse(f.readFileSync(process.argv[1],"utf8"));const u=new URL(r.url);if(u.hostname!=="127.0.0.1")process.exit(1);console.log(u.port)' "$READY")"
  test -n "$API_PORT"
  # Read the real production Caddyfile.common; change only its Docker DNS
  # upstream to this private loopback Go test listener. No production config edit.
  sed "s/server:8080/127.0.0.1:$API_PORT/g" "$B/deploy/Caddyfile.common" > "$COMMON"
  cat > "$CONFIG" <<EOF
import /etc/caddy/Caddyfile.common
:$CADDY_PORT {
  @finish path /__test/pwa-s2b3/finish
  handle @finish {
    reverse_proxy 127.0.0.1:$API_PORT
  }
  import xdrive_app
}
EOF
  CONTAINER="xdrive-pwa-b2b2a-$CADDY_PORT"
  docker run --rm --network host \
    -v "$PUBLIC:/srv:ro" \
    -v "$CONFIG:/etc/caddy/Caddyfile:ro" \
    -v "$COMMON:/etc/caddy/Caddyfile.common:ro" \
    caddy:2.10.2-alpine caddy validate --config /etc/caddy/Caddyfile \
    --adapter caddyfile >/dev/null
  docker run -d --rm --network host --name "$CONTAINER" \
    -v "$PUBLIC:/srv:ro" \
    -v "$CONFIG:/etc/caddy/Caddyfile:ro" \
    -v "$COMMON:/etc/caddy/Caddyfile.common:ro" \
    caddy:2.10.2-alpine caddy run --config /etc/caddy/Caddyfile \
    --adapter caddyfile >/dev/null
  docker exec "$CONTAINER" caddy version >/dev/null
  for attempt in $(seq 1 40); do
    if curl --silent --fail --max-time 2 "http://127.0.0.1:$CADDY_PORT/index.html" >/dev/null; then
      break
    fi
    if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
      echo "genuine $CASE Caddy container exited before readiness" >&2
      exit 1
    fi
    sleep 1
  done
  curl --silent --fail --max-time 4 "http://127.0.0.1:$CADDY_PORT/index.html" >/dev/null

  # Private fixture file contains no JWT, password or media bytes; replacing
  # only the URL directs the browser through the real Caddy reverse proxy.
  node - "$READY" "$CADDY_PORT" <<'NODE'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const [file, port] = process.argv.slice(2)
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(data.url))
assert(/^\d+$/.test(port))
data.url = 'http://127.0.0.1:' + port
fs.writeFileSync(file, JSON.stringify(data), { mode: 0o600 })
NODE

  XD_PWA_B2B2_READY="$READY" \
  XD_PWA_B2B2_WEB_DIST="$WEB_ROOT/web/dist" \
  XD_PWA_B2B2_A_DIST="$A/web/dist" \
  XD_PWA_B2B2_B_DIST="$B/web/dist" \
  XD_PWA_B2B2_WEB_SHA="$WEB_SHA" \
  XD_PWA_B2B2_GO_SHA="$GO_SHA" \
  XD_PWA_B2B2_OUTPUT="$CASE_OUTPUT" \
  node "$B/desktop/scripts/pwa-two-real-caddy-go-p0b2b2a.cjs"

  # A genuine Go test fixture independently revalidates Owner/foreign state,
  # PostgreSQL and physical CAS after the browser completion signal.
  wait "$GO_PID" || { echo "$CASE authentic Go postflight failed" >&2; exit 1; }
  GO_PID=""
  docker rm -f "$CONTAINER" >/dev/null
  CONTAINER=""
  rm -f "$READY" "$LOCAL/private-gin.log"
}
run_case "Aweb-Bgo" "$A" "$XD_PWA_B2B2_B_GO" "$A_SHA" "$B_SHA" 19870
run_case "Bweb-Ago" "$B" "$XD_PWA_B2B2_A_GO" "$B_SHA" "$A_SHA" 19871

node - "$OUT" "$A_SHA" "$B_SHA" <<'NODE'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const [folder, aSha, bSha] = process.argv.slice(2)
const cases = ['Aweb-Bgo', 'Bweb-Ago'].map(name => {
  const report = JSON.parse(fs.readFileSync(path.join(folder, name, 'summary.json')))
  assert(report.passed && report.actualCaddyBinary &&
    report.independentlyCompiledGoServer && report.actualPostgreSQL &&
    report.actualLocalCAS && !report.physicalIOS && !report.runningUploadDuringUpgrade)
  assert.equal(report.versionSkewCases.length, 2)
  assert(report.versionSkewCases.every(x =>
    x.realCaddyHTTP && x.realLogin && x.ownerFiles200 && x.ownerGallery200 &&
    x.serverVersion200 && x.foreignOwner404 && x.twoRealViteArchivesSHA256 &&
    x.missingJS404 && x.noPrivateSWCache))
  return { combination: name, webSha: report.webSha, goSha: report.goSha, passed: true }
})
assert(cases[0].webSha === aSha && cases[0].goSha === bSha)
assert(cases[1].webSha === bSha && cases[1].goSha === aSha)
fs.writeFileSync(path.join(folder, 'summary.json'), JSON.stringify({
  schema: 'xdrive-pwa-cross-real-caddy-go-v1',
  realWebAB: true, realGoAB: true, realCaddy: true,
  productionData: false, physicalIOS: false, realRunningUpload: false,
  cases, passed: true
}, null, 2) + '\n')
NODE
echo "PWA_B2B2A_REAL_CADDY_TWO_GO_WEB_MATRICES_PASSED"
