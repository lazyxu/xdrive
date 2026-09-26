#!/usr/bin/env bash
set -euo pipefail

for cmd in node npm powershell.exe; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "required Windows desktop CI command is missing from PATH: $cmd" >&2
    exit 1
  }
done

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$node_major" != "22" ]]; then
  echo "Node.js 22 is required; found $(node --version)." >&2
  exit 1
fi

source scripts/ci/client-artifact-version.sh

ci_tmp="$PWD/.gitlab-desktop-ci-tmp"
rm -rf "$ci_tmp"
mkdir -p "$ci_tmp"
trap 'rm -rf "$ci_tmp"' EXIT INT TERM

if [[ -n "${XD_WINDOWS_SIGN_PFX_B64:-}" ]]; then
  [[ -n "${XD_WINDOWS_SIGN_PFX_PASSWORD:-}" ]] || {
    echo "XD_WINDOWS_SIGN_PFX_PASSWORD is required when XD_WINDOWS_SIGN_PFX_B64 is set." >&2
    exit 1
  }
  pfx_posix="$ci_tmp/xdrive-desktop-signing.pfx"
  if command -v cygpath >/dev/null 2>&1; then
    pfx_native="$(cygpath -w "$pfx_posix")"
  else
    pfx_native="$pfx_posix"
  fi
  powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass     -File scripts/ci/gitlab-package-windows-native.ps1     -Action DecodeSigningCertificate     -PfxPath "$pfx_native"
  export CSC_LINK="$pfx_native"
  export CSC_KEY_PASSWORD="$XD_WINDOWS_SIGN_PFX_PASSWORD"
elif [[ -n "${CI_COMMIT_TAG:-}" ]]; then
  echo "Stable Windows releases require XD_WINDOWS_SIGN_PFX_B64 and XD_WINDOWS_SIGN_PFX_PASSWORD." >&2
  exit 1
elif [[ "${CI_PIPELINE_SOURCE:-}" == "merge_request_event" ]]; then
  pfx_posix="$ci_tmp/xdrive-desktop-ci-signing.pfx"
  if command -v cygpath >/dev/null 2>&1; then
    pfx_native="$(cygpath -w "$pfx_posix")"
  else
    pfx_native="$pfx_posix"
  fi
  powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass     -File scripts/ci/gitlab-windows-native.ps1     -Action PrepareSigning     -PfxPath "$pfx_native"     -Password "xdrive-ci-signing"
  export CSC_LINK="$pfx_native"
  export CSC_KEY_PASSWORD="xdrive-ci-signing"
fi

pushd desktop >/dev/null
npm install --no-audit --no-fund
node scripts/set-version.mjs "$XDRIVE_DESKTOP_VERSION"
npm run runtime:win
test -f release/win-unpacked/xdrive-desktop.exe
popd >/dev/null
