#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$ROOT/deploy/install-server.sh"
TMP="$(mktemp -d)"

cleanup() {
  local status=$?
  if [[ "$status" -ne 0 ]]; then
    echo "server transactional upgrade test failed (exit $status)" >&2
    for file in locked.out locked.err upgrade.out upgrade.err state/docker-calls state/server-ps-count; do
      if [[ -f "$TMP/$file" ]]; then
        echo "===== $file =====" >&2
        cat "$TMP/$file" >&2 || true
      fi
    done
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

mkdir -p "$TMP/bin" "$TMP/state" "$TMP/config"

# Hold the installer lock and verify a second invocation refuses to run.
exec 8>"$TMP/config/.install.lock"
flock -n 8
set +e
PATH="/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/config" \
XD_NONINTERACTIVE=1 \
bash "$INSTALLER" --channel master >"$TMP/locked.out" 2>"$TMP/locked.err"
locked_status=$?
set -e
[[ "$locked_status" -eq 75 ]]
grep -q 'another install/update is already running' "$TMP/locked.err"
flock -u 8
exec 8>&-

cat > "$TMP/bin/sleep" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$TMP/bin/sleep"

cat > "$TMP/bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
url=""
out=""
write_out=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o|--output) out="$2"; shift 2 ;;
    --retry|--retry-delay|--connect-timeout) shift 2 ;;
    -w|--write-out) write_out="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done

emit() {
  if [[ -n "$out" ]]; then
    printf '%s' "$1" > "$out"
    [[ -n "$write_out" ]] && printf '128\t64\t2.0'
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
  */deploy/docker-compose.yml)
    emit 'name: xdrive
services: {}
'
    ;;
  */deploy/Caddyfile)
    emit 'new-caddy
'
    ;;
  */scripts/server-backup.sh)
    emit '#!/usr/bin/env bash
set -euo pipefail
config=""
output=""
leave=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --config-dir) config="$2"; shift 2 ;;
    --output-dir) output="$2"; shift 2 ;;
    --leave-server-stopped) leave=1; shift ;;
    *) shift ;;
  esac
done
[[ "$leave" == "1" ]]
dir="$output/xdrive-backup-test"
mkdir -p "$dir"
touch "$dir/database.dump" "$dir/blobs.tar" "$dir/verify.json" "$dir/manifest.json" "$dir/SHA256SUMS.txt"
printf "%s\n" "$dir"
'
    ;;
  */scripts/server-restore.sh)
    emit '#!/usr/bin/env bash
set -euo pipefail
touch "$TEST_STATE/data-restored"
exit 0
'
    ;;
  */scripts/server-backup-scheduled.sh|*/scripts/server-verify.sh)
    emit '#!/usr/bin/env bash
exit 0
'
    ;;
  *)
    echo "unexpected curl URL: $url" >&2
    exit 9
    ;;
esac
SH
chmod +x "$TMP/bin/curl"

cat > "$TMP/bin/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
args="$*"
printf '%s\n' "$args" >> "$TEST_STATE/docker-calls"

if [[ "$1" == "compose" && "$2" == "version" ]]; then
  exit 0
fi

if [[ "$1" == "inspect" ]]; then
  exit 1
fi

if [[ "$1" == "stop" ]]; then
  exit 0
fi

if [[ "$1" == "ps" ]]; then
  # managed_container_id label fallback: no matching legacy container here.
  exit 0
fi

if [[ "$1" != "compose" ]]; then
  echo "unexpected docker invocation: $*" >&2
  exit 9
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    compose) shift ;;
    --profile|--env-file|-f|--progress) shift 2 ;;
    *) break ;;
  esac
done

case "$1" in
  ps)
    if [[ "$args" == *"ps -aq server"* ]]; then
      echo "old-server"
    fi
    exit 0
    ;;
  pull)
    # Simulate the repetitive Docker progress that must stay in the private log.
    for _ in 1 2 3 4 5; do
      echo "ff96944839b7 Downloading 3.146MB"
    done
    exit 0
    ;;
  up)
    exit 0
    ;;
  exec)
    if [[ "$args" == *"xdrive-server healthcheck"* ]]; then
      if [[ -f "$TEST_STATE/data-restored" ]]; then
        exit 0
      fi
      exit 1
    fi
    exit 0
    ;;
  logs)
    exit 0
    ;;
  *)
    echo "unexpected compose invocation: $*" >&2
    exit 9
    ;;
esac
SH
chmod +x "$TMP/bin/docker"

cat > "$TMP/config/.env" <<'EOF'
POSTGRES_PASSWORD=old-password
XD_JWT_SECRET=old-jwt-secret-that-is-long-enough
XD_RELEASE_CHANNEL=master
XD_RELEASE_COMMIT=
XD_SERVER_IMAGE=ghcr.io/lazyxu/xdrive-server:sha-oldoldoldold
XD_WEB_IMAGE=ghcr.io/lazyxu/xdrive-web:sha-oldoldoldold
XD_CADDY_IMAGE=ghcr.io/lazyxu/xdrive-caddy:sha-oldoldoldold
XD_DOMAIN=
XD_WEB_BIND=0.0.0.0
XD_WEB_PORT=3000
XD_HTTPS_BIND=0.0.0.0
XD_HTTPS_PORT=8443
EOF
printf 'old-compose\n' > "$TMP/config/docker-compose.yml"
printf 'old-caddy\n' > "$TMP/config/Caddyfile"
for script in server-backup.sh server-backup-scheduled.sh server-restore.sh server-verify.sh; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "$TMP/config/$script"
  chmod +x "$TMP/config/$script"
done

set +e
TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/config" \
XD_NONINTERACTIVE=1 \
bash "$INSTALLER" --channel master >"$TMP/upgrade.out" 2>"$TMP/upgrade.err"
status=$?
set -e

[[ "$status" -ne 0 ]]
test -f "$TMP/state/data-restored"
grep -q 'UPGRADE FAILED -> ROLLBACK SUCCESS' "$TMP/upgrade.err"
grep -q '^old-compose$' "$TMP/config/docker-compose.yml"
grep -q '^old-caddy$' "$TMP/config/Caddyfile"
grep -q '^XD_SERVER_IMAGE=ghcr.io/lazyxu/xdrive-server:sha-oldoldoldold$' "$TMP/config/.env"
grep -q '^XD_WEB_IMAGE=ghcr.io/lazyxu/xdrive-web:sha-oldoldoldold$' "$TMP/config/.env"
grep -q '^XD_CADDY_IMAGE=ghcr.io/lazyxu/xdrive-caddy:sha-oldoldoldold$' "$TMP/config/.env"
test ! -d "$TMP/config/.upgrade-transaction"

grep -q 'detailed Docker output is captured' "$TMP/upgrade.out"
if grep -q 'Downloading 3.146MB' "$TMP/upgrade.out" || grep -q 'Downloading 3.146MB' "$TMP/upgrade.err"; then
  echo "raw Docker pull progress leaked into user output" >&2
  exit 1
fi

echo "server transactional upgrade tests passed"
