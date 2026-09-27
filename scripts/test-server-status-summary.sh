#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="$ROOT/scripts/xdrive-server-host.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

HOME_DIR="$TMP/home"
mkdir -p   "$HOME_DIR/config" "$HOME_DIR/bin" "$HOME_DIR/data/files" "$HOME_DIR/data/postgres"   "$HOME_DIR/data/caddy/data" "$HOME_DIR/data/caddy/config" "$HOME_DIR/backups"   "$HOME_DIR/state" "$TMP/bin" "$TMP/docker-root"

cat > "$HOME_DIR/config/.env" <<EOF
XD_UPDATE_SOURCE=gitlab
XD_RELEASE_CHANNEL=master
XD_RELEASE_COMMIT=0123456789abcdef0123456789abcdef01234567
XD_DOMAIN=
XD_FILES_DATA_DIR=$HOME_DIR/data/files
XD_POSTGRES_DATA_DIR=$HOME_DIR/data/postgres
XD_CADDY_DATA_DIR=$HOME_DIR/data/caddy/data
XD_CADDY_CONFIG_DIR=$HOME_DIR/data/caddy/config
EOF
printf 'name: xdrive\nservices: {}\n' > "$HOME_DIR/config/docker-compose.yml"
cat > "$HOME_DIR/state/legacy-volumes-retained" <<'EOF'
files=xdrive_old_files
postgres=xdrive_old_postgres
caddy_data=
caddy_config=
EOF

cat > "$TMP/bin/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
args="$*"

if [[ "$1" == "info" ]]; then
  if [[ "$args" == *".SecurityOptions"* ]]; then
    echo '["name=rootless"]'
  elif [[ "$args" == *".DockerRootDir"* ]]; then
    echo "$TEST_DOCKER_ROOT"
  fi
  exit 0
fi

if [[ "$1" == "context" && "$2" == "show" ]]; then
  echo rootless
  exit 0
fi

if [[ "$1" == "volume" && "$2" == "inspect" ]]; then
  [[ "$3" == "xdrive_old_files" ]] && exit 0
  exit 1
fi

if [[ "$1" == "ps" && "$2" == "-aq" ]]; then
  exit 0
fi

if [[ "$1" == "inspect" ]]; then
  id="$2"
  case "$id" in
    server-id)
      echo "bind=$TEST_HOME/data/files"
      ;;
    postgres-id)
      echo "bind=$TEST_HOME/data/postgres"
      ;;
    *)
      exit 1
      ;;
  esac
  exit 0
fi

if [[ "$1" == "compose" ]]; then
  shift
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --profile|--env-file|-f) shift 2 ;;
      *) break ;;
    esac
  done
  if [[ "${1:-}" == "ps" && "${2:-}" == "-aq" ]]; then
    case "${3:-}" in
      server) echo server-id ;;
      postgres) echo postgres-id ;;
      caddy) ;;
    esac
    exit 0
  fi
  if [[ "${1:-}" == "ps" ]]; then
    echo "NAME              STATUS"
    echo "xdrive-server-1   running"
    echo "xdrive-postgres-1 running"
    exit 0
  fi
fi

echo "unexpected docker invocation: $*" >&2
exit 9
SH
chmod +x "$TMP/bin/docker"

cat > "$TMP/bin/df" <<'SH'
#!/usr/bin/env bash
echo 'Filesystem Size Used Avail Use% Mounted on'
echo '/dev/test 200G 50G 150G 25% /srv'
SH
chmod +x "$TMP/bin/df"

TEST_HOME="$HOME_DIR" TEST_DOCKER_ROOT="$TMP/docker-root" PATH="$TMP/bin:/usr/bin:/bin" HOME="$TMP" XD_CONFIG_DIR="$HOME_DIR" bash "$HOST" status --summary-only > "$TMP/summary"

grep -q '^xDrive installation environment$' "$TMP/summary"
grep -Eq 'Docker mode[[:space:]]+rootless$' "$TMP/summary"
grep -Eq 'Docker context[[:space:]]+rootless$' "$TMP/summary"
grep -Fq "$TMP/docker-root" "$TMP/summary"
grep -Eq 'Update[[:space:]]+gitlab / master / 0123456789ab$' "$TMP/summary"
grep -Fq "$HOME_DIR/data/files" "$TMP/summary"
grep -Fq "$HOME_DIR/data/postgres" "$TMP/summary"
grep -Fq "$HOME_DIR/data/caddy/data" "$TMP/summary"
grep -Fq "$HOME_DIR/data/caddy/config" "$TMP/summary"
grep -Fq "$HOME_DIR/backups" "$TMP/summary"
grep -q '200G total, 50G used, 150G free, 25% used, fs=/dev/test' "$TMP/summary"
grep -Fq "mount=bind=$HOME_DIR/data/files" "$TMP/summary"
grep -Fq "mount=bind=$HOME_DIR/data/postgres" "$TMP/summary"
grep -q 'xdrive_old_files (present,unused)' "$TMP/summary"
grep -q 'xdrive_old_postgres (missing)' "$TMP/summary"
if grep -q '^Services$' "$TMP/summary"; then
  echo "--summary-only unexpectedly printed service table" >&2
  exit 1
fi

TEST_HOME="$HOME_DIR" TEST_DOCKER_ROOT="$TMP/docker-root" PATH="$TMP/bin:/usr/bin:/bin" HOME="$TMP" XD_CONFIG_DIR="$HOME_DIR" bash "$HOST" status > "$TMP/status"

grep -q '^xDrive installation environment$' "$TMP/status"
grep -q '^Services$' "$TMP/status"
grep -q 'xdrive-server-1' "$TMP/status"

echo "server status environment-summary tests passed"
