#!/usr/bin/env bash
set -euo pipefail

for cmd in go node npm; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "required Linux client build command is missing from PATH: $cmd" >&2
    exit 1
  }
done

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$node_major" != "22" ]]; then
  echo "Node.js 22 is required; found $(node --version)." >&2
  exit 1
fi

source scripts/ci/client-artifact-version.sh

pushd desktop >/dev/null
npm install --no-audit --no-fund
node scripts/set-version.mjs "$XDRIVE_DESKTOP_VERSION"
npm run runtime:linux
test -x release/linux-unpacked/xdrive-desktop
popd >/dev/null

bash scripts/build-linux-deb.sh "$XDRIVE_RELEASE_VERSION" release desktop/release/linux-unpacked
test -f release/xdrive-linux-amd64.deb
