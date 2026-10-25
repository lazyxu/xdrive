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
printf '{"mode":"read_only","delete_enabled":false}\n'
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
run_plan --keep-last 2
assert_readonly_mount "$default_repo"
grep -Fxq 2 "$BACKUP_PLAN_TEST_LOG"

printf 'XD_SERVER_IMAGE=xdrive/server:backup-plan-test\nXD_BACKUP_SCHEDULE_FORMAT=v2\nXD_BACKUP_SCHEDULE_REPOSITORY_DIR=%s\n' "$custom_repo" > "$XD_CONFIG_DIR/config/.env"
run_plan --keep-last 3
assert_readonly_mount "$custom_repo"
grep -Fxq 3 "$BACKUP_PLAN_TEST_LOG"

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
reject --repository-dir relative/path
reject --repository-dir "$TMP/nonexistent"
reject --delete
reject --prune
ln -s "$custom_repo" "$TMP/symlink-repo"
reject --repository-dir "$TMP/symlink-repo"

[[ "$(cat "$default_repo/snapshots/preserve")" == 'immutable object fixture' ]]
[[ "$(cat "$custom_repo/snapshots/preserve")" == 'also preserve' ]]
[[ ! -e "$default_repo/.backup.lock" && ! -e "$custom_repo/.backup.lock" ]]
echo "retention-plan host read-only Docker mount and safety tests passed"
