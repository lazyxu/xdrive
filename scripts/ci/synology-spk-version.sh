#!/usr/bin/env bash
# One monotonically increasing DSM package sequence across stable and edge.
# The package's feature version is independent from the embedded xd version.
set -euo pipefail

[[ "$(git rev-parse --is-shallow-repository)" == "false" ]] || {
  echo "Synology package version requires full Git history (fetch-depth/GIT_DEPTH=0)" >&2
  exit 1
}
count="$(git rev-list --count HEAD)"
[[ "$count" =~ ^[1-9][0-9]*$ ]] || {
  echo "invalid Synology commit count" >&2
  exit 1
}
release_version="${XDRIVE_RELEASE_VERSION:?source client-artifact-version.sh first}"
case "$release_version" in
  snapshot|0.0.0-ci) channel_offset=0 ;;
  v*)
    [[ "$release_version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([-+][A-Za-z0-9.-]+)?$ ]] || {
      echo "unsupported DSM stable tag format: $release_version" >&2
      exit 1
    }
    channel_offset=1 ;;
  *)
    echo "unsupported xDrive release version for DSM: $release_version" >&2
    exit 1 ;;
esac
# On the SAME source commit, stable follows snapshot by one. The NEXT master
# descendant always follows stable: no downgrade on release-channel switch.
[[ "$count" -le 1073741823 ]] || {
  echo "Synology build count exceeds DSM's 31-bit numeric version limit" >&2
  exit 1
}
build=$((count * 2 + channel_offset))
XDRIVE_SPK_VERSION="0.1.0-$build"
export XDRIVE_SPK_VERSION
