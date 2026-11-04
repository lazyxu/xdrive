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
    if [[ "$XD_BACKUP_MOUNT_SERVER" != absent ]]; then
      read -r -a ids <<< "${XD_BACKUP_MOUNT_IDS:-mock-server}"
      printf '%s\n' "${ids[@]}"
    fi
    exit 0
  fi
  if [[ " $* " == *" up -d postgres "* ]]; then
    # A valid source can get this far; never start a real database.
    exit 86
  fi
  echo "unexpected Compose call in mount fixture" >&2
  exit 87
fi
if [[ "$1" == inspect && "$2" == mock-* ]]; then
  if [[ " $* " == *"com.docker.compose.oneoff"* ]]; then
    case "$2" in
      mock-server)         printf '/xdrive-server|xdrive|server|False|running|true\n' ;;
      mock-stopped-server) printf '/xdrive-server|xdrive|server|False|exited|false\n' ;;
      mock-legacy-server)  printf '/xdrive-server-1|xdrive|server|<no value>|running|true\n' ;;
      mock-second-server)  printf '/xdrive-server-1|xdrive|server|False|exited|false\n' ;;
      mock-oneoff-created) printf '/xdrive-server-run-1|xdrive|server|True|created|false\n' ;;
      mock-oneoff-exited)  printf '/xdrive-server-run-2|xdrive|server|True|exited|false\n' ;;
      mock-oneoff-running) printf '/xdrive-server-run-3|xdrive|server|True|running|true\n' ;;
      mock-oneoff-dead)    printf '/xdrive-server-run-4|xdrive|server|True|dead|false\n' ;;
      mock-bad-project)    printf '/xdrive-server|other|server|False|running|true\n' ;;
      mock-bad-service)    printf '/xdrive-server|xdrive|worker|False|running|true\n' ;;
      mock-bad-oneoff)     printf '/xdrive-server|xdrive|server|unknown|running|true\n' ;;
      mock-unmarked-run)   printf '/xdrive-server-run-5|xdrive|server|<no value>|created|false\n' ;;
      *) exit 88 ;;
    esac
  elif [[ " $* " == *".Type"* ]]; then
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
  if [[ " $* " == *".Mountpoint"* ]]; then
    printf '%s\n' "${XD_BACKUP_MOUNT_VOLUME_PATH:-}"
  else
    printf '%s\n' "$3"
  fi
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
export XD_BACKUP_MOUNT_VOLUME_PATH="$TMP/volume-data"
mkdir -p "$XD_BACKUP_MOUNT_VOLUME_PATH"

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
expect_preflight_ok() {
  local label="$1"; shift
  : > "$XD_BACKUP_MOUNT_LOG"
  bash "$ROOT/scripts/server-backup.sh" --config-dir "$XD_CONFIG_DIR" \
    --preflight-only "$@" > "$TMP/$label.log" 2>&1 || {
      cat "$TMP/$label.log" >&2
      echo "read-only source preflight unexpectedly failed: $label" >&2
      exit 1
    }
  grep -Fq 'source admitted (read-only)' "$TMP/$label.log"
  if grep -Eq ' up -d postgres| stop | start | run ' "$XD_BACKUP_MOUNT_LOG"; then
    echo "source preflight changed Docker services: $label" >&2
    exit 1
  fi
}
# The reported Gen10 state: one managed Server and two stopped Compose run
# containers must be accepted without inspecting a one-off's /data mount.
XD_BACKUP_MOUNT_IDS="mock-oneoff-created mock-server mock-oneoff-exited" \
  expect_preflight_ok leftover-run-containers
test ! -e "$XD_CONFIG_DIR/backups"
XD_BACKUP_MOUNT_IDS="mock-oneoff-created mock-server mock-oneoff-exited" \
  expect_admitted valid-with-leftover-runs
XD_BACKUP_MOUNT_IDS="mock-stopped-server mock-oneoff-created" \
  expect_preflight_ok stopped-managed-server
XD_BACKUP_MOUNT_IDS="mock-legacy-server mock-oneoff-exited" \
  expect_preflight_ok legacy-managed-server
XD_BACKUP_MOUNT_IDS="mock-server mock-second-server" \
  expect_refused ambiguous-managed 'ambiguous managed Server container identity'
XD_BACKUP_MOUNT_IDS="mock-oneoff-created mock-oneoff-exited" \
  expect_refused oneoffs-only 'no managed Server container among one-off tasks'
XD_BACKUP_MOUNT_IDS="mock-server mock-oneoff-running" \
  expect_refused active-oneoff 'active or ambiguous Server one-off task'
XD_BACKUP_MOUNT_IDS="mock-server mock-oneoff-dead" \
  expect_refused unknown-oneoff-state 'active or ambiguous Server one-off task'
XD_BACKUP_MOUNT_IDS="mock-server mock-bad-project" \
  expect_refused invalid-project 'invalid Compose Server identity labels'
XD_BACKUP_MOUNT_IDS="mock-server mock-bad-service" \
  expect_refused invalid-service 'invalid Compose Server identity labels'
XD_BACKUP_MOUNT_IDS="mock-server mock-bad-oneoff" \
  expect_refused invalid-oneoff 'invalid Server one-off identity label'
XD_BACKUP_MOUNT_IDS="mock-unmarked-run" \
  expect_refused unmarked-run 'missing Server one-off identity label'
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

# V2 must use the real host backing directory of a named volume,
# including both overlap directions and symlinked parent aliases.
mkdir -p "$TMP/volume-data/backup-inside" "$TMP/backup-parent/volume-data"
XD_BACKUP_MOUNT_TYPE=volume XD_BACKUP_MOUNT_SOURCE=real-volume \
  XD_BACKUP_MOUNT_VOLUME_PATH="$TMP/nonexistent-volume-mount" \
  expect_refused v2-volume-mountpoint-missing \
  'cannot verify incremental /data volume mountpoint' \
  --incremental --repository-dir "$TMP/safe-v2-backup"
XD_BACKUP_MOUNT_TYPE=volume XD_BACKUP_MOUNT_SOURCE=real-volume \
  XD_BACKUP_MOUNT_VOLUME_PATH=/ \
  expect_refused v2-volume-root \
  'cannot verify incremental /data volume mountpoint' \
  --incremental --repository-dir "$TMP/safe-v2-backup"
XD_BACKUP_MOUNT_TYPE=volume XD_BACKUP_MOUNT_SOURCE=real-volume \
  XD_BACKUP_MOUNT_VOLUME_PATH="$TMP/volume-data" \
  expect_refused v2-volume-repository-nested \
  'incremental repository must not be inside live file storage.' \
  --incremental --repository-dir "$TMP/volume-data/backup-inside"
XD_BACKUP_MOUNT_TYPE=volume XD_BACKUP_MOUNT_SOURCE=real-volume \
  XD_BACKUP_MOUNT_VOLUME_PATH="$TMP/backup-parent/volume-data" \
  expect_refused v2-volume-source-nested \
  'live file storage must not be inside incremental repository.' \
  --incremental --repository-dir "$TMP/backup-parent"
ln -s "$TMP/volume-data" "$TMP/volume-link"
XD_BACKUP_MOUNT_TYPE=volume XD_BACKUP_MOUNT_SOURCE=real-volume \
  XD_BACKUP_MOUNT_VOLUME_PATH="$TMP/volume-link" \
  expect_refused v2-volume-symlink-parent \
  'incremental repository must not be inside live file storage.' \
  --incremental --repository-dir "$TMP/volume-data/backup-inside"

XD_BACKUP_MOUNT_SOURCE="$TMP/live" expect_admitted valid-bind
XD_BACKUP_MOUNT_TYPE=volume XD_BACKUP_MOUNT_SOURCE=real-volume \
  expect_admitted valid-existing-volume
XD_BACKUP_MOUNT_TYPE=volume XD_BACKUP_MOUNT_SOURCE=real-volume \
  expect_admitted valid-disjoint-v2-volume \
  --incremental --repository-dir "$TMP/safe-v2-backup"
XD_BACKUP_MOUNT_SERVER=absent XD_BACKUP_MOUNT_VOLUMES=single-legacy-volume \
  expect_admitted valid-single-legacy-volume
echo 'backup /data source admission rejected unsafe mounts before maintenance'
