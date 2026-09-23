#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$ROOT/deploy/install-server.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

MASTER_SHA="0123456789abcdef0123456789abcdef01234567"
MASTER_SHORT="${MASTER_SHA:0:12}"

mkdir -p "$TMP/bin-ok" "$TMP/bin-fail" "$TMP/state"

cat > "$TMP/bin-ok/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
url=""
out=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
[[ -n "$url" ]]
printf '%s\n' "$url" >> "$TEST_STATE/urls"

emit() {
  if [[ -n "$out" ]]; then
    printf '%s' "$1" > "$out"
  else
    printf '%s' "$1"
  fi
}

case "$url" in
  */git/ref/tags/snapshot)
    emit '{
  "ref": "refs/tags/snapshot",
  "object": {
    "type": "commit",
    "sha": "0123456789abcdef0123456789abcdef01234567"
  }
}'
    ;;
  */releases/tags/snapshot-0123456789ab)
    emit '{"tag_name":"snapshot-0123456789ab"}'
    ;;
  */0123456789abcdef0123456789abcdef01234567/deploy/docker-compose.yml)
    emit 'name: xdrive
services: {}
'
    ;;
  */0123456789abcdef0123456789abcdef01234567/deploy/Caddyfile)
    emit 'example.invalid { respond "ok" }
'
    ;;
  */0123456789abcdef0123456789abcdef01234567/scripts/server-backup.sh|\
  */0123456789abcdef0123456789abcdef01234567/scripts/server-backup-scheduled.sh|\
  */0123456789abcdef0123456789abcdef01234567/scripts/server-restore.sh|\
  */0123456789abcdef0123456789abcdef01234567/scripts/server-verify.sh)
    emit '#!/usr/bin/env bash
exit 0
'
    ;;
  *)
    echo "unexpected URL: $url" >&2
    exit 9
    ;;
esac
SH
chmod +x "$TMP/bin-ok/curl"

cat > "$TMP/bin-ok/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$#" -ge 2 && "$1" == "compose" && "$2" == "version" ]]; then
  echo "Docker Compose version v2.test"
  exit 0
fi
echo "unexpected docker invocation: $*" >&2
exit 9
SH
chmod +x "$TMP/bin-ok/docker"

TEST_STATE="$TMP/state" \
PATH="$TMP/bin-ok:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/config-ok" \
XD_NONINTERACTIVE=1 \
XD_INSTALL_NO_START=1 \
bash "$INSTALLER" >"$TMP/ok.out" 2>"$TMP/ok.err"

grep -q '\[xDrive\] \[1/9\] resolve release channel' "$TMP/ok.out"
grep -q 'Resolved master snapshot: 0123456789ab' "$TMP/ok.out"
grep -q '\[xDrive\] \[9/9\] complete' "$TMP/ok.out"
grep -q "XD_SERVER_IMAGE=ghcr.io/lazyxu/xdrive-server:sha-$MASTER_SHORT" "$TMP/config-ok/.env"
grep -q "XD_WEB_IMAGE=ghcr.io/lazyxu/xdrive-web:sha-$MASTER_SHORT" "$TMP/config-ok/.env"
grep -q "XD_CADDY_IMAGE=ghcr.io/lazyxu/xdrive-caddy:sha-$MASTER_SHORT" "$TMP/config-ok/.env"
grep -q "XD_HTTPS_PORT=8443" "$TMP/config-ok/.env"
grep -q "/$MASTER_SHA/deploy/docker-compose.yml$" "$TMP/state/urls"

if grep -q '/releases/download/snapshot/xdrive-server-install.sh$' "$TMP/state/urls"; then
  echo "raw master installer must not recursively download another installer" >&2
  cat "$TMP/state/urls" >&2
  exit 1
fi

cat > "$TMP/bin-fail/curl" <<'SH'
#!/usr/bin/env bash
exit 22
SH
chmod +x "$TMP/bin-fail/curl"

set +e
PATH="$TMP/bin-fail:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/config-fail" \
XD_NONINTERACTIVE=1 \
XD_INSTALL_NO_START=1 \
bash "$INSTALLER" >"$TMP/fail.out" 2>"$TMP/fail.err"
status=$?
set -e

[[ "$status" -ne 0 ]]
grep -q 'could not resolve the rolling master snapshot' "$TMP/fail.err"
grep -q '\[xDrive\] FAILED at stage 1/9: resolve release channel' "$TMP/fail.err"
if grep -q 'unresolved deployment template' "$TMP/fail.err"; then
  echo "installer fell back to the old unresolved-template failure" >&2
  cat "$TMP/fail.err" >&2
  exit 1
fi

echo "server installer bootstrap and stage-reporting tests passed"
