#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export XD_CONFIG_DIR="$TMP/home"
export BACKUP_PLAN_TEST_LOG="$TMP/docker-args"
mkdir -p "$TMP/bin" "$XD_CONFIG_DIR/config" "$XD_CONFIG_DIR/backups/incremental/snapshots"
cat > "$XD_CONFIG_DIR/config/.env" <<'ENV'
XD_SERVER_IMAGE=xdrive/server:backup-plan-test
ENV
cat > "$TMP/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == run ]] || { echo "unexpected Docker operation" >&2; exit 17; }
printf '%s\n' "$@" > "$BACKUP_PLAN_TEST_LOG"
if printf '%s\n' "$@" | grep -Fxq prune; then
  printf '{"mode":"manual_confirmed","automatic":false}\n'
elif printf '%s\n' "$@" | grep -Fxq delete-snapshot; then
  printf '{"mode":"manual_selected","automatic":false}\n'
else
  printf '{"mode":"read_only","delete_enabled":false}\n'
fi
DOCKER
chmod +x "$TMP/bin/docker"
host="$ROOT/scripts/xdrive-server-host.sh"
default_repo="$XD_CONFIG_DIR/backups/incremental"
custom_repo="$TMP/external backups/with spaces"
mkdir -p "$custom_repo/snapshots"
printf 'immutable object fixture\n' > "$default_repo/snapshots/preserve"
printf 'also preserve\n' > "$custom_repo/snapshots/preserve"

run_plan() {
  : > "$BACKUP_PLAN_TEST_LOG"
  PATH="$TMP/bin:$PATH" bash "$host" backup retention-plan "$@" > "$TMP/out"
  grep -Fq '"mode":"read_only"' "$TMP/out"
  grep -Fq '"delete_enabled":false' "$TMP/out"
}
assert_readonly_mount() {
  local directory="$1"
  grep -Fxq "type=bind,src=$directory,dst=/repo,readonly" "$BACKUP_PLAN_TEST_LOG"
  grep -Fxq /usr/local/bin/xdrive-backup-repo "$BACKUP_PLAN_TEST_LOG"
  grep -Fxq retention-plan "$BACKUP_PLAN_TEST_LOG"
  grep -Fxq -- --repo "$BACKUP_PLAN_TEST_LOG"
  grep -Fxq /repo "$BACKUP_PLAN_TEST_LOG"
  if grep -Exq '(--privileged|--volume|-v|--delete|--prune)' "$BACKUP_PLAN_TEST_LOG"; then
    echo "unexpected mutating Docker argument" >&2
    exit 1
  fi
}
run_plan
assert_readonly_mount "$default_repo"
grep -Fxq 7 "$BACKUP_PLAN_TEST_LOG"
grep -Fxq fast "$BACKUP_PLAN_TEST_LOG"
run_plan --keep-last 2
assert_readonly_mount "$default_repo"
grep -Fxq 2 "$BACKUP_PLAN_TEST_LOG"

printf 'XD_SERVER_IMAGE=xdrive/server:backup-plan-test\nXD_BACKUP_SCHEDULE_FORMAT=v2\nXD_BACKUP_SCHEDULE_REPOSITORY_DIR=%s\n' "$custom_repo" > "$XD_CONFIG_DIR/config/.env"
run_plan --keep-last 3
assert_readonly_mount "$custom_repo"
grep -Fxq 3 "$BACKUP_PLAN_TEST_LOG"

# Explicit full-content audit only: hold the pre-existing writer's lock
# during the read-only Docker invocation. A competing exclusive lease blocks
# it before Docker starts, without affecting the default fast preview.
: > "$custom_repo/.backup.lock"
run_plan --keep-last 3 --mode deep
assert_readonly_mount "$custom_repo"
grep -Fxq deep "$BACKUP_PLAN_TEST_LOG"
exec 8<"$custom_repo/.backup.lock"
flock -x -n 8
: > "$BACKUP_PLAN_TEST_LOG"
if PATH="$TMP/bin:$PATH" bash "$host" backup retention-plan --mode deep >"$TMP/busy.out" 2>"$TMP/busy.err"; then
  echo 'deep audit ignored exclusive repository lock' >&2; exit 1
fi
grep -Fq 'v2 repository is busy' "$TMP/busy.err"
[[ ! -s "$BACKUP_PLAN_TEST_LOG" ]]
flock -u 8
exec 8<&-

run_plan --repository-dir "$default_repo" --keep-last 5
assert_readonly_mount "$default_repo"
grep -Fxq 5 "$BACKUP_PLAN_TEST_LOG"

reject() {
  : > "$BACKUP_PLAN_TEST_LOG"
  if PATH="$TMP/bin:$PATH" bash "$host" backup retention-plan "$@" >"$TMP/rejected.out" 2>"$TMP/rejected.err"; then
    echo "unsafe retention-plan argument accepted: $*" >&2
    exit 1
  fi
  [[ ! -s "$BACKUP_PLAN_TEST_LOG" ]] || { echo "invalid request reached Docker" >&2; exit 1; }
}
reject --keep-last 0
reject --keep-last invalid
reject --mode invalid
reject --mode
reject --repository-dir relative/path
reject --repository-dir "$TMP/nonexistent"
reject --delete
reject --prune
ln -s "$custom_repo" "$TMP/symlink-repo"
reject --repository-dir "$TMP/symlink-repo"

[[ "$(cat "$default_repo/snapshots/preserve")" == 'immutable object fixture' ]]
[[ "$(cat "$custom_repo/snapshots/preserve")" == 'also preserve' ]]
[[ ! -e "$default_repo/.backup.lock" && -f "$custom_repo/.backup.lock" ]]

# Explicitly destructive prune must use one writable repository mount with
# no network, while the preview above keeps its read-only mount unchanged.
prune_log="$TMP/prune.out"
run_prune() {
  : > "$BACKUP_PLAN_TEST_LOG"
  PATH="$TMP/bin:$PATH" bash "$host" backup prune "$@" > "$prune_log"
  grep -Fq '"mode":"manual_confirmed"' "$prune_log"
}
run_prune --keep-last 2 --yes
grep -Fxq prune "$BACKUP_PLAN_TEST_LOG"
grep -Fxq 2 "$BACKUP_PLAN_TEST_LOG"
grep -Fxq -- --yes "$BACKUP_PLAN_TEST_LOG"
grep -Fxq -- --network "$BACKUP_PLAN_TEST_LOG"
grep -Fxq none "$BACKUP_PLAN_TEST_LOG"
grep -Fxq "type=bind,src=$custom_repo,dst=/repo" "$BACKUP_PLAN_TEST_LOG"
if grep -Fqx "type=bind,src=$custom_repo,dst=/repo,readonly" "$BACKUP_PLAN_TEST_LOG"; then
  echo 'prune used read-only mount' >&2
  exit 1
fi
reject_prune() {
  : > "$BACKUP_PLAN_TEST_LOG"
  if PATH="$TMP/bin:$PATH" bash "$host" backup prune "$@" >"$TMP/prune-rejected.out" 2>"$TMP/prune-rejected.err"; then
    echo "invalid prune request unexpectedly succeeded: $*" >&2
    exit 1
  fi
  [[ ! -s "$BACKUP_PLAN_TEST_LOG" ]] || { echo "invalid prune request reached Docker" >&2; exit 1; }
}
reject_prune --keep-last 2
reject_prune --yes
reject_prune --yes --keep-last 0
reject_prune --yes --keep-last invalid
reject_prune --yes --keep-last 2 --mode fast
reject_prune --yes --keep-last 2 --delete
reject_prune --yes --keep-last 2 --repository-dir relative/path
reject_prune --yes --keep-last 2 --repository-dir "$TMP/nonexistent"
reject_prune --yes --keep-last 2 --repository-dir "$TMP/symlink-repo"

# A named v2 generation uses the SAME locked/no-network, writable repository
# mount and never turns a selected snapshot into a keep-last count.
selected="xdrive-backup-20261025T010000Z"
mkdir -p "$custom_repo/snapshots/$selected"
printf 'do not touch' > "$custom_repo/snapshots/$selected/preserve"
: > "$BACKUP_PLAN_TEST_LOG"
PATH="$TMP/bin:$PATH" bash "$host" backup delete-snapshot \
  --snapshot "$selected" --yes --repository-dir "$custom_repo" > "$TMP/select.out"
grep -Fq '"mode":"manual_selected"' "$TMP/select.out"
grep -Fxq delete-snapshot "$BACKUP_PLAN_TEST_LOG"
grep -Fxq "$selected" "$BACKUP_PLAN_TEST_LOG"
grep -Fxq -- --snapshot "$BACKUP_PLAN_TEST_LOG"
grep -Fxq -- --yes "$BACKUP_PLAN_TEST_LOG"
grep -Fxq -- --network "$BACKUP_PLAN_TEST_LOG"
grep -Fxq none "$BACKUP_PLAN_TEST_LOG"
grep -Fxq "type=bind,src=$custom_repo,dst=/repo" "$BACKUP_PLAN_TEST_LOG"
if grep -Fxq prune "$BACKUP_PLAN_TEST_LOG" || \
   grep -Fxq -- --keep-last "$BACKUP_PLAN_TEST_LOG" || \
   grep -Fxq -- --privileged "$BACKUP_PLAN_TEST_LOG" || \
   grep -Fxq "type=bind,src=$custom_repo,dst=/repo,readonly" "$BACKUP_PLAN_TEST_LOG"; then
  echo 'selected v2 deletion escaped its fixed Docker operation' >&2
  exit 1
fi

reject_selected() {
  : > "$BACKUP_PLAN_TEST_LOG"
  if PATH="$TMP/bin:$PATH" bash "$host" backup delete-snapshot "$@" >"$TMP/select-rejected.out" 2>"$TMP/select-rejected.err"; then
    echo "unsafe selected v2 delete argument accepted: $*" >&2
    exit 1
  fi
  [[ ! -s "$BACKUP_PLAN_TEST_LOG" ]] || {
    echo "invalid selected v2 deletion reached Docker" >&2
    exit 1
  }
}
reject_selected --snapshot "$selected"
reject_selected --yes
reject_selected --snapshot "$selected" --keep-last 1 --yes
reject_selected --snapshot "$selected" --mode fast --yes
reject_selected --snapshot "$selected" --yes --delete
reject_selected --snapshot xdrive-backup-20261025T010000Z.partial --yes
reject_selected --snapshot xdrive-backup-20261025T010000Z/../secret --yes
reject_selected --snapshot '../../etc/shadow' --yes
reject_selected --snapshot 'xdrive-backup-20261025T010000Z;rm' --yes
reject_selected --snapshot xdrive-backup-20261026T010000Z --yes
reject_selected --snapshot "$selected" --yes --repository-dir "$TMP/symlink-repo"
reject_selected --snapshot "$selected" --yes --repository-dir "$TMP/does-not-exist"
reject_selected --snapshot "$selected" --yes --repository-dir relative
ln -s "$custom_repo/snapshots/$selected" "$custom_repo/snapshots/xdrive-backup-20261024T000000Z"
reject_selected --snapshot xdrive-backup-20261024T000000Z --yes
[[ "$(cat "$custom_repo/snapshots/$selected/preserve")" == 'do not touch' ]]

# The manual DELETE path must refuse any repository that overlaps live
# files, including both a backup nested under the default live location
# and live data nested under the backup repository itself.
live_root="$XD_CONFIG_DIR/data/files"
mkdir -p "$live_root"
nested_backup="$live_root/cas-repo"
mkdir -p "$nested_backup/snapshots/$selected"
: > "$nested_backup/.backup.lock"
reject_prune --yes --keep-last 2 --repository-dir "$nested_backup"
reject_selected --snapshot "$selected" --yes --repository-dir "$nested_backup"
grep -Fq 'repository overlaps live file storage' "$TMP/select-rejected.err"
grep -Fq 'repository overlaps live file storage' "$TMP/prune-rejected.err"
cp "$XD_CONFIG_DIR/config/.env" "$TMP/prune-overlap-env"
mkdir -p "$custom_repo/live-files"
printf 'XD_SERVER_IMAGE=xdrive/server:backup-plan-test\nXD_BACKUP_SCHEDULE_FORMAT=v2\nXD_BACKUP_SCHEDULE_REPOSITORY_DIR=%s\nXD_FILES_DATA_DIR=%s\n' "$custom_repo" "$custom_repo/live-files" > "$XD_CONFIG_DIR/config/.env"
reject_prune --yes --keep-last 2
grep -Fq 'repository overlaps live file storage' "$TMP/prune-rejected.err"
reject_selected --snapshot "$selected" --yes
grep -Fq 'repository overlaps live file storage' "$TMP/select-rejected.err"
printf 'XD_SERVER_IMAGE=xdrive/server:backup-plan-test\nXD_BACKUP_SCHEDULE_FORMAT=v2\nXD_BACKUP_SCHEDULE_REPOSITORY_DIR=%s\nXD_FILES_DATA_DIR=/\n' "$custom_repo" > "$XD_CONFIG_DIR/config/.env"
reject_prune --yes --keep-last 2
grep -Fq 'repository overlaps live file storage' "$TMP/prune-rejected.err"
reject_selected --snapshot "$selected" --yes
grep -Fq 'repository overlaps live file storage' "$TMP/select-rejected.err"
cp "$TMP/prune-overlap-env" "$XD_CONFIG_DIR/config/.env"

mv "$custom_repo/.backup.lock" "$TMP/saved-repository-lock"
reject_prune --yes --keep-last 2
reject_selected --snapshot "$selected" --yes
mv "$TMP/saved-repository-lock" "$custom_repo/.backup.lock"
[[ "$(cat "$default_repo/snapshots/preserve")" == 'immutable object fixture' ]]
[[ "$(cat "$custom_repo/snapshots/preserve")" == 'also preserve' ]]

echo "retention-plan host read-only, manual-prune and selected-delete isolation tests passed"
