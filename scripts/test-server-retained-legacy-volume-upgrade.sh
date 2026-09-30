#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$ROOT/deploy/install-server.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

HOME_DIR="$TMP/xdrive-home"
STATE="$TMP/state"
BIN="$TMP/bin"
SHA="0123456789abcdef0123456789abcdef01234567"
SHORT="${SHA:0:12}"

mkdir -p \
  "$HOME_DIR/config" "$HOME_DIR/data/files" "$HOME_DIR/data/postgres" \
  "$HOME_DIR/data/caddy/data" "$HOME_DIR/data/caddy/config" "$BIN" "$STATE"
printf 'current-db-must-survive\n' > "$HOME_DIR/data/postgres/CURRENT_DB_SENTINEL"

cat > "$HOME_DIR/config/.env" <<EOF
POSTGRES_PASSWORD=current-postgres-password
XD_JWT_SECRET=current-jwt-secret-that-is-long-enough
XD_CONNECTOR_SECRET_ACTIVE_VERSION=1
XD_CONNECTOR_SECRET_KEYS=1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
XD_RELEASE_CHANNEL=master
XD_RELEASE_COMMIT=
XD_SERVER_IMAGE=ghcr.io/lazyxu/xdrive-server:sha-current
XD_CADDY_IMAGE=ghcr.io/lazyxu/xdrive-caddy:sha-current
XD_DOMAIN=
XD_WEB_PORT=3000
XD_HTTPS_PORT=8443
XD_FILES_DATA_DIR=$HOME_DIR/data/files
XD_POSTGRES_DATA_DIR=$HOME_DIR/data/postgres
XD_CADDY_DATA_DIR=$HOME_DIR/data/caddy/data
XD_CADDY_CONFIG_DIR=$HOME_DIR/data/caddy/config
EOF
printf 'name: xdrive\nservices: {}\n' > "$HOME_DIR/config/docker-compose.yml"

cat > "$BIN/curl" <<'SH'
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
  */scripts/server-backup.sh)
    cat > "$out" <<'BACKUP'
#!/usr/bin/env bash
set -euo pipefail
output=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --config-dir) shift 2 ;;
    --output-dir) output="$2"; shift 2 ;;
    --leave-server-stopped) shift ;;
    *) shift ;;
  esac
done
dir="$output/xdrive-backup-retained-volume-test"
mkdir -p "$dir"
printf '%s\n' "$dir"
BACKUP
    [[ -n "$write_out" ]] && printf '128\t64\t2.0'
    exit 0
    ;;
  */scripts/server-backup-scheduled.sh) src="$TEST_ROOT/scripts/server-backup-scheduled.sh" ;;
  */scripts/server-restore.sh) src="$TEST_ROOT/scripts/server-restore.sh" ;;
  */scripts/server-verify.sh) src="$TEST_ROOT/scripts/server-verify.sh" ;;
  */scripts/server-doctor.sh) src="$TEST_ROOT/scripts/server-doctor.sh" ;;
  */scripts/server-migrate-user.sh) src="$TEST_ROOT/scripts/server-migrate-user.sh" ;;
  */scripts/xdrive-server-host.sh) src="$TEST_ROOT/scripts/xdrive-server-host.sh" ;;
  *) echo "unexpected URL: $url" >&2; exit 9 ;;
esac
cat "$src" > "$out"
[[ -n "$write_out" ]] && printf '128\t64\t2.0'
SH
chmod +x "$BIN/curl"

cat > "$BIN/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
args="$*"
printf '%s\n' "$args" >> "$TEST_STATE/docker-calls"

if [[ "$1" == "info" ]]; then
  [[ "$args" == *"--format"* ]] && echo '[]'
  exit 0
fi

if [[ "$1" == "inspect" ]]; then
  id="${2:-}"
  case "$id" in
    xdrive-server|xdrive-postgres|xdrive-caddy) ;;
    *) exit 1 ;;
  esac
  if [[ "$args" == *'.State.Running'* ]]; then
    echo true
  elif [[ "$args" == *'.Config.Env'* ]]; then
    if [[ "$id" == "xdrive-postgres" ]]; then
      echo POSTGRES_PASSWORD=current-postgres-password
    elif [[ "$id" == "xdrive-server" ]]; then
      echo XD_JWT_SECRET=current-jwt-secret-that-is-long-enough
      echo XD_CONNECTOR_SECRET_ACTIVE_VERSION=1
      echo XD_CONNECTOR_SECRET_KEYS=1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    fi
  elif [[ "$args" == *'.Type'* ]]; then
    echo bind
  elif [[ "$args" == *'.Source'* ]]; then
    case "$id:$args" in
      xdrive-server:*) echo "$TEST_HOME/data/files" ;;
      xdrive-postgres:*) echo "$TEST_HOME/data/postgres" ;;
      xdrive-caddy:*'/config'*) echo "$TEST_HOME/data/caddy/config" ;;
      xdrive-caddy:*) echo "$TEST_HOME/data/caddy/data" ;;
    esac
  fi
  exit 0
fi

if [[ "$1" == "exec" ]]; then
  if [[ "$args" == *"pg_isready"* ]]; then exit 0; fi
  if [[ "$args" == *"PGPASSWORD=current-postgres-password"* ]]; then exit 0; fi
  exit 0
fi

if [[ "$1" == "start" || "$1" == "stop" ]]; then exit 0; fi

if [[ "$1" == "volume" && "$2" == "ls" ]]; then
  case "$args" in
    *'volume=file-data'*) echo xdrive_file-data ;;
    *'volume=postgres-data'*) echo xdrive_postgres-data ;;
    *'volume=caddy-data'*) echo xdrive_caddy-data ;;
    *'volume=caddy-config'*) echo xdrive_caddy-config ;;
  esac
  exit 0
fi

if [[ "$1" == "run" ]]; then
  echo "retained legacy volume was replayed over active bind data: $args" >&2
  exit 97
fi

if [[ "$1" != "compose" ]]; then
  echo "unexpected docker invocation: $args" >&2
  exit 9
fi

shift
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile|--env-file|-f) shift 2 ;;
    *) break ;;
  esac
done
case "${1:-}" in
  version) exit 0 ;;
  ps)
    service="${@: -1}"
    case "$service" in
      server) echo xdrive-server ;;
      postgres) echo xdrive-postgres ;;
      caddy) echo xdrive-caddy ;;
    esac
    exit 0
    ;;
  stop) exit 0 ;;
  *)
    echo "unexpected compose invocation: $args" >&2
    exit 9
    ;;
esac
SH
chmod +x "$BIN/docker"

TEST_ROOT="$ROOT" \
TEST_STATE="$STATE" \
TEST_HOME="$HOME_DIR" \
PATH="$BIN:/usr/bin:/bin" \
XD_CONFIG_DIR="$HOME_DIR" \
XD_SHELL_RC_PATH="$TMP/current.bashrc" \
XD_SOURCE_REF="$SHA" \
XD_IMAGE_TAG="sha-$SHORT" \
XD_BUILT_CHANNEL=master \
XD_BUILT_COMMIT="$SHA" \
XD_BUILT_SOURCE=github \
XD_IMAGE_REGISTRY=ghcr.io/lazyxu \
XD_NONINTERACTIVE=1 \
XD_INSTALL_NO_START=1 \
bash "$INSTALLER" >"$TMP/out" 2>"$TMP/err"

test -f "$HOME_DIR/data/postgres/CURRENT_DB_SENTINEL"
grep -q '^current-db-must-survive$' "$HOME_DIR/data/postgres/CURRENT_DB_SENTINEL"

if grep -q 'legacy Docker named-volume deployment detected' "$TMP/out"; then
  echo "active bind deployment was incorrectly treated as legacy named-volume deployment" >&2
  exit 1
fi
if grep -q 'migrating PostgreSQL data:' "$TMP/out"; then
  echo "retained PostgreSQL volume was incorrectly replayed" >&2
  exit 1
fi
if grep -q '^volume ls ' "$STATE/docker-calls"; then
  echo "installer searched retained volume labels even though live bind mounts were authoritative" >&2
  exit 1
fi
if grep -q '^run .*:/from:ro' "$STATE/docker-calls"; then
  echo "installer attempted a legacy-volume copy on a bind-mounted deployment" >&2
  exit 1
fi

grep -Fq "XD_POSTGRES_DATA_DIR=$HOME_DIR/data/postgres" "$HOME_DIR/config/.env"
grep -q 'refusing to overwrite non-empty' "$INSTALLER"

echo "retained legacy volumes are ignored after bind migration"
