#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$ROOT/deploy/install-server.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

SHA="0123456789abcdef0123456789abcdef01234567"
SHORT="${SHA:0:12}"
mkdir -p "$TMP/bin" "$TMP/state"

cat > "$TMP/bin/id" <<'SH'
#!/usr/bin/env bash
case "${1:-}" in
  -u) echo 1000 ;;
  -g) echo 1000 ;;
  -un) echo xdrive-test ;;
  *) /usr/bin/id "$@" ;;
esac
SH
chmod +x "$TMP/bin/id"

cat > "$TMP/bin/sysctl" <<'SH'
#!/usr/bin/env bash
if [[ "$*" == "-n net.ipv4.ip_unprivileged_port_start" ]]; then
  echo 1024
  exit 0
fi
exec /usr/sbin/sysctl "$@"
SH
chmod +x "$TMP/bin/sysctl"

cat > "$TMP/bin/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "info" ]]; then
  if [[ "$*" == *"--format"* ]]; then
    if [[ "${TEST_ROOTLESS:-0}" == "1" ]]; then
      echo '["name=rootless"]'
    else
      echo '[]'
    fi
  fi
  exit 0
fi
if [[ "$1" == "compose" && "$2" == "version" ]]; then
  echo "Docker Compose version v2.test"
  exit 0
fi
echo "unexpected docker invocation: $*" >&2
exit 9
SH
chmod +x "$TMP/bin/docker"

cat > "$TMP/bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
out=""
url=""
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
[[ -n "$url" && -n "$out" ]]
case "$url" in
  */deploy/docker-compose.yml) src="$TEST_ROOT/deploy/docker-compose.yml" ;;
  */deploy/Caddyfile) src="$TEST_ROOT/deploy/Caddyfile" ;;
  */scripts/server-backup.sh) src="$TEST_ROOT/scripts/server-backup.sh" ;;
  */scripts/server-backup-scheduled.sh) src="$TEST_ROOT/scripts/server-backup-scheduled.sh" ;;
  */scripts/server-restore.sh) src="$TEST_ROOT/scripts/server-restore.sh" ;;
  */scripts/server-verify.sh) src="$TEST_ROOT/scripts/server-verify.sh" ;;
  */scripts/server-doctor.sh) src="$TEST_ROOT/scripts/server-doctor.sh" ;;
  */scripts/server-migrate-user.sh) src="$TEST_ROOT/scripts/server-migrate-user.sh" ;;
  */scripts/server-control.sh) src="$TEST_ROOT/scripts/server-control.sh" ;;
  */scripts/xdrive-server-host.sh) src="$TEST_ROOT/scripts/xdrive-server-host.sh" ;;
  *) echo "unexpected URL: $url" >&2; exit 9 ;;
esac
cat "$src" > "$out"
[[ -n "$write_out" ]] && printf '128\t64\t2.0'
SH
chmod +x "$TMP/bin/curl"

run_install() {
  local home="$1" rootless="$2"
  shift 2
  TEST_ROOT="$ROOT" \
  TEST_ROOTLESS="$rootless" \
  PATH="$TMP/bin:/usr/bin:/bin" \
  XD_CONFIG_DIR="$home" \
  XD_SHELL_RC_PATH="$home.bashrc" \
  XD_SOURCE_REF="$SHA" \
  XD_IMAGE_TAG="sha-$SHORT" \
  XD_BUILT_CHANNEL=master \
  XD_BUILT_COMMIT="$SHA" \
  XD_BUILT_SOURCE=github \
  XD_IMAGE_REGISTRY=ghcr.io/lazyxu \
  XD_NONINTERACTIVE=1 \
  XD_INSTALL_NO_START=1 \
  bash "$INSTALLER" "$@"
}

ROOTLESS_HOME="$TMP/rootless-home"
run_install "$ROOTLESS_HOME" 1 >"$TMP/rootless.out" 2>"$TMP/rootless.err"

ENV="$ROOTLESS_HOME/config/.env"
test -f "$ENV"
grep -q '^XD_DOCKER_MODE=rootless$' "$ENV"
grep -q '^XD_SERVER_UID=65532$' "$ENV"
grep -q '^XD_SERVER_GID=65532$' "$ENV"
grep -Fq "XD_FILES_DATA_DIR=$ROOTLESS_HOME/data/files" "$ENV"
grep -Fq "XD_POSTGRES_DATA_DIR=$ROOTLESS_HOME/data/postgres" "$ENV"
grep -Fq "XD_CADDY_DATA_DIR=$ROOTLESS_HOME/data/caddy/data" "$ENV"
grep -Fq "XD_CADDY_CONFIG_DIR=$ROOTLESS_HOME/data/caddy/config" "$ENV"

for dir in config bin data backups/snapshots backups/pre-upgrade backups/pre-restore logs state; do
  test -d "$ROOTLESS_HOME/$dir" || {
    echo "missing canonical directory: $dir" >&2
    exit 1
  }
done

test -x "$ROOTLESS_HOME/bin/xdrive-server"
test -x "$ROOTLESS_HOME/bin/server-migrate-user.sh"
test -x "$ROOTLESS_HOME/bin/server-backup.sh"
test -f "$ROOTLESS_HOME/config/docker-compose.yml"
test -f "$ROOTLESS_HOME/state/layout-version"
test "$(cat "$ROOTLESS_HOME/state/layout-version")" = "2"
test ! -e "$ROOTLESS_HOME/.env"
test ! -e "$ROOTLESS_HOME/docker-compose.yml"
test ! -e "$ROOTLESS_HOME/xdrive-server"
grep -Fq 'Docker mode: rootless (installer uid=1000, server uid=65532 gid=65532)' "$TMP/rootless.out"

ROOTFUL_HOME="$TMP/rootful-home"
run_install "$ROOTFUL_HOME" 0 >"$TMP/rootful.out" 2>"$TMP/rootful.err"
grep -q '^XD_DOCKER_MODE=rootful$' "$ROOTFUL_HOME/config/.env"
grep -q '^XD_SERVER_UID=65532$' "$ROOTFUL_HOME/config/.env"
grep -q '^XD_SERVER_GID=65532$' "$ROOTFUL_HOME/config/.env"
grep -Fq 'Docker mode: rootful (installer uid=1000, server uid=65532 gid=65532)' "$TMP/rootful.out"

set +e
XD_WEB_PORT=80 run_install "$TMP/rootless-low-port" 1 >"$TMP/low.out" 2>"$TMP/low.err"
low_status=$?
set -e
[[ "$low_status" -ne 0 ]]
grep -q 'Rootless Docker cannot bind Web port 80' "$TMP/low.err"

if grep -Eq '(^|[[:space:]])sudo([[:space:]]|$)|EUID.*0|id -u.*-ne 0' "$INSTALLER"; then
  echo "installer contains a root/sudo requirement" >&2
  exit 1
fi

for legacy_mount in \
  'postgres-data:/var/lib/postgresql/data' \
  'file-data:/data' \
  'caddy-data:/data' \
  'caddy-config:/config'; do
  if grep -Fq "$legacy_mount" "$ROOT/deploy/docker-compose.yml"; then
    echo "Compose still defaults to named volume mount: $legacy_mount" >&2
    exit 1
  fi
done

grep -Fq '${XD_FILES_DATA_DIR:-../data/files}:/data' "$ROOT/deploy/docker-compose.yml"
grep -Fq '${XD_POSTGRES_DATA_DIR:-../data/postgres}:/var/lib/postgresql/data' "$ROOT/deploy/docker-compose.yml"

echo "server rootless/non-root host-layout tests passed"
