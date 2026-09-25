#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$ROOT/deploy/install-server.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

SHA="0123456789abcdef0123456789abcdef01234567"
mkdir -p "$TMP/bin" "$TMP/config" "$TMP/state"

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
}' ;;
  */releases/tags/snapshot-0123456789ab)
    emit '{"tag_name":"snapshot-0123456789ab"}' ;;
  */deploy/docker-compose.yml)
    emit 'name: xdrive
services: {}
' ;;
  */deploy/Caddyfile)
    emit 'example.invalid { respond "ok" }
' ;;
  */scripts/server-backup.sh)
    emit '#!/usr/bin/env bash
set -euo pipefail
# This intentionally attempts to read stdin. The installer must invoke this
# script with /dev/null, otherwise a curl|bash source pipe can be drained.
if IFS= read -r -t 0.1 leaked; then
  echo "backup inherited installer stdin: $leaked" >&2
  exit 97
fi
output=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir) output="$2"; shift 2 ;;
    --config-dir) shift 2 ;;
    --leave-server-stopped) shift ;;
    *) shift ;;
  esac
done
dir="$output/xdrive-backup-pipe-test"
mkdir -p "$dir"
printf "%s\n" "$dir"
' ;;
  */scripts/server-backup-scheduled.sh|*/scripts/server-restore.sh|*/scripts/server-verify.sh|*/scripts/server-doctor.sh|*/scripts/xdrive-server-host.sh)
    emit '#!/usr/bin/env bash
exit 0
' ;;
  *) echo "unexpected URL: $url" >&2; exit 9 ;;
esac
SH
chmod +x "$TMP/bin/curl"

cat > "$TMP/bin/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
args="$*"
stdin_target="$(readlink /proc/$$/fd/0 2>/dev/null || true)"
printf '%s | stdin=%s\n' "$args" "$stdin_target" >> "$TEST_STATE/docker-calls"

if [[ "$stdin_target" == pipe:* ]]; then
  echo "non-interactive docker inherited installer pipe: $args" >&2
  exit 98
fi

if [[ "$1" == "compose" && "$2" == "version" ]]; then exit 0; fi
if [[ "$1" == "inspect" ]]; then exit 1; fi
if [[ "$1" == "ps" ]]; then exit 0; fi
if [[ "$1" == "stop" ]]; then exit 0; fi
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
    if [[ "$args" == *"ps -aq server"* ]]; then echo old-server; fi
    exit 0 ;;
  *)
    echo "unexpected compose invocation: $args" >&2
    exit 9 ;;
esac
SH
chmod +x "$TMP/bin/docker"

cat > "$TMP/config/.env" <<'EOF'
POSTGRES_PASSWORD=pipe-password
XD_JWT_SECRET=pipe-jwt-secret-that-is-long-enough
XD_RELEASE_CHANNEL=master
XD_RELEASE_COMMIT=
XD_SERVER_IMAGE=ghcr.io/lazyxu/xdrive-server:sha-oldoldoldold
XD_WEB_IMAGE=ghcr.io/lazyxu/xdrive-web:sha-oldoldoldold
XD_CADDY_IMAGE=ghcr.io/lazyxu/xdrive-caddy:sha-oldoldoldold
XD_DOMAIN=
EOF
printf 'name: xdrive\nservices: {}\n' > "$TMP/config/docker-compose.yml"
for script in server-backup.sh server-backup-scheduled.sh server-restore.sh server-verify.sh server-doctor.sh; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "$TMP/config/$script"
  chmod +x "$TMP/config/$script"
done

set +e
(
  set +e
  cat "$INSTALLER" || exit 0
  # Keep more source bytes pending than bash normally buffers. A child that
  # inherits the pipe will consume one of these lines. The installer itself
  # exits before consuming the padding, so SIGPIPE on the producer is expected.
  for i in $(seq 1 5000); do
    printf '# pipe-padding-%05d-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n' "$i" 2>/dev/null || break
  done
  exit 0
) | TEST_STATE="$TMP/state" \
    PATH="$TMP/bin:/usr/bin:/bin" \
    XD_CONFIG_DIR="$TMP/config" \
    XD_NONINTERACTIVE=1 \
    XD_INSTALL_NO_START=1 \
    bash -s -- --channel master >"$TMP/out" 2>"$TMP/err"
pipe_status=("${PIPESTATUS[@]}")
set -e

producer_status="${pipe_status[0]:-1}"
installer_status="${pipe_status[1]:-1}"

if [[ "$installer_status" -ne 0 ]]; then
  echo "pipe installer consumer failed with $installer_status" >&2
  cat "$TMP/out" >&2 || true
  cat "$TMP/err" >&2 || true
  cat "$TMP/state/docker-calls" >&2 || true
  exit 1
fi

if [[ "$producer_status" -ne 0 && "$producer_status" -ne 141 ]]; then
  echo "pipe installer producer failed unexpectedly with $producer_status" >&2
  cat "$TMP/out" >&2 || true
  cat "$TMP/err" >&2 || true
  cat "$TMP/state/docker-calls" >&2 || true
  exit 1
fi

grep -q '\[xDrive\] \[6/9\] install deployment files' "$TMP/out"
grep -q '\[xDrive\] \[9/9\] complete' "$TMP/out"
if grep -q 'inherited installer stdin' "$TMP/err"; then
  cat "$TMP/err" >&2
  exit 1
fi
if grep -q 'stdin=pipe:' "$TMP/state/docker-calls"; then
  echo "Docker inherited source pipe" >&2
  cat "$TMP/state/docker-calls" >&2
  exit 1
fi

echo "pipe installer stdin isolation tests passed"
