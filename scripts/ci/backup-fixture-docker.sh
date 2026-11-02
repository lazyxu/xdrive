#!/usr/bin/env bash
set -euo pipefail

# Installed only in the disposable drill runner. Label transient sibling
# helpers as well as Compose services so interruption cannot strand them.
case "${1:-}" in
  run|create)
    verb="$1"; shift
    exec /usr/local/bin/docker "$verb" \
      --label "org.xdrive.ci.backup-workspace=${XD_BACKUP_WORKSPACE_TOKEN:?}" "$@"
    ;;
  *) exec /usr/local/bin/docker "$@" ;;
esac
