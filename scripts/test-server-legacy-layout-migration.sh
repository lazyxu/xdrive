#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$ROOT/deploy/install-server.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

HOME_DIR="$TMP/xdrive-home"
SHA="0123456789abcdef0123456789abcdef01234567"
SHORT="${SHA:0:12}"
mkdir -p "$HOME_DIR" "$TMP/bin" "$TMP/state"

cat > "$HOME_DIR/.env" <<'EOF'
POSTGRES_PASSWORD=legacy-postgres-password
XD_JWT_SECRET=legacy-jwt-secret-that-is-long-enough
XD_CONNECTOR_SECRET_ACTIVE_VERSION=1
XD_CONNECTOR_SECRET_KEYS=1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
XD_RELEASE_CHANNEL=master
XD_RELEASE_COMMIT=
XD_SERVER_IMAGE=ghcr.io/lazyxu/xdrive-server:sha-oldoldoldold
XD_WEB_IMAGE=ghcr.io/lazyxu/xdrive-web:sha-oldoldoldold
XD_CADDY_IMAGE=ghcr.io/lazyxu/xdrive-caddy:sha-oldoldoldold
XD_DOMAIN=
XD_WEB_PORT=3000
XD_HTTPS_PORT=8443
EOF
printf 'name: xdrive\nservices: {}\n' > "$HOME_DIR/docker-compose.yml"
printf 'legacy-caddy\n' > "$HOME_DIR/Caddyfile"
for script in server-backup.sh server-backup-scheduled.sh server-restore.sh server-verify.sh server-doctor.sh xdrive-server; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "$HOME_DIR/$script"
  chmod +x "$HOME_DIR/$script"
done

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
dir="$output/xdrive-backup-migration-test"
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
  */scripts/xdrive-server-host.sh) src="$TEST_ROOT/scripts/xdrive-server-host.sh" ;;
  *) echo "unexpected URL: $url" >&2; exit 9 ;;
esac
cat "$src" > "$out"
[[ -n "$write_out" ]] && printf '128\t64\t2.0'
SH
chmod +x "$TMP/bin/curl"

cat > "$TMP/bin/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
args="$*"
printf '%s\n' "$args" >> "$TEST_STATE/docker-calls"

if [[ "$1" == "info" ]]; then
  [[ "$args" == *"--format"* ]] && echo '[]'
  exit 0
fi

if [[ "$1" == "compose" && "$2" == "version" ]]; then
  exit 0
fi

if [[ "$1" == "inspect" ]]; then
  id="${2:-}"
  if [[ "$args" == *".Mounts"* ]]; then
    case "$id:$args" in
      server-old:*'/data'*) ;;
    esac
  fi
  case "$id" in
    server-old)
      if [[ "$args" == *'.Type'* ]]; then echo volume
      elif [[ "$args" == *'.Name'* ]]; then echo xdrive_file-data
      elif [[ "$args" == *'.Source'* ]]; then echo /var/lib/docker/volumes/xdrive_file-data/_data
      else exit 0
      fi ;;
    pg-old)
      if [[ "$args" == *'.State.Running'* ]]; then echo true
      elif [[ "$args" == *'.Config.Env'* ]]; then echo POSTGRES_PASSWORD=legacy-postgres-password
      elif [[ "$args" == *'.Type'* ]]; then echo volume
      elif [[ "$args" == *'.Name'* ]]; then echo xdrive_postgres-data
      elif [[ "$args" == *'.Source'* ]]; then echo /var/lib/docker/volumes/xdrive_postgres-data/_data
      else exit 0
      fi ;;
    caddy-old)
      if [[ "$args" == *'.Destination \"/data\"'* || "$args" == *'Destination "/data"'* ]]; then
        if [[ "$args" == *'.Type'* ]]; then echo volume; else echo xdrive_caddy-data; fi
      elif [[ "$args" == *'.Destination \"/config\"'* || "$args" == *'Destination "/config"'* ]]; then
        if [[ "$args" == *'.Type'* ]]; then echo volume; else echo xdrive_caddy-config; fi
      fi ;;
    *) exit 1 ;;
  esac
  exit 0
fi

if [[ "$1" == "exec" ]]; then
  if [[ "$args" == *"pg_isready"* ]]; then exit 0; fi
  if [[ "$args" == *"PGPASSWORD=legacy-postgres-password"* ]]; then exit 0; fi
  exit 0
fi

if [[ "$1" == "start" ]]; then exit 0; fi
if [[ "$1" == "stop" ]]; then exit 0; fi

if [[ "$1" == "run" ]]; then
  # copy_legacy_volume uses docker run; recording the argv is sufficient for
  # this transaction test because real bind-mount behavior is covered by the
  # deployment integration tests.
  exit 0
fi

if [[ "$1" == "volume" && "$2" == "ls" ]]; then
  exit 0
fi

if [[ "$1" != "compose" ]]; then
  echo "unexpected docker invocation: $*" >&2
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
  ps)
    service="${@: -1}"
    case "$service" in
      server) echo server-old ;;
      postgres) echo pg-old ;;
      caddy) echo caddy-old ;;
    esac
    exit 0
    ;;
  stop)
    exit 0
    ;;
  *)
    echo "unexpected compose invocation: $args" >&2
    exit 9
    ;;
esac
SH
chmod +x "$TMP/bin/docker"

TEST_ROOT="$ROOT" \
TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$HOME_DIR" \
XD_HOST_BIN_DIR="$TMP/no-host-bin" \
XD_SOURCE_REF="$SHA" \
XD_IMAGE_TAG="sha-$SHORT" \
XD_BUILT_CHANNEL=master \
XD_BUILT_COMMIT="$SHA" \
XD_BUILT_SOURCE=github \
XD_IMAGE_REGISTRY=ghcr.io/lazyxu \
XD_NONINTERACTIVE=1 \
XD_INSTALL_NO_START=1 \
bash "$INSTALLER" >"$TMP/out" 2>"$TMP/err"

ACTIVE_ENV="$HOME_DIR/config/.env"
test -f "$ACTIVE_ENV"
test -f "$HOME_DIR/.env"
grep -Fq "XD_FILES_DATA_DIR=$HOME_DIR/data/files" "$ACTIVE_ENV"
grep -Fq "XD_POSTGRES_DATA_DIR=$HOME_DIR/data/postgres" "$ACTIVE_ENV"
grep -Fq "XD_CADDY_DATA_DIR=$HOME_DIR/data/caddy/data" "$ACTIVE_ENV"
grep -Fq "XD_CADDY_CONFIG_DIR=$HOME_DIR/data/caddy/config" "$ACTIVE_ENV"

grep -q 'legacy Docker named-volume deployment detected' "$TMP/out"
grep -q 'migrating file data: xdrive_file-data' "$TMP/out"
grep -q 'migrating PostgreSQL data: xdrive_postgres-data' "$TMP/out"
grep -q 'migrating Caddy data: xdrive_caddy-data' "$TMP/out"
grep -q 'migrating Caddy config: xdrive_caddy-config' "$TMP/out"

grep -Fq 'xdrive_file-data:/from:ro' "$TMP/state/docker-calls"
grep -Fq "$HOME_DIR/data/files:/to" "$TMP/state/docker-calls"
grep -Fq 'xdrive_postgres-data:/from:ro' "$TMP/state/docker-calls"
grep -Fq "$HOME_DIR/data/postgres:/to" "$TMP/state/docker-calls"

test -f "$HOME_DIR/state/legacy-volumes-retained"
grep -q '^files=xdrive_file-data$' "$HOME_DIR/state/legacy-volumes-retained"
grep -q '^postgres=xdrive_postgres-data$' "$HOME_DIR/state/legacy-volumes-retained"

# No-start upgrade intentionally keeps legacy flat files until a fully healthy
# runtime upgrade can finalize the migration.
test -f "$HOME_DIR/.env"
test -f "$HOME_DIR/docker-compose.yml"
test -x "$HOME_DIR/bin/xdrive-server"

echo "server legacy host/data migration tests passed"
