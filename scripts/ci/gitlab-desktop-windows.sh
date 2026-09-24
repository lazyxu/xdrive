#!/usr/bin/env bash
set -euo pipefail

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$node_major" != "22" ]]; then
  echo "Node.js 22 is required; found $(node --version)." >&2
  exit 1
fi

pushd desktop >/dev/null
npm install --no-audit --no-fund
npm run test:main
node scripts/set-version.mjs 0.0.0-ci
npm run dist:win
test -f release/xDriveDesktopSetup-amd64.exe
test -f release/win-unpacked/xdrive-desktop.exe
popd >/dev/null
