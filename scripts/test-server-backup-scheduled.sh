#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export XD_CONFIG_DIR="$TMP/home"
export XD_SCHEDULE_TEST_LOG="$TMP/argv.log"
export XD_SCHEDULE_DOCKER_CALLS="$TMP/pg-archive-inspections.log"
mkdir -p "$TMP/mock-bin"
cat > "$TMP/mock-bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == run && " $* " == *" --entrypoint pg_restore "* &&
   " $* " == *" --network none "* && " $* " == *" --read-only "* &&
   " $* " == *" --pull never "* ]] || exit 70
printf 'read-only TOC inspection\n' >> "$XD_SCHEDULE_DOCKER_CALLS"
[[ "$(head -c 5)" == PGDMP ]] || exit 71
DOCKER
chmod 700 "$TMP/mock-bin/docker"
export PATH="$TMP/mock-bin:$PATH"
mkdir -p "$XD_CONFIG_DIR/config" "$XD_CONFIG_DIR/bin" "$XD_CONFIG_DIR/backups/snapshots"
env_file="$XD_CONFIG_DIR/config/.env"
script="$ROOT/scripts/server-backup-scheduled.sh"
[[ -f "$script" ]]
cat > "$XD_CONFIG_DIR/bin/xdrive-server" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "$XD_SCHEDULE_TEST_LOG"
if [[ "${1:-}" == backup && "${2:-}" == --output-dir ]]; then
  case "${XD_SCHEDULE_MOCK_MODE:-good}" in
    no_snapshot) exit 0 ;;
    wrong_path) printf '%s\n' "$XD_CONFIG_DIR/backups/incremental/snapshots/xdrive-backup-20990101T000000Z"; exit 0 ;;
    old_path)
      for existing in "$XD_CONFIG_DIR"/backups/snapshots/xdrive-backup-*; do
        if [[ -f "$existing/SHA256SUMS.txt" ]]; then
          printf '%s\n' "$existing"
          exit 0
        fi
      done
      exit 1 ;;

  esac
  snap="$XD_CONFIG_DIR/backups/snapshots/xdrive-backup-$(date -u +%Y%m%dT%H%M%SZ)"
  case "${XD_SCHEDULE_MOCK_MODE:-good}" in
    tampered) snap="$XD_CONFIG_DIR/backups/snapshots/xdrive-backup-20990101T001000Z" ;;
    database_only) snap="$XD_CONFIG_DIR/backups/snapshots/xdrive-backup-20990101T002000Z" ;;
    traversal) snap="$XD_CONFIG_DIR/backups/snapshots/xdrive-backup-20990101T003000Z" ;;
    symlink_member) snap="$XD_CONFIG_DIR/backups/snapshots/xdrive-backup-20990101T004000Z" ;;
    unsafe_hardlink) snap="$XD_CONFIG_DIR/backups/snapshots/xdrive-backup-20990101T005000Z" ;;
    duplicate_manifest) snap="$XD_CONFIG_DIR/backups/snapshots/xdrive-backup-20990101T006000Z" ;;
    invalid_pg_dump) snap="$XD_CONFIG_DIR/backups/snapshots/xdrive-backup-20990101T007000Z" ;;
  esac
  mkdir -p "$snap"
  printf 'PGDMPtest fixture\n' > "$snap/database.dump"
  printf 'verify receipt\n' > "$snap/verify.json"
  # Produce a real v1 tar, rather than arbitrary mock bytes, so the
  # pre-retention test exercises actual archive-header semantics.
  python3 - "$snap/blobs.tar" "${XD_SCHEDULE_MOCK_MODE:-good}" <<'PY'
import io,sys,tarfile
path,mode=sys.argv[1:3]
with tarfile.open(path,"w") as archive:
    item=tarfile.TarInfo("./ordinary.txt")
    item.size=4
    archive.addfile(item,io.BytesIO(b"data"))
    if mode=="traversal":
        item=tarfile.TarInfo("../escape")
        item.size=4
        archive.addfile(item,io.BytesIO(b"data"))
    elif mode=="symlink_member":
        item=tarfile.TarInfo("./unsafe-link")
        item.type=tarfile.SYMTYPE
        item.linkname="../../outside"
        archive.addfile(item)
    elif mode=="unsafe_hardlink":
        item=tarfile.TarInfo("./unsafe-hardlink")
        item.type=tarfile.LNKTYPE
        item.linkname="../outside"
        archive.addfile(item)
PY
  printf '{"format_version":1,"consistency_verified":true,"file_data_included":true}\n' > "$snap/manifest.json"
  (cd "$snap"; sha256sum database.dump verify.json manifest.json blobs.tar > SHA256SUMS.txt)
  case "${XD_SCHEDULE_MOCK_MODE:-good}" in
    tampered) printf 'tamper\n' >> "$snap/blobs.tar" ;;
    database_only) printf '{"format_version":1,"consistency_verified":true,"file_data_included":false}\n' > "$snap/manifest.json" ;;
    duplicate_manifest)
      printf '{"format_version":1,"consistency_verified":true,"file_data_included":true,"file_data_included":false}\n' > "$snap/manifest.json"
      (cd "$snap"; sha256sum database.dump verify.json manifest.json blobs.tar > SHA256SUMS.txt) ;;
    invalid_pg_dump)
      printf 'not a PostgreSQL archive\n' > "$snap/database.dump"
      (cd "$snap"; sha256sum database.dump verify.json manifest.json blobs.tar > SHA256SUMS.txt) ;;
  esac
  printf '%s\n' "$snap"
fi
MOCK
chmod 700 "$XD_CONFIG_DIR/bin/xdrive-server"

invoke() {
  : > "$XD_SCHEDULE_TEST_LOG"
  : > "$XD_SCHEDULE_DOCKER_CALLS"
  bash "$script"
}
expect_args() {
  local first="$1" second="$2"
  [[ "$(sed -n '1p' "$XD_SCHEDULE_TEST_LOG")" == "$first" ]]
  [[ "$(sed -n '2p' "$XD_SCHEDULE_TEST_LOG")" == "$second" ]]
}
old_v1="$XD_CONFIG_DIR/backups/snapshots/xdrive-backup-19990101T000000Z"
mkdir "$old_v1"
touch -d '20 days ago' "$old_v1"

# Existing installed configuration still creates v1 tar backups and prunes only
# the old v1 snapshots according to the existing retention setting.
printf 'XD_BACKUP_RETENTION_DAYS=7\n' > "$env_file"

# A scheduled lock must never truncate an unrelated file via a symlink, nor
# accept a directory in place of the lock inode. Reject before backup launch.
mkdir -p "$XD_CONFIG_DIR/state"
schedule_lock="$XD_CONFIG_DIR/state/scheduled-backup.lock"
lock_sentinel="$TMP/scheduled-lock-sentinel"
printf 'do not modify this sentinel\n' > "$lock_sentinel"
ln -s "$lock_sentinel" "$schedule_lock"
if invoke >"$TMP/unsafe-scheduled-lock.log" 2>&1; then
  echo 'scheduled backup followed a symlinked lock' >&2; exit 1
fi
grep -Fq 'unsafe scheduled-backup.lock' "$TMP/unsafe-scheduled-lock.log"
[[ ! -s "$XD_SCHEDULE_TEST_LOG" ]]
[[ "$(cat "$lock_sentinel")" == 'do not modify this sentinel' ]]
rm "$schedule_lock"
mkdir "$schedule_lock"
if invoke >"$TMP/directory-scheduled-lock.log" 2>&1; then
  echo 'scheduled backup accepted directory as lock' >&2; exit 1
fi
grep -Fq 'unsafe scheduled-backup.lock' "$TMP/directory-scheduled-lock.log"
[[ ! -s "$XD_SCHEDULE_TEST_LOG" ]]
rmdir "$schedule_lock"
# Existing lock bytes must not be truncated on normal reentry, either.
printf 'preserve existing lock bytes\n' > "$schedule_lock"
invoke
[[ "$(cat "$schedule_lock")" == 'preserve existing lock bytes' ]]
expect_args backup --output-dir
[[ -s "$XD_SCHEDULE_DOCKER_CALLS" ]] || {
  echo "valid v1 recovery point was not checked for PostgreSQL TOC readability" >&2; exit 1
}
[[ ! -d "$old_v1" ]]
[[ "$(sed -n '3p' "$XD_SCHEDULE_TEST_LOG")" == "$XD_CONFIG_DIR/backups/snapshots" ]]

# Backup command returning success with no committed snapshot must not erase
# a previous recovery point even if the retention age has elapsed.
old_failed="$XD_CONFIG_DIR/backups/snapshots/xdrive-backup-19980101T000000Z"
mkdir "$old_failed"
touch -d '20 days ago' "$old_failed"
for scenario in no_snapshot wrong_path old_path tampered database_only traversal symlink_member unsafe_hardlink duplicate_manifest invalid_pg_dump; do
  if XD_SCHEDULE_MOCK_MODE="$scenario" invoke >"$TMP/fail-$scenario.log" 2>&1; then
    echo "scheduled v1 retention accepted $scenario without a verified full snapshot" >&2; exit 1
  fi
  grep -Fq 'old recovery points preserved' "$TMP/fail-$scenario.log"
  if [[ "$scenario" == invalid_pg_dump ]]; then
    [[ -s "$XD_SCHEDULE_DOCKER_CALLS" ]] || {
      echo "invalid PostgreSQL dump was not inspected by the readonly preflight" >&2; exit 1
    }
  else
    [[ ! -s "$XD_SCHEDULE_DOCKER_CALLS" ]] || {
      echo "invalid pre-TOC snapshot reached Docker inspection" >&2; exit 1
    }
  fi
  [[ -d "$old_failed" ]] || { echo "old recovery point deleted during $scenario" >&2; exit 1; }
done
rmdir "$old_failed"

# Opt-in v2 uses the existing host command, not a second runner/queue; it must
# NOT delete even old v1 snapshots or v2 repo snapshots and shared objects.
mkdir "$old_v1"
touch -d '20 days ago' "$old_v1"
v2_snapshot="$XD_CONFIG_DIR/backups/incremental/snapshots/xdrive-backup-20000101T000000Z"
v2_object="$XD_CONFIG_DIR/backups/incremental/objects/sha256/ab/abc"
mkdir -p "$(dirname "$v2_snapshot")" "$(dirname "$v2_object")" "$v2_snapshot"
printf 'CAS original\n' > "$v2_object"
touch -d '20 days ago' "$v2_snapshot"
printf 'XD_BACKUP_RETENTION_DAYS=0oops\nXD_BACKUP_SCHEDULE_FORMAT=v2\n' > "$env_file"
invoke
expect_args backup --incremental
[[ "$(wc -l < "$XD_SCHEDULE_TEST_LOG")" -eq 2 ]]
[[ -d "$old_v1" && -d "$v2_snapshot" ]]
[[ "$(cat "$v2_object")" == 'CAS original' ]]
# Even with the v2 manual prune available, a scheduled v2 run must never
# create a deletion journal or invoke the explicit prune subcommand.
[[ ! -e "$XD_CONFIG_DIR/backups/incremental/.prune-retired" ]]
! grep -Fxq prune "$XD_SCHEDULE_TEST_LOG"

# A custom absolute repository is passed as one quoted argument even if it
# contains spaces. Verify the fallback script uses the same v2 implementation.
custom_repo="$TMP/other disk/incremental"
printf 'XD_BACKUP_SCHEDULE_FORMAT=v2\nXD_BACKUP_SCHEDULE_REPOSITORY_DIR=%s\n' "$custom_repo" > "$env_file"
invoke
expect_args backup --incremental
[[ "$(sed -n '3p' "$XD_SCHEDULE_TEST_LOG")" == --repository-dir ]]
[[ "$(sed -n '4p' "$XD_SCHEDULE_TEST_LOG")" == "$custom_repo" ]]
[[ "$(wc -l < "$XD_SCHEDULE_TEST_LOG")" -eq 4 ]]
mv "$XD_CONFIG_DIR/bin/xdrive-server" "$XD_CONFIG_DIR/bin/server-backup.sh"
invoke
[[ "$(sed -n '1p' "$XD_SCHEDULE_TEST_LOG")" == --config-dir ]]
[[ "$(sed -n '2p' "$XD_SCHEDULE_TEST_LOG")" == "$XD_CONFIG_DIR" ]]
[[ "$(sed -n '3p' "$XD_SCHEDULE_TEST_LOG")" == --incremental ]]
[[ "$(sed -n '4p' "$XD_SCHEDULE_TEST_LOG")" == --repository-dir ]]
[[ "$(sed -n '5p' "$XD_SCHEDULE_TEST_LOG")" == "$custom_repo" ]]

# The host backup list and default latest verify must also see a scheduled v2
# repository that is outside ~/.xd (including one with spaces in its path).
# Mock snapshot files are never restored or deleted; the intentionally empty
# SHA256SUMS must fail verification before any Docker operation.
custom_snapshot="$custom_repo/snapshots/xdrive-backup-20991231T235959Z"
mkdir -p "$custom_snapshot"
cat > "$custom_snapshot/manifest.json" <<'JSON'
{"format_version":2,"created_at_utc":"2099-12-31T23:59:59Z","file_data_included":true}
JSON
touch "$custom_snapshot/database.dump" "$custom_snapshot/verify.json" \
  "$custom_snapshot/SHA256SUMS.txt" "$custom_snapshot/objects.index" \
  "$custom_snapshot/legacy.tar"
manager="$ROOT/scripts/xdrive-server-host.sh"
custom_list="$(bash "$manager" backup list)"
grep -Fq "cas:$(basename "$custom_snapshot")" <<<"$custom_list"
grep -Fq 'cas:xdrive-backup-20000101T000000Z' <<<"$custom_list"
[[ "$(grep -Fc "$custom_snapshot" <<<"$custom_list")" -eq 1 ]]
# New shared-reader contract: mock schedules never created the writer's
# .backup.lock. Verify must reject this invalid v2 repository before checksum
# reads. After materializing a real lock, it must still reject bad checksums.
if bash "$manager" backup verify >"$TMP/missing-v2-lock-verify.log" 2>&1; then
  echo 'custom v2 fixture with missing repository lock unexpectedly verified' >&2; exit 1
fi
grep -Fq "missing or unsafe v2 repository lock: $custom_repo/.backup.lock" "$TMP/missing-v2-lock-verify.log"
: > "$custom_repo/.backup.lock"
if bash "$manager" backup verify >"$TMP/custom-latest-verify.log" 2>&1; then
  echo 'custom v2 fixture unexpectedly verified' >&2; exit 1
fi
grep -Fq "v2 checksum manifest mismatch: $custom_snapshot" "$TMP/custom-latest-verify.log"

# Pointing the schedule back at the default repo must not duplicate listings.
printf 'XD_BACKUP_SCHEDULE_FORMAT=v2\nXD_BACKUP_SCHEDULE_REPOSITORY_DIR=%s\n' \
  "$XD_CONFIG_DIR/backups/incremental" > "$env_file"
default_list="$(bash "$manager" backup list)"
[[ "$(grep -Fc "$v2_snapshot" <<<"$default_list")" -eq 1 ]]
if grep -Fq "$custom_snapshot" <<<"$default_list"; then
  echo 'inactive custom repository leaked into default listing' >&2; exit 1
fi

# Fail closed: invalid mode, v1 repository option and relative/symlink path
# must never invoke the existing backup runner.
cat > "$env_file" <<'EOF'
XD_BACKUP_SCHEDULE_FORMAT=v3
EOF
if invoke >"$TMP/invalid-format.log" 2>&1; then
  echo 'invalid backup mode was accepted' >&2; exit 1
fi
[[ ! -s "$XD_SCHEDULE_TEST_LOG" ]]
grep -Fq 'XD_BACKUP_SCHEDULE_FORMAT must be v1 or v2' "$TMP/invalid-format.log"

cat > "$env_file" <<'EOF'
XD_BACKUP_SCHEDULE_REPOSITORY_DIR=/tmp/ignore
EOF
if invoke >"$TMP/repo-v1.log" 2>&1; then
  echo 'v2 repository option was accepted for v1' >&2; exit 1
fi
[[ ! -s "$XD_SCHEDULE_TEST_LOG" ]]
grep -Fq 'requires v2' "$TMP/repo-v1.log"

cat > "$env_file" <<'EOF'
XD_BACKUP_SCHEDULE_FORMAT=v2
XD_BACKUP_SCHEDULE_REPOSITORY_DIR=relative/path
EOF
if invoke >"$TMP/relative.log" 2>&1; then
  echo 'relative repository path was accepted' >&2; exit 1
fi
[[ ! -s "$XD_SCHEDULE_TEST_LOG" ]]
grep -Fq 'absolute non-symlink path' "$TMP/relative.log"
if bash "$manager" backup list >"$TMP/relative-list.log" 2>&1; then
  echo 'backup list accepted relative custom repository' >&2; exit 1
fi
grep -Fq 'absolute non-symlink path' "$TMP/relative-list.log"

ln -s "$XD_CONFIG_DIR/backups" "$TMP/repo-link"
printf 'XD_BACKUP_SCHEDULE_FORMAT=v2\nXD_BACKUP_SCHEDULE_REPOSITORY_DIR=%s\n' "$TMP/repo-link" > "$env_file"
if invoke >"$TMP/symlink.log" 2>&1; then
  echo 'symlink repository path was accepted' >&2; exit 1
fi
[[ ! -s "$XD_SCHEDULE_TEST_LOG" ]]
if bash "$manager" backup list >"$TMP/symlink-list.log" 2>&1; then
  echo 'backup list accepted symlinked custom repository' >&2; exit 1
fi
grep -Fq 'absolute non-symlink path' "$TMP/symlink-list.log"

bash -n "$ROOT/scripts/test-server-backup-data-source-preflight.sh"
bash "$ROOT/scripts/test-server-backup-data-source-preflight.sh"

echo 'scheduled backup v1/v2 opt-in, no-v2-prune and custom repository discovery tests passed'
