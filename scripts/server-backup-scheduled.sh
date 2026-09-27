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
mkdir -p "$STATE_DIR" "$BACKUP_DIR" "$LOG_DIR"

lock_dir=""
if command -v flock >/dev/null 2>&1; then
  exec 9>"$STATE_DIR/scheduled-backup.lock"
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
retention_days="$(grep '^XD_BACKUP_RETENTION_DAYS=' "$ENV_PATH" | tail -n1 | cut -d= -f2- || true)"
retention_days="${retention_days:-7}"
[[ "$retention_days" =~ ^[0-9]+$ ]] || { echo "XD_BACKUP_RETENTION_DAYS must be an integer" >&2; exit 1; }

backup_dir="$BACKUP_DIR"
if [[ -x "$BIN_DIR/xdrive-server" ]]; then
  XD_CONFIG_DIR="$XDRIVE_HOME" "$BIN_DIR/xdrive-server" backup --output-dir "$backup_dir"
else
  "$BIN_DIR/server-backup.sh" --config-dir "$XDRIVE_HOME" --output-dir "$backup_dir"
fi

if (( retention_days > 0 )); then
  find "$backup_dir" -mindepth 1 -maxdepth 1 -type d -name 'xdrive-backup-*' -mtime "+$retention_days" -print -exec rm -rf -- {} +
fi
