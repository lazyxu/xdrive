#!/usr/bin/env bash
set -euo pipefail

for cmd in go node npm; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "required Linux client build command is missing from PATH: $cmd" >&2
    exit 1
  }
done

source scripts/ci/client-artifact-version.sh
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$node_major" == "22" ]] || {
  echo "Node.js 22 is required; found $(node --version)." >&2
  exit 1
}

bash scripts/build-client-core.sh "$XDRIVE_RELEASE_VERSION" release/core linux &
core_pid=$!
(
  cd desktop
  npm install --no-audit --no-fund
  node scripts/set-version.mjs "$XDRIVE_DESKTOP_VERSION"
  npm run runtime:linux
) &
desktop_pid=$!

core_status=0
desktop_status=0
wait "$core_pid" || core_status=$?
wait "$desktop_pid" || desktop_status=$?
[[ "$core_status" == "0" ]] || exit "$core_status"
[[ "$desktop_status" == "0" ]] || exit "$desktop_status"

test -x desktop/release/linux-unpacked/xdrive-desktop
bash scripts/build-linux-deb.sh "$XDRIVE_RELEASE_VERSION" release desktop/release/linux-unpacked release/core/linux-amd64
test -f release/xdrive-linux-amd64.deb
