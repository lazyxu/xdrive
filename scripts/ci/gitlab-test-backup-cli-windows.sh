#!/usr/bin/env bash
set -euo pipefail

command -v powershell.exe >/dev/null 2>&1 || {
  echo "Windows CLI-only artifact smoke requires powershell.exe" >&2
  exit 1
}
source scripts/ci/client-artifact-version.sh
test -s release/backup-cli/xdrive-backup-windows-amd64.zip
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass \
  -File scripts/ci/test-backup-cli-windows.ps1 \
  -Archive release/backup-cli/xdrive-backup-windows-amd64.zip \
  -ExpectedVersion "$XDRIVE_RELEASE_VERSION"
