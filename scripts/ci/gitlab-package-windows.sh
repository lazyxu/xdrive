#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
source scripts/ci/gitlab-release-version.sh
bash scripts/ci/check-go-min-version.sh 1.25

for cmd in node npm powershell.exe; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "required Windows release command is missing from PATH: $cmd" >&2
    exit 1
  }
done

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$node_major" != "22" ]]; then
  echo "Node.js 22 is required; found $(node --version)." >&2
  exit 1
fi

if command -v choco >/dev/null 2>&1; then
  choco_cmd="choco"
elif command -v choco.exe >/dev/null 2>&1; then
  choco_cmd="choco.exe"
else
  echo "Chocolatey is required for the Windows GitLab release runner." >&2
  exit 1
fi
"$choco_cmd" install innosetup --no-progress -y

rm -rf release .gitlab-release-tmp
mkdir -p release .gitlab-release-tmp
trap 'rm -rf .gitlab-release-tmp' EXIT INT TERM

signing_enabled=0
if [[ -n "${XD_WINDOWS_SIGN_PFX_B64:-}" ]]; then
  [[ -n "${XD_WINDOWS_SIGN_PFX_PASSWORD:-}" ]] || {
    echo "XD_WINDOWS_SIGN_PFX_PASSWORD is required when XD_WINDOWS_SIGN_PFX_B64 is set." >&2
    exit 1
  }
  pfx_posix="$ROOT/.gitlab-release-tmp/xdrive-codesign.pfx"
  if command -v cygpath >/dev/null 2>&1; then
    pfx_native="$(cygpath -w "$pfx_posix")"
  else
    pfx_native="$pfx_posix"
  fi
  powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass \
    -File scripts/ci/gitlab-package-windows-native.ps1 \
    -Action DecodeSigningCertificate \
    -PfxPath "$pfx_native"
  export XD_WINDOWS_SIGN_PFX_PATH="$pfx_native"
  export CSC_LINK="$pfx_native"
  export CSC_KEY_PASSWORD="$XD_WINDOWS_SIGN_PFX_PASSWORD"
  signing_enabled=1
elif [[ -n "${CI_COMMIT_TAG:-}" ]]; then
  echo "Stable Windows releases require XD_WINDOWS_SIGN_PFX_B64 and XD_WINDOWS_SIGN_PFX_PASSWORD." >&2
  exit 1
fi

pushd desktop >/dev/null
npm install --no-audit --no-fund
node scripts/set-version.mjs "$XDRIVE_DESKTOP_VERSION"
npm run dist:win
popd >/dev/null

test -f desktop/release/xDriveDesktopSetup-amd64.exe
cp desktop/release/xDriveDesktopSetup-amd64.exe release/xDriveDesktopSetup-amd64.exe

powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass \
  -File scripts/build-windows-installer.ps1 \
  -Version "$XDRIVE_RELEASE_VERSION" \
  -OutputDir release \
  -DesktopSourceDir desktop/release/win-unpacked

test -f release/xDriveSetup-amd64.exe

if [[ "$signing_enabled" == "1" ]]; then
  powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass \
    -File scripts/ci/gitlab-package-windows-native.ps1 \
    -Action VerifyReleaseSignatures
fi

echo "Built GitLab Windows release assets for $XDRIVE_RELEASE_TAG"
