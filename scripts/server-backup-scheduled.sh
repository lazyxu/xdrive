#!/usr/bin/env bash
set -euo pipefail
umask 077

XDRIVE_HOME="${XD_CONFIG_DIR:-$HOME/.xd}"
CONFIG_DIR="$XDRIVE_HOME/config"
BIN_DIR="$XDRIVE_HOME/bin"
BACKUP_DIR="$XDRIVE_HOME/backups/snapshots"
LOG_DIR="$XDRIVE_HOME/logs"
STATE_DIR="$XDRIVE_HOME/state"
ENV_PATH="$CONFIG_DIR/.env"
[[ -f "$ENV_PATH" ]] || { echo "missing $ENV_PATH" >&2; exit 1; }
# Version 1 tar backups remain the scheduled default. Version 2 is
# explicitly opted in through config/.env and never uses tar retention.
schedule_format="$(grep '^XD_BACKUP_SCHEDULE_FORMAT=' "$ENV_PATH" | tail -n1 | cut -d= -f2- || true)"
schedule_format="${schedule_format:-v1}"
case "$schedule_format" in
  v1|v2) ;;
  *) echo "XD_BACKUP_SCHEDULE_FORMAT must be v1 or v2" >&2; exit 2 ;;
esac
repository_dir="$(grep '^XD_BACKUP_SCHEDULE_REPOSITORY_DIR=' "$ENV_PATH" | tail -n1 | cut -d= -f2- || true)"
if [[ -n "$repository_dir" ]]; then
  [[ "$schedule_format" == "v2" ]] || {
    echo "XD_BACKUP_SCHEDULE_REPOSITORY_DIR requires v2" >&2
    exit 2
  }
  [[ "$repository_dir" == /* && ! -L "$repository_dir" ]] || {
    echo "XD_BACKUP_SCHEDULE_REPOSITORY_DIR must be an absolute non-symlink path" >&2
    exit 2
  }
fi
mkdir -p "$STATE_DIR" "$BACKUP_DIR" "$LOG_DIR"

lock_dir=""
if command -v flock >/dev/null 2>&1; then
  # Opening with '>' would truncate the target of an unexpected symlink
  # before flock can protect anything. Never follow a suspicious lock path.
  scheduled_lock="$STATE_DIR/scheduled-backup.lock"
  if [[ -L "$scheduled_lock" || ( -e "$scheduled_lock" && ! -f "$scheduled_lock" ) ]]; then
    echo "scheduled backup refused: unsafe scheduled-backup.lock" >&2
    exit 1
  fi
  exec 9>>"$scheduled_lock"
  if ! flock -n 9; then
    echo "scheduled backup skipped: another backup is already running"
    exit 0
  fi
else
  lock_dir="$STATE_DIR/scheduled-backup.lock.d"
  if ! mkdir "$lock_dir" 2>/dev/null; then
    echo "scheduled backup skipped: another backup is already running"
    exit 0
  fi
  trap 'rmdir "$lock_dir" 2>/dev/null || true' EXIT INT TERM
fi
# A successful process exit alone is not enough to authorize deletion of
# old recovery points. The writer publishes a final directory only after
# checksumming its files. Independently verify that precise committed v1
# generation before applying the legacy time-based retention rule.
verify_scheduled_v1_recovery_point() {
  local snapshot="$1" baseline="$2" name required
  # An existing verified generation is not proof of a newly created backup.
  [[ -f "$baseline" ]] || return 1
  ! grep -Fxq -- "$snapshot" "$baseline" || return 1
  [[ "$snapshot" == "$BACKUP_DIR"/xdrive-backup-* ]] || return 1
  name="${snapshot#"$BACKUP_DIR"/}"
  [[ "$name" =~ ^xdrive-backup-[0-9]{8}T[0-9]{6}Z$ ]] || return 1
  [[ -d "$snapshot" && ! -L "$snapshot" ]] || return 1
  for required in database.dump verify.json manifest.json blobs.tar SHA256SUMS.txt; do
    [[ -f "$snapshot/$required" && ! -L "$snapshot/$required" ]] || return 1
  done
  grep -Eq '"format_version"[[:space:]]*:[[:space:]]*1([,}[:space:]])' "$snapshot/manifest.json" || return 1
  grep -Eq '"consistency_verified"[[:space:]]*:[[:space:]]*true([,}[:space:]])' "$snapshot/manifest.json" || return 1
  grep -Eq '"file_data_included"[[:space:]]*:[[:space:]]*true([,}[:space:]])' "$snapshot/manifest.json" || return 1
  # Require the exact expected file list, not merely sha256sum -c: the latter
  # also accepts incomplete manifests and checks only named members.
  (
    cd "$snapshot" || exit 1
    cmp -s SHA256SUMS.txt <(sha256sum database.dump verify.json manifest.json blobs.tar)
  )
}

if [[ "$schedule_format" == "v2" ]]; then
  # Manual reference-aware GC exists as a separate administrator command.
  # Scheduled v2 backup must NEVER invoke it: no snapshot pruning or CAS
  # deletion is automatic, including when XD_BACKUP_RETENTION_DAYS is set.
  repo_args=()
  [[ -z "$repository_dir" ]] || repo_args=(--repository-dir "$repository_dir")
  if [[ -x "$BIN_DIR/xdrive-server" ]]; then
    XD_CONFIG_DIR="$XDRIVE_HOME" "$BIN_DIR/xdrive-server" backup --incremental "${repo_args[@]}"
  else
    "$BIN_DIR/server-backup.sh" --config-dir "$XDRIVE_HOME" --incremental "${repo_args[@]}"
  fi
else
  retention_days="$(grep '^XD_BACKUP_RETENTION_DAYS=' "$ENV_PATH" | tail -n1 | cut -d= -f2- || true)"
  retention_days="${retention_days:-7}"
  [[ "$retention_days" =~ ^[0-9]+$ ]] || { echo "XD_BACKUP_RETENTION_DAYS must be an integer" >&2; exit 1; }

  backup_dir="$BACKUP_DIR"
  # Capture the writer's final, explicitly committed path without parsing
  # progress text or guessing that a backup appeared by directory mtime.
  receipt_file="$(mktemp "$STATE_DIR/.scheduled-v1-receipt.XXXXXXXX")"
  baseline_file="$(mktemp "$STATE_DIR/.scheduled-v1-before.XXXXXXXX")"
  trap 'rm -f -- "$receipt_file" "$baseline_file"; if [[ -n "${lock_dir:-}" ]]; then rmdir "$lock_dir" 2>/dev/null || true; fi' EXIT
  # Snapshot the trusted generation names before calling the writer. An old
  # path echoed by a wrongly successful command cannot authorize retention.
  find "$backup_dir" -mindepth 1 -maxdepth 1 -type d -name 'xdrive-backup-*' -print > "$baseline_file"
  if [[ -x "$BIN_DIR/xdrive-server" ]]; then
    XD_CONFIG_DIR="$XDRIVE_HOME" "$BIN_DIR/xdrive-server" backup --output-dir "$backup_dir" | tee "$receipt_file"
  else
    "$BIN_DIR/server-backup.sh" --config-dir "$XDRIVE_HOME" --output-dir "$backup_dir" | tee "$receipt_file"
  fi

  if (( retention_days > 0 )); then
    new_snapshot="$(tail -n 1 "$receipt_file")"
    if ! verify_scheduled_v1_recovery_point "$new_snapshot" "$baseline_file"; then
      echo "scheduled v1 retention refused: newly committed full backup is missing, unsafe or not checksum-verified; old recovery points preserved" >&2
      exit 1
    fi
    # Only the v1 snapshot root is touched. v2 shared CAS and orphan objects
    # are never candidates for this legacy retention operation.
    find "$backup_dir" -mindepth 1 -maxdepth 1 -type d -name 'xdrive-backup-*' -mtime "+$retention_days" -print -exec rm -rf -- {} +
  fi
fi
