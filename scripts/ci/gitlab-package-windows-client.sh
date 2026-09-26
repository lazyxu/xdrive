#!/usr/bin/env bash
set -euo pipefail

for cmd in git powershell.exe; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "required Windows packaging command is missing from PATH: $cmd" >&2
    exit 1
  }
done

source scripts/ci/client-artifact-version.sh

test -f desktop/release/win-unpacked/xdrive-desktop.exe || {
  echo "Windows desktop runtime artifact is missing." >&2
  exit 1
}
for binary in xd.exe xdrive-agent.exe; do
  test -f "release/core/windows-amd64/$binary" || {
    echo "prebuilt Windows core binary is missing: release/core/windows-amd64/$binary" >&2
    exit 1
  }
done

inno_found=0
if command -v ISCC.exe >/dev/null 2>&1; then
  inno_found=1
else
  powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command     '$paths=@("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe","$env:ProgramFiles\Inno Setup 6\ISCC.exe"); if($paths | Where-Object { $_ -and (Test-Path $_) }) { exit 0 } else { exit 1 }' &&
    inno_found=1 || true
fi
if [[ "$inno_found" != "1" ]]; then
  if command -v choco >/dev/null 2>&1; then
    choco install innosetup --no-progress -y
  elif command -v choco.exe >/dev/null 2>&1; then
    choco.exe install innosetup --no-progress -y
  else
    echo "Chocolatey is required when Inno Setup is not already installed." >&2
    exit 1
  fi
fi

ci_tmp="$PWD/.gitlab-ci-package-windows"
rm -rf "$ci_tmp"
mkdir -p "$ci_tmp"
trap 'rm -rf "$ci_tmp"' EXIT INT TERM

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
  powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass     -File scripts/ci/gitlab-package-windows-native.ps1     -Action DecodeSigningCertificate -PfxPath "$pfx_native"
  export XD_WINDOWS_SIGN_PFX_PATH="$pfx_native"
  export XD_WINDOWS_SIGN_PFX_PASSWORD
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
  powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass     -File scripts/ci/gitlab-windows-native.ps1     -Action PrepareSigning -PfxPath "$pfx_native" -Password "$password"
  export XD_WINDOWS_SIGN_PFX_PATH="$pfx_native"
  export XD_WINDOWS_SIGN_PFX_PASSWORD="$password"
fi

rm -rf release/windows-build release/xDriveSetup-amd64.exe
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass   -File scripts/ci/gitlab-windows-native.ps1   -Action BuildInstaller   -Version "$XDRIVE_RELEASE_VERSION"   -CoreSourceDir "release/core/windows-amd64"

test -f release/xDriveSetup-amd64.exe
