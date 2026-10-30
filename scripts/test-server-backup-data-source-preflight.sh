#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
export XD_CONFIG_DIR="$TMP/xd"
export XD_BACKUP_MOUNT_LOG="$TMP/docker.log"
mkdir -p "$XD_CONFIG_DIR/config" "$TMP/bin" "$TMP/live"
: > "$XD_CONFIG_DIR/config/docker-compose.yml"
: > "$XD_CONFIG_DIR/config/.env"
cat > "$TMP/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$XD_BACKUP_MOUNT_LOG"
if [[ "$1" == compose ]]; then
  if [[ " $* " == *" ps --status running --services "* ]]; then
    printf 'server\nworker\n'
    exit 0
  fi
  if [[ " $* " == *" ps -aq server "* ]]; then
    [[ "$XD_BACKUP_MOUNT_SERVER" == absent ]] || printf 'mock-server\n'
    exit 0
  fi
  if [[ " $* " == *" up -d postgres "* ]]; then
    # A valid source can get this far; never start a real database.
    exit 86
  fi
  echo "unexpected Compose call in mount fixture" >&2
  exit 87
fi
if [[ "$1" == inspect && "$2" == mock-server ]]; then
  if [[ " $* " == *".Type"* ]]; then
    printf '%s\n' "$XD_BACKUP_MOUNT_TYPE"
  elif [[ " $* " == *".Source"* || " $* " == *".Name"* ]]; then
    printf '%s\n' "$XD_BACKUP_MOUNT_SOURCE"
  else
    exit 88
  fi
  exit 0
fi
if [[ "$1" == volume && "$2" == ls ]]; then
  [[ "$XD_BACKUP_MOUNT_VOLUMES" == none ]] || printf '%s\n' "$XD_BACKUP_MOUNT_VOLUMES"
  exit 0
fi
if [[ "$1" == volume && "$2" == inspect ]]; then
  [[ "$XD_BACKUP_MOUNT_VOLUME_EXISTS" == yes ]] || exit 89
  printf '%s\n' "$3"
  exit 0
fi
echo "unexpected Docker operation in mount fixture" >&2
exit 90
DOCKER
chmod 700 "$TMP/bin/docker"
export PATH="$TMP/bin:$PATH"
export XD_BACKUP_MOUNT_SERVER=present
export XD_BACKUP_MOUNT_TYPE=bind
export XD_BACKUP_MOUNT_SOURCE="$TMP/live"
export XD_BACKUP_MOUNT_VOLUMES=none
export XD_BACKUP_MOUNT_VOLUME_EXISTS=yes

invoke() {
  local label="$1"; shift
  : > "$XD_BACKUP_MOUNT_LOG"
  if bash "$ROOT/scripts/server-backup.sh" --config-dir "$XD_CONFIG_DIR" \
      "$@" > "$TMP/$label.log" 2>&1; then
    echo "mock backup unexpectedly succeeded: $label" >&2
    exit 1
  fi
}
assert_no_maintenance() {
  local label="$1" reason="$2"
  grep -Fq "$reason" "$TMP/$label.log" || {
    echo "unexpected mount rejection category: $label" >&2
    cat "$TMP/$label.log" >&2
    exit 1
  }
  if grep -Eq ' up -d postgres| stop | start | run ' "$XD_BACKUP_MOUNT_LOG"; then
    echo "unsafe /data was permitted to reach Docker maintenance: $label" >&2
    exit 1
  fi
}
expect_refused() {
  local label="$1" reason="$2"; shift 2
  invoke "$label" "$@"
  assert_no_maintenance "$label" "$reason"
}
expect_admitted() {
  local label="$1"; shift
  invoke "$label" "$@"
  grep -Fq ' up -d postgres' "$XD_BACKUP_MOUNT_LOG" || {
    echo "safe /data failed before mocked PostgreSQL startup: $label" >&2
    cat "$TMP/$label.log" >&2
    exit 1
  }
}
XD_BACKUP_MOUNT_SOURCE="$TMP/does-not-exist" expect_refused missing-bind \
  'missing or unsafe /data bind source'
ln -s "$TMP/live" "$TMP/source-link"
XD_BACKUP_MOUNT_SOURCE="$TMP/source-link" expect_refused symlink-bind \
  'missing or unsafe /data bind source'
XD_BACKUP_MOUNT_SOURCE=/ expect_refused root-bind \
  'unsafe live /data directory'
printf 'not-a-directory' > "$TMP/file"
XD_BACKUP_MOUNT_SOURCE="$TMP/file" expect_refused file-bind \
  'missing or unsafe /data bind source'
XD_BACKUP_MOUNT_TYPE=tmpfs expect_refused unsupported-mount \
  'unsupported or missing Server /data mount'
XD_BACKUP_MOUNT_TYPE=volume XD_BACKUP_MOUNT_SOURCE=missing-volume \
  XD_BACKUP_MOUNT_VOLUME_EXISTS=no expect_refused missing-volume \
  'missing /data named volume'
XD_BACKUP_MOUNT_SERVER=absent XD_BACKUP_MOUNT_VOLUMES=none \
  expect_refused no-legacy-volume 'missing or ambiguous legacy /data volume'
XD_BACKUP_MOUNT_SERVER=absent XD_BACKUP_MOUNT_VOLUMES="$(printf 'vol-one\nvol-two')" \
  expect_refused ambiguous-legacy-volume 'missing or ambiguous legacy /data volume'

# A backup repository under live data must not recurse into itself. The
# mandatory v2 overlap guard remains checked before PostgreSQL startup.
mkdir -p "$TMP/live/backup-repo"
XD_BACKUP_MOUNT_TYPE=bind XD_BACKUP_MOUNT_SOURCE="$TMP/live" \
  expect_refused v2-source-overlap \
  'incremental repository must not be inside live file storage.' \
  --incremental --repository-dir "$TMP/live/backup-repo"

XD_BACKUP_MOUNT_SOURCE="$TMP/live" expect_admitted valid-bind
XD_BACKUP_MOUNT_TYPE=volume XD_BACKUP_MOUNT_SOURCE=real-volume \
  expect_admitted valid-existing-volume
XD_BACKUP_MOUNT_SERVER=absent XD_BACKUP_MOUNT_VOLUMES=single-legacy-volume \
  expect_admitted valid-single-legacy-volume
echo 'backup /data source admission rejected unsafe mounts before maintenance'
