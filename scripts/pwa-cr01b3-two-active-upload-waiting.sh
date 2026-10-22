#!/usr/bin/env bash
# CR-01b1: actual Go/Caddy/PG/CAS 17MiB upload with old SW waiting in TWO real Chromium windows.
# P0-B2b2b-2a: true 17 MiB browser upload to production Go A. Once chunk0 is
# durably committed, Node SIGKILLs Go A; native Caddy reloads to Go B, and the
# SAME JWT/session resumes/finalizes. Independent Go rereads full physical CAS.
set -euo pipefail
for v in XD_PWA_HOT_UPLOAD_A_ROOT XD_PWA_HOT_UPLOAD_B_ROOT \
 XD_PWA_HOT_UPLOAD_A_SERVER XD_PWA_HOT_UPLOAD_B_SERVER \
 XD_PWA_HOT_UPLOAD_OUTPUT XD_TEST_DATABASE_URL XDRIVE_BROWSER_EXECUTABLE \
 XDRIVE_PLAYWRIGHT_MODULE; do
  test -n "$(printenv "$v")" || { echo "missing isolated test prerequisite $v" >&2; exit 1; }
done
A="$XD_PWA_HOT_UPLOAD_A_ROOT"
B="$XD_PWA_HOT_UPLOAD_B_ROOT"
ASHA="$(git -C "$A" rev-parse HEAD)"
BSHA="$(git -C "$B" rev-parse HEAD)"
test "$ASHA" = "e6018a4c260d1d7fff5e1718421cfb2a21f9dbd4"
test "$ASHA" != "$BSHA"
test -x "$XD_PWA_HOT_UPLOAD_A_SERVER" && test -x "$XD_PWA_HOT_UPLOAD_B_SERVER"
docker image inspect caddy:2.10.2-alpine >/dev/null
test -f "$B/deploy/Caddyfile.common"
test -f "$B/desktop/scripts/pwa-cr01b3-two-active-upload-waiting.cjs"
test -f "$B/deploy/pwa-archive-assets.sh"
WORK="$(mktemp -d)"
chmod 700 "$WORK"
OUT="$XD_PWA_HOT_UPLOAD_OUTPUT"
mkdir -p "$OUT"
CADDY_NAME="xdrive-pwa-cr01b3-$$"
PORT_A=19911
PORT_B=19912
PORT_CADDY=19913
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
export XD_ALLOWED_ORIGIN="https://localhost:$PORT_CADDY"
export XD_MAX_UPLOAD_BYTES="33554432"
export XD_ACCESS_TOKEN_TTL="40m"

XD_LISTEN_ADDR="127.0.0.1:$PORT_A" "$XD_PWA_HOT_UPLOAD_A_SERVER" > "$WORK/private-go-A.log" 2>&1 &
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
  XD_LISTEN_ADDR="127.0.0.1:$PORT_A" "$XD_PWA_HOT_UPLOAD_A_SERVER" \
  admin create --username pwa-b2b2b1-owner --password-stdin \
    > "$WORK/private-admin.log" 2>&1 ||
  { echo "isolated real Go admin bootstrap failed" >&2; exit 1; }

XD_LISTEN_ADDR="127.0.0.1:$PORT_B" "$XD_PWA_HOT_UPLOAD_B_SERVER" > "$WORK/private-go-B.log" 2>&1 &
B_PID="$!"
wait_ready "$PORT_B" "$B_PID"

COMMON="$WORK/Caddyfile.common"
CADDYFILE="$WORK/Caddyfile"
grep -Fq "reverse_proxy server:8080" "$B/deploy/Caddyfile.common"
sed "s/server:8080/127.0.0.1:$PORT_A/g" "$B/deploy/Caddyfile.common" > "$COMMON"
cat > "$CADDYFILE" <<EOF
import /etc/caddy/Caddyfile.common
localhost:$PORT_CADDY {
  tls internal
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
  if curl --insecure --silent --fail --max-time 2 "https://localhost:$PORT_CADDY/index.html" >/dev/null; then
    break
  fi
  docker inspect "$CADDY_NAME" >/dev/null 2>&1 || { echo "real Caddy exited" >&2; exit 1; }
  sleep 1
done
curl --insecure --silent --fail --max-time 5 "https://localhost:$PORT_CADDY/index.html" >/dev/null

XD_PWA_HOT_UPLOAD_OUTPUT="$OUT" \
XD_PWA_HOT_UPLOAD_PUBLIC="$PUBLIC" \
XD_PWA_HOT_UPLOAD_CAS_ROOT="$CAS" \
XD_PWA_HOT_UPLOAD_CADDY_COMMON="$COMMON" \
XD_PWA_HOT_UPLOAD_CADDY_NAME="$CADDY_NAME" \
XD_PWA_HOT_UPLOAD_CADDY_PORT="$PORT_CADDY" \
XD_PWA_HOT_UPLOAD_GO_A_PORT="$PORT_A" \
XD_PWA_HOT_UPLOAD_GO_B_PORT="$PORT_B" \
XD_PWA_HOT_UPLOAD_GO_A_PID="$A_PID" \
XD_PWA_HOT_UPLOAD_A_SHA="$ASHA" \
XD_PWA_HOT_UPLOAD_B_SHA="$BSHA" \
XD_PWA_HOT_UPLOAD_A_DIST="$A/web/dist" \
XD_PWA_HOT_UPLOAD_B_DIST="$B/web/dist" \
node "$B/desktop/scripts/pwa-cr01b3-two-active-upload-waiting.cjs"

# The original Go A has actually been SIGKILLed. A separate Go test process
# independently rereads PostgreSQL and every physical CAS byte finalized by B.
(cd "$B" && XD_PWA_B2B2B2_PHYSICAL=1 go test \
  -run '^TestPWARealGoHotUploadPhysicalPostflight$' \
  -count=1 -v -timeout=6m ./internal/api)

# Independent readback of the second native Chromium upload and CAS.
if [ "${XD_PWA_CR01B5_CROSS_OWNER:-0}" = 1 ]; then
  (cd "$B" && XD_PWA_CR01B5_CROSS_OWNER_PHYSICAL=1 go test \
    -run '^TestPWACR01B5CrossOwnerPhysicalPostflight$' \
    -count=1 -v -timeout=6m ./internal/api)
else
  (cd "$B" && XD_PWA_CR01B3_DUAL_PHYSICAL=1 go test \
    -run '^TestPWACR01B3RealSecondWindowPhysicalPostflight$' \
    -count=1 -v -timeout=6m ./internal/api)
fi

# Both full genuine physical LocalCAS readbacks passed; mark summary only NOW.
node - "$OUT/summary.json" <<'NODE'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const file = process.argv[2]
const s = JSON.parse(fs.readFileSync(file))
assert(s.passed && s.actualGoASigkill && s.actualHttpFileChunks)
s.physicalGoCASPostflight = true
s.secondPhysicalGoCASPostflight = true
fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n')
NODE

node - "$OUT/summary.json" "$ASHA" "$BSHA" <<'NODE'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const [file, a, b] = process.argv.slice(2)
const result = JSON.parse(fs.readFileSync(file, 'utf8'))
assert(result.passed && result.actualGoASigkill && result.realCaddyReload)
assert(result.first8MiBCommittedBeforeGoDeath &&
  result.originalJWTReused && result.originalUploadSessionReused &&
  result.originalChunk0NeverReuploaded && result.actualHttpFileChunks)
assert.equal(result.fileBytes, 17 * 1024 * 1024)
assert.equal(result.chunkCount, 3)
assert(result.sourceA === a && result.sourceB === b)
assert(!result.physicalIOS && result.oldSWWaitingVerified &&
  result.twoOldWindowsStayedControlled && result.oldDocumentStayedMounted &&
  result.realUploadSessionActiveWhileWaiting &&
  result.newSWActivatedOnlyAfterBothClosed &&
  !result.productionFilePicker && result.physicalGoCASPostflight &&
  result.nativeInFlightPut && result.goReadPartialBytes &&
  result.waitingOverlappedInFlight && result.streamedChunkCommitted &&
  !result.bToARollbackProven && result.twoIndependentWindowUploadsProven &&
  result.twoDistinctDurableSessions && result.twoNativeInFlightPuts &&
  result.twoPartialGoCASFiles && result.secondOwnerSessionFinalized &&
  result.secondPhysicalGoCASPostflight &&
  !result.durableTaskCoactivityProven)
if (process.env.XD_PWA_CR01B5_CROSS_OWNER === '1') {
  assert(result.crossOwnerMode && result.crossOwnerDifferentUser &&
    result.crossOwnerACL404 && result.crossOwnerTwoPartitions)
}
NODE
echo "PWA_CR01B3_TWO_REAL_NATIVE_UPLOADS_CAS_AND_SW_WAITING_PASSED"
