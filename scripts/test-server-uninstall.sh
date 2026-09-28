#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST_SOURCE="$ROOT/scripts/xdrive-server-host.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/state" "$TMP/host-bin"

cat > "$TMP/bin/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$TEST_STATE/docker-calls"

if [[ "$1" == "compose" ]]; then
  shift
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --profile|--env-file|-f) shift 2 ;;
      *) break ;;
    esac
  done
  case "${1:-}" in
    down) exit 0 ;;
  esac
fi

if [[ "$1" == "volume" && "$2" == "inspect" ]]; then
  volume="$3"
  [[ -f "$TEST_STATE/volume-$volume" ]]
  exit
fi

if [[ "$1" == "volume" && "$2" == "rm" ]]; then
  volume="$3"
  rm -f "$TEST_STATE/volume-$volume"
  printf '%s\n' "$volume"
  exit 0
fi

if [[ "$1" == "ps" && "$2" == "-aq" ]]; then
  exit 0
fi

if [[ "$1" == "run" ]]; then
  host_path=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -v)
        mapping="$2"
        case "$mapping" in
          *:/xdrive-purge) host_path="${mapping%:/xdrive-purge}" ;;
        esac
        shift 2
        ;;
      *) shift ;;
    esac
  done
  [[ -n "$host_path" ]] || {
    echo "fake docker run missing purge bind" >&2
    exit 9
  }
  find "$host_path" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  exit 0
fi

echo "unexpected docker invocation: $*" >&2
exit 9
SH
chmod +x "$TMP/bin/docker"

cat > "$TMP/bin/crontab" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "-l" ]]; then
  cat "$TEST_STATE/crontab" 2>/dev/null || true
  exit 0
fi
cp "$1" "$TEST_STATE/crontab"
SH
chmod +x "$TMP/bin/crontab"

make_home() {
  local home="$1"
  mkdir -p     "$home/config" "$home/bin" "$home/data/files" "$home/data/postgres"     "$home/data/caddy/data" "$home/data/caddy/config"     "$home/backups/snapshots" "$home/logs" "$home/state"
  cp "$HOST_SOURCE" "$home/bin/xdrive-server"
  chmod +x "$home/bin/xdrive-server"
  for tool in server-backup.sh server-backup-scheduled.sh server-restore.sh server-verify.sh server-doctor.sh; do
    printf '#!/usr/bin/env bash\nexit 0\n' > "$home/bin/$tool"
    chmod +x "$home/bin/$tool"
  done
  cat > "$home/config/.env" <<EOF
XD_DOMAIN=
XD_POSTGRES_IMAGE=postgres:17-alpine
XD_FILES_DATA_DIR=$home/data/files
XD_POSTGRES_DATA_DIR=$home/data/postgres
XD_CADDY_DATA_DIR=$home/data/caddy/data
XD_CADDY_CONFIG_DIR=$home/data/caddy/config
EOF
  printf 'name: xdrive\nservices: {}\n' > "$home/config/docker-compose.yml"
  printf 'example.invalid { respond "ok" }\n' > "$home/config/Caddyfile"
  printf 'file-data\n' > "$home/data/files/probe"
  printf 'postgres-data\n' > "$home/data/postgres/probe"
  printf 'caddy-data\n' > "$home/data/caddy/data/probe"
  printf 'caddy-config\n' > "$home/data/caddy/config/probe"
  printf 'backup\n' > "$home/backups/snapshots/probe"
  printf 'log\n' > "$home/logs/backup.log"
  printf '2\n' > "$home/state/layout-version"
}

run_host() {
  local home="$1"
  shift
  TEST_STATE="$TMP/state"   PATH="$TMP/bin:/usr/bin:/bin"   XD_CONFIG_DIR="$home"   XD_SHELL_RC_PATH="$home/.bashrc"   "$home/bin/xdrive-server" "$@"
}

# Destructive cleanup always requires explicit confirmation.
LEGACY_HOME="$TMP/legacy-home"
make_home "$LEGACY_HOME"
cat > "$LEGACY_HOME/state/legacy-volumes-retained" <<'EOF'
files=xdrive_file-data
postgres=xdrive_postgres-data
caddy_data=
caddy_config=
EOF
touch "$TMP/state/volume-xdrive_file-data" "$TMP/state/volume-xdrive_postgres-data"

set +e
run_host "$LEGACY_HOME" cleanup legacy-volumes >"$TMP/cleanup-preview.out" 2>"$TMP/cleanup-preview.err"
preview_status=$?
set -e
[[ "$preview_status" -eq 2 ]]
test -f "$TMP/state/volume-xdrive_file-data"
test -f "$TMP/state/volume-xdrive_postgres-data"
grep -q 'No changes made' "$TMP/cleanup-preview.out"

# Uninstall with retained legacy volumes keeps only a cleanup-capable manager.
printf '0 3 * * * XD_CONFIG_DIR=/tmp/x ~/.xd/bin/server-backup-scheduled.sh # xdrive-managed-backup\n' > "$TMP/state/crontab"
printf '5 4 * * * echo keep-me\n' >> "$TMP/state/crontab"
run_host "$LEGACY_HOME" uninstall --yes >"$TMP/uninstall-legacy.out"

test -f "$LEGACY_HOME/config/.env"
test -f "$LEGACY_HOME/data/files/probe"
test -f "$LEGACY_HOME/backups/snapshots/probe"
test ! -f "$LEGACY_HOME/config/docker-compose.yml"
test ! -f "$LEGACY_HOME/config/Caddyfile"
test -x "$LEGACY_HOME/bin/xdrive-server"
test ! -e "$LEGACY_HOME/bin/server-backup.sh"
test -f "$LEGACY_HOME/state/legacy-volumes-retained"
grep -q '^purge_all=0$' "$LEGACY_HOME/state/runtime-uninstalled"
grep -q 'keep-me' "$TMP/state/crontab"
if grep -q 'xdrive-managed-backup' "$TMP/state/crontab"; then
  echo "managed backup crontab entry survived uninstall" >&2
  exit 1
fi
grep -q 'compose.*down --remove-orphans' "$TMP/state/docker-calls"

TEST_STATE="$TMP/state" PATH="$TMP/bin:/usr/bin:/bin" XD_CONFIG_DIR="$LEGACY_HOME" XD_SHELL_RC_PATH="$LEGACY_HOME/.bashrc" "$LEGACY_HOME/bin/xdrive-server" cleanup legacy-volumes --yes >"$TMP/cleanup.out"

test ! -f "$TMP/state/volume-xdrive_file-data"
test ! -f "$TMP/state/volume-xdrive_postgres-data"
test ! -e "$LEGACY_HOME/state/legacy-volumes-retained"
test ! -e "$LEGACY_HOME/state/runtime-uninstalled"
test ! -e "$LEGACY_HOME/bin/xdrive-server"
if grep -q 'xDrive server PATH' "$LEGACY_HOME/.bashrc"; then
  echo "xDrive PATH marker survived final legacy cleanup" >&2
  exit 1
fi
grep -q 'Legacy xDrive volumes cleaned up' "$TMP/cleanup.out"

# Default uninstall preserves config secrets, data and backups.
KEEP_HOME="$TMP/keep-home"
make_home "$KEEP_HOME"
cp "$KEEP_HOME/config/.env" "$TMP/keep-env-before"
set +e
run_host "$KEEP_HOME" uninstall >"$TMP/uninstall-no-confirm.out" 2>"$TMP/uninstall-no-confirm.err"
no_confirm_status=$?
set -e
[[ "$no_confirm_status" -eq 2 ]]
test -f "$KEEP_HOME/config/docker-compose.yml"
grep -q 'requires --yes' "$TMP/uninstall-no-confirm.err"

run_host "$KEEP_HOME" uninstall --yes >"$TMP/uninstall-keep.out"
cmp "$TMP/keep-env-before" "$KEEP_HOME/config/.env"
test -f "$KEEP_HOME/data/files/probe"
test -f "$KEEP_HOME/data/postgres/probe"
test -f "$KEEP_HOME/backups/snapshots/probe"
test ! -e "$KEEP_HOME/bin"
test ! -e "$KEEP_HOME/logs"
test ! -e "$KEEP_HOME/state"
test ! -e "$KEEP_HOME/config/docker-compose.yml"
test ! -e "$KEEP_HOME/config/Caddyfile"
if grep -q 'xDrive server PATH' "$KEEP_HOME/.bashrc"; then
  echo "xDrive PATH marker survived normal uninstall" >&2
  exit 1
fi
grep -q 'Retained configuration/secrets' "$TMP/uninstall-keep.out"
grep -q 'Retained data' "$TMP/uninstall-keep.out"
grep -q 'Retained backups' "$TMP/uninstall-keep.out"

# Full purge clears container-owned data through Docker and removes the home.
PURGE_HOME="$TMP/purge-home"
make_home "$PURGE_HOME"
run_host "$PURGE_HOME" uninstall --purge-data --purge-backups --yes >"$TMP/uninstall-purge.out"
test ! -e "$PURGE_HOME"
grep -q 'fully uninstalled' "$TMP/uninstall-purge.out"

# Guard dangerous operator overrides before invoking a purge helper.
DANGER_HOME="$TMP/danger-home"
make_home "$DANGER_HOME"
sed -i 's|^XD_FILES_DATA_DIR=.*$|XD_FILES_DATA_DIR=/|' "$DANGER_HOME/config/.env"
set +e
run_host "$DANGER_HOME" uninstall --purge-data --yes >"$TMP/danger.out" 2>"$TMP/danger.err"
danger_status=$?
set -e
[[ "$danger_status" -ne 0 ]]
grep -q 'refusing dangerous purge path for file data: /' "$TMP/danger.err"

echo "server uninstall and legacy-volume cleanup tests passed"
