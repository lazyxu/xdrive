#!/usr/bin/env bash
set -euo pipefail

for cmd in go node npm git powershell.exe; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "required Windows client build command is missing from PATH: $cmd" >&2
    exit 1
  }
done

source scripts/ci/client-artifact-version.sh
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$node_major" == "22" ]] || {
  echo "Node.js 22 is required; found $(node --version)." >&2
  exit 1
}

ci_tmp="$PWD/.gitlab-ci-build-windows"
rm -rf "$ci_tmp"
mkdir -p "$ci_tmp"
trap 'rm -rf "$ci_tmp"' EXIT INT TERM

signing_path=""
signing_password=""
if [[ -n "${XD_WINDOWS_SIGN_PFX_B64:-}" ]]; then
  [[ -n "${XD_WINDOWS_SIGN_PFX_PASSWORD:-}" ]] || {
    echo "XD_WINDOWS_SIGN_PFX_PASSWORD is required when XD_WINDOWS_SIGN_PFX_B64 is set." >&2
    exit 1
  }
  pfx_posix="$ci_tmp/xdrive-client-signing.pfx"
  if command -v cygpath >/dev/null 2>&1; then
    signing_path="$(cygpath -w "$pfx_posix")"
  else
    signing_path="$pfx_posix"
  fi
  powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass     -File scripts/ci/gitlab-package-windows-native.ps1     -Action DecodeSigningCertificate -PfxPath "$signing_path"
  signing_password="$XD_WINDOWS_SIGN_PFX_PASSWORD"
elif [[ -n "${CI_COMMIT_TAG:-}" ]]; then
  echo "Stable Windows releases require XD_WINDOWS_SIGN_PFX_B64 and XD_WINDOWS_SIGN_PFX_PASSWORD." >&2
  exit 1
elif [[ "${CI_PIPELINE_SOURCE:-}" == "merge_request_event" ]]; then
  pfx_posix="$ci_tmp/xdrive-client-ci-signing.pfx"
  if command -v cygpath >/dev/null 2>&1; then
    signing_path="$(cygpath -w "$pfx_posix")"
  else
    signing_path="$pfx_posix"
  fi
  signing_password="xdrive-ci-signing"
  powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass     -File scripts/ci/gitlab-windows-native.ps1     -Action PrepareSigning -PfxPath "$signing_path" -Password "$signing_password"
fi

if [[ -n "$signing_path" ]]; then
  export CSC_LINK="$signing_path"
  export CSC_KEY_PASSWORD="$signing_password"
  export XD_WINDOWS_SIGN_PFX_PATH="$signing_path"
  export XD_WINDOWS_SIGN_PFX_PASSWORD="$signing_password"
fi

bash scripts/build-client-core.sh "$XDRIVE_RELEASE_VERSION" release/core windows &
core_pid=$!
(
  cd desktop
  npm install --no-audit --no-fund
  node scripts/set-version.mjs "$XDRIVE_DESKTOP_VERSION"
  npm run runtime:win
) &
desktop_pid=$!

core_status=0
desktop_status=0
wait "$core_pid" || core_status=$?
wait "$desktop_pid" || desktop_status=$?
[[ "$core_status" == "0" ]] || exit "$core_status"
[[ "$desktop_status" == "0" ]] || exit "$desktop_status"

test -f desktop/release/win-unpacked/xdrive-desktop.exe
if [[ -n "$signing_path" ]]; then
  powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command     '$sig = Get-AuthenticodeSignature "./desktop/release/win-unpacked/xdrive-desktop.exe"; if ($null -eq $sig.SignerCertificate -or $sig.Status -eq "NotSigned") { throw "desktop runtime signature missing" }'
fi

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

rm -rf release/windows-build release/xDriveSetup-amd64.exe
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass   -File scripts/ci/gitlab-windows-native.ps1   -Action BuildInstaller   -Version "$XDRIVE_RELEASE_VERSION"   -CoreSourceDir "release/core/windows-amd64"

test -f release/xDriveSetup-amd64.exe
