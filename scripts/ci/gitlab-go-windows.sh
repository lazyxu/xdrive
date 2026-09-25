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

# The self-hosted Windows runner may use Go newer than the module baseline.
# Do not let a newer toolchain rewrite the dependency graph; canonical module
# tidiness validation runs under Go 1.25 on Linux/GitHub.
go mod download
go mod verify
git diff --exit-code -- go.mod go.sum
go test -mod=readonly ./internal/... ./cmd/xdrive-agent
go test -mod=readonly -tags=xdrive_e2e ./internal/mount -run TestWindowsCfAPIE2E -v -count=1

powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/ci/gitlab-windows-native.ps1 -Action ValidateScripts
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/ci/test-windows-uninstaller-resolver.ps1

go build -mod=readonly -o xd.exe ./cmd/xd
go build -mod=readonly -ldflags="-H=windowsgui" -o xdrive-agent.exe ./cmd/xdrive-agent

"$choco_cmd" install innosetup --no-progress -y

ci_tmp="$PWD/.gitlab-ci-tmp"
rm -rf "$ci_tmp"
mkdir -p "$ci_tmp"
trap 'rm -rf "$ci_tmp"' EXIT INT TERM
pfx_posix="$ci_tmp/xdrive-ci-signing.pfx"
if command -v cygpath >/dev/null 2>&1; then
  pfx_native="$(cygpath -w "$pfx_posix")"
else
  pfx_native="$pfx_posix"
fi
password="xdrive-ci-signing"

powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/ci/gitlab-windows-native.ps1 -Action PrepareSigning -PfxPath "$pfx_native" -Password "$password"

export XD_WINDOWS_SIGN_PFX_PATH="$pfx_native"
export XD_WINDOWS_SIGN_PFX_PASSWORD="$password"
export CSC_LINK="$pfx_native"
export CSC_KEY_PASSWORD="$password"

pushd desktop >/dev/null
npm install --no-audit --no-fund
node scripts/set-version.mjs 0.0.0-ci
npm run dist:win
popd >/dev/null

powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/ci/gitlab-windows-native.ps1 -Action BuildInstaller
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/ci/gitlab-windows-native.ps1 -Action VerifySignatures
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/test-windows-client-upgrade.ps1 -Installer ./dist/xDriveSetup-amd64.exe -TargetVersion 0.0.0-ci
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/ci/gitlab-windows-native.ps1 -Action SmokeInstall
