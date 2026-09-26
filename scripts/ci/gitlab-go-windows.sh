#!/usr/bin/env bash
set -euo pipefail

for cmd in go node npm git powershell.exe; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "required Windows CI command is missing from PATH: $cmd" >&2
    exit 1
  fi
done
if command -v choco >/dev/null 2>&1; then
  choco_cmd="choco"
elif command -v choco.exe >/dev/null 2>&1; then
  choco_cmd="choco.exe"
else
  echo "Chocolatey is required for the Windows GitLab runner." >&2
  exit 1
fi

bash scripts/ci/check-go-min-version.sh 1.25
echo "GOPROXY=$(go env GOPROXY)"
echo "GOSUMDB=$(go env GOSUMDB)"
node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$node_major" != "22" ]]; then
  echo "Node.js 22 is required; found $(node --version)." >&2
  exit 1
fi

source scripts/ci/client-artifact-version.sh

test -f desktop/release/win-unpacked/xdrive-desktop.exe || {
  echo "Windows desktop runtime artifact is missing." >&2
  exit 1
}

# The self-hosted Windows runner may use Go newer than the module baseline.
bash scripts/ci/prepare-go-mod-cache.sh
git diff --exit-code -- go.mod go.sum
go test -mod=readonly ./internal/... ./cmd/xdrive-agent
go test -mod=readonly -tags=xdrive_e2e ./internal/mount -run ^TestWindowsCfAPI -v -count=1

powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/ci/gitlab-windows-native.ps1 -Action ValidateScripts
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/ci/test-windows-uninstaller-resolver.ps1

"$choco_cmd" install innosetup --no-progress -y

ci_tmp="$PWD/.gitlab-ci-tmp"
rm -rf "$ci_tmp"
mkdir -p "$ci_tmp"
trap 'rm -rf "$ci_tmp"' EXIT INT TERM

signing_enabled=0
if [[ -n "${XD_WINDOWS_SIGN_PFX_B64:-}" ]]; then
  [[ -n "${XD_WINDOWS_SIGN_PFX_PASSWORD:-}" ]] || {
    echo "XD_WINDOWS_SIGN_PFX_PASSWORD is required when XD_WINDOWS_SIGN_PFX_B64 is set." >&2
    exit 1
  }
  pfx_posix="$ci_tmp/xdrive-unified-signing.pfx"
  if command -v cygpath >/dev/null 2>&1; then
    pfx_native="$(cygpath -w "$pfx_posix")"
  else
    pfx_native="$pfx_posix"
  fi
  powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass     -File scripts/ci/gitlab-package-windows-native.ps1     -Action DecodeSigningCertificate     -PfxPath "$pfx_native"
  export XD_WINDOWS_SIGN_PFX_PATH="$pfx_native"
  export XD_WINDOWS_SIGN_PFX_PASSWORD
  signing_enabled=1
elif [[ -n "${CI_COMMIT_TAG:-}" ]]; then
  echo "Stable Windows releases require XD_WINDOWS_SIGN_PFX_B64 and XD_WINDOWS_SIGN_PFX_PASSWORD." >&2
  exit 1
elif [[ "${CI_PIPELINE_SOURCE:-}" == "merge_request_event" ]]; then
  pfx_posix="$ci_tmp/xdrive-unified-ci-signing.pfx"
  if command -v cygpath >/dev/null 2>&1; then
    pfx_native="$(cygpath -w "$pfx_posix")"
  else
    pfx_native="$pfx_posix"
  fi
  password="xdrive-ci-signing"
  powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass     -File scripts/ci/gitlab-windows-native.ps1     -Action PrepareSigning     -PfxPath "$pfx_native"     -Password "$password"
  export XD_WINDOWS_SIGN_PFX_PATH="$pfx_native"
  export XD_WINDOWS_SIGN_PFX_PASSWORD="$password"
  signing_enabled=1
fi

rm -rf release
mkdir -p release

powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass   -File scripts/ci/gitlab-windows-native.ps1   -Action BuildInstaller   -Version "$XDRIVE_RELEASE_VERSION"

if [[ "$signing_enabled" == "1" ]]; then
  powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass     -File scripts/ci/gitlab-windows-native.ps1     -Action VerifySignatures     -Version "$XDRIVE_RELEASE_VERSION"
fi

powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass   -File scripts/test-windows-client-upgrade.ps1   -Installer ./release/xDriveSetup-amd64.exe   -TargetVersion "$XDRIVE_RELEASE_VERSION"

powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass   -File scripts/ci/gitlab-windows-native.ps1   -Action SmokeInstall   -Version "$XDRIVE_RELEASE_VERSION"
