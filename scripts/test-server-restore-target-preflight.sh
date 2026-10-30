#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
export XD_CONFIG_DIR="$TMP/xd"
export XD_MOUNT_TEST_LOG="$TMP/docker.log"
mkdir -p "$XD_CONFIG_DIR/config" "$TMP/bin" "$TMP/live"
: > "$XD_CONFIG_DIR/config/docker-compose.yml"
: > "$XD_CONFIG_DIR/config/.env"
make_snapshot() {
  mkdir -p "$1"
  printf 'PGDMPtest\n' > "$1/database.dump"
  printf '{"ok":true}\n' > "$1/verify.json"
  printf '{"format_version":1,"file_data_included":true,"consistency_verified":true}\n' > "$1/manifest.json"
  python3 - "$1/blobs.tar" <<'PY'
import io,sys,tarfile
with tarfile.open(sys.argv[1],"w") as tar:
    info=tarfile.TarInfo("./item")
    info.size=4
    tar.addfile(info,io.BytesIO(b"safe"))
PY
  (cd "$1"; sha256sum database.dump verify.json manifest.json blobs.tar > SHA256SUMS.txt)
}
make_snapshot "$TMP/snapshot"
cat > "$TMP/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$XD_MOUNT_TEST_LOG"
if [[ "$1" == run && " $* " == *" --entrypoint pg_restore "* ]]; then
  head -c 5 | grep -q '^PGDMP' || exit 87
  exit 0
fi
if [[ "$1" == compose ]]; then
  if [[ " $* " == *" ps -aq server "* ]]; then
    [[ "$XD_MOUNT_TEST_SERVER" == absent ]] || printf 'mock-server\n'
    exit 0
  fi
  if [[ " $* " == *" ps --status running --services "* ]]; then
    printf 'server\nworker\n'
    exit 0
  fi
  # This is only a deliberately failing admission boundary; never mutate.
  if [[ " $* " == *" up -d postgres "* ]]; then exit 91; fi
  exit 92
fi
if [[ "$1" == inspect && "$2" == mock-server ]]; then
  if [[ " $* " == *'.Type'* ]]; then printf '%s\n' "$XD_MOUNT_TEST_TYPE"
  elif [[ " $* " == *'.Source'* ]]; then printf '%s\n' "$XD_MOUNT_TEST_DATA"
  elif [[ " $* " == *'.Name'* ]]; then printf '%s\n' "$XD_MOUNT_TEST_DATA"
  else exit 93; fi
  exit 0
fi
if [[ "$1" == volume && "$2" == ls ]]; then
  [[ "$XD_MOUNT_TEST_VOLUMES" == none ]] || printf '%s\n' "$XD_MOUNT_TEST_VOLUMES"
  exit 0
fi
if [[ "$1" == volume && "$2" == inspect ]]; then
  [[ "$XD_MOUNT_TEST_VOLUME_PRESENT" == yes ]] || exit 94
  printf '%s\n' "$3"
  exit 0
fi
exit 95
MOCK
chmod 700 "$TMP/bin/docker"
export PATH="$TMP/bin:$PATH"
export XD_MOUNT_TEST_SERVER=present
export XD_MOUNT_TEST_TYPE=bind
export XD_MOUNT_TEST_DATA="$TMP/live"
export XD_MOUNT_TEST_VOLUMES=none
export XD_MOUNT_TEST_VOLUME_PRESENT=yes

reject_early() {
  local label="$1" expected="$2" backup="$3"
  : > "$XD_MOUNT_TEST_LOG"
  if bash "$ROOT/scripts/server-restore.sh" "$backup" --config-dir "$XD_CONFIG_DIR" --yes \
      > "$TMP/$label.log" 2>&1; then
    echo "restore accepted unsafe /data case: $label" >&2; exit 1
  fi
  grep -Fq "$expected" "$TMP/$label.log" || {
    echo "unexpected restore refusal: $label" >&2
    cat "$TMP/$label.log" >&2
    exit 1
  }
  # Read-only TOC check is performed, but never start/stop any live service.
  grep -Fq ' --entrypoint pg_restore ' "$XD_MOUNT_TEST_LOG"
  if grep -Eq ' up -d postgres| stop (server|worker)| dropdb| createdb' "$XD_MOUNT_TEST_LOG"; then
    echo "unsafe /data reached mutable Docker path: $label" >&2; exit 1
  fi
  if grep -Fq 'Creating pre-restore safety backup' "$TMP/$label.log"; then
    echo "unsafe /data entered pre-restore safety backup: $label" >&2; exit 1
  fi
}
XD_MOUNT_TEST_DATA="$TMP/missing" reject_early missing-bind \
  'missing or unsafe /data bind source' "$TMP/snapshot"
ln -s "$TMP/live" "$TMP/live-link"
XD_MOUNT_TEST_DATA="$TMP/live-link" reject_early symlink-bind \
  'missing or unsafe /data bind source' "$TMP/snapshot"
make_snapshot "$TMP/live/snapshot"
XD_MOUNT_TEST_DATA="$TMP/live" reject_early backup-inside-data \
  'backup source nested inside live /data' "$TMP/live/snapshot"
mkdir -p "$TMP/snapshot/target"
XD_MOUNT_TEST_DATA="$TMP/snapshot/target" reject_early data-inside-backup \
  'live /data nested inside backup source' "$TMP/snapshot"
XD_MOUNT_TEST_TYPE=tmpfs reject_early unsupported-mount \
  'unsupported or missing Server /data mount' "$TMP/snapshot"
XD_MOUNT_TEST_TYPE=volume
XD_MOUNT_TEST_DATA=missing-volume
XD_MOUNT_TEST_VOLUME_PRESENT=no reject_early missing-volume \
  'missing /data named volume' "$TMP/snapshot"
XD_MOUNT_TEST_SERVER=absent
XD_MOUNT_TEST_VOLUMES="$(printf 'one-volume\ntwo-volumes')"
reject_early ambiguous-legacy \
  'missing or ambiguous legacy /data volume' "$TMP/snapshot"

reaches_fake_start() {
  local label="$1"
  : > "$XD_MOUNT_TEST_LOG"
  if bash "$ROOT/scripts/server-restore.sh" "$TMP/snapshot" \
      --config-dir "$XD_CONFIG_DIR" --yes --no-safety-backup \
      > "$TMP/$label.log" 2>&1; then
    echo "stub unexpectedly completed restore: $label" >&2; exit 1
  fi
  grep -Fq ' up -d postgres' "$XD_MOUNT_TEST_LOG" || {
    echo "legitimate mount refused before fake PostgreSQL start: $label" >&2
    cat "$TMP/$label.log" >&2
    exit 1
  }
}
XD_MOUNT_TEST_SERVER=present
XD_MOUNT_TEST_TYPE=bind
XD_MOUNT_TEST_DATA="$TMP/live"
XD_MOUNT_TEST_VOLUME_PRESENT=yes
reaches_fake_start valid-bind
XD_MOUNT_TEST_TYPE=volume
XD_MOUNT_TEST_DATA=real-volume
reaches_fake_start valid-volume
XD_MOUNT_TEST_SERVER=absent
XD_MOUNT_TEST_VOLUMES=real-volume
reaches_fake_start legacy-single-volume
echo 'Server restore target admission refused unsafe mounts before outage'
