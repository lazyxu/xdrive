#!/usr/bin/env bash
set -euo pipefail

command -v powershell.exe >/dev/null 2>&1 || {
  echo "required Windows artifact-test command is missing from PATH: powershell.exe" >&2
  exit 1
}

source scripts/ci/client-artifact-version.sh
scenario="${XDRIVE_WINDOWS_TRANSACTION_SCENARIO:-upgrade}"

if [[ "${CI_PIPELINE_SOURCE:-}" == "merge_request_event" || -n "${XD_WINDOWS_SIGN_PFX_B64:-}" ]]; then
  powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass \
    -File scripts/ci/test-windows-client-package.ps1 \
    -Installer ./release/xDriveSetup-amd64.exe \
    -TargetVersion "$XDRIVE_RELEASE_VERSION" \
    -Scenario "$scenario" \
    -ExpectSigned
else
  powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass \
    -File scripts/ci/test-windows-client-package.ps1 \
    -Installer ./release/xDriveSetup-amd64.exe \
    -TargetVersion "$XDRIVE_RELEASE_VERSION" \
    -Scenario "$scenario"
fi
