#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git -C "$tmp" init -q
git -C "$tmp" -c user.email=test@example.invalid -c user.name=test commit -q --allow-empty -m a
git -C "$tmp" -c user.email=test@example.invalid -c user.name=test commit -q --allow-empty -m b
count="$(git -C "$tmp" rev-list --count HEAD)"

check() (
  cd "$tmp"
  XDRIVE_RELEASE_VERSION="$1"
  source "$ROOT/scripts/ci/synology-spk-version.sh"
  [[ "$XDRIVE_SPK_VERSION" == "$2" ]] || {
    echo "wrong DSM package version: $XDRIVE_SPK_VERSION != $2" >&2
    exit 1
  }
)
check snapshot "0.1.0-$((count * 2))"
check 0.0.0-ci "0.1.0-$((count * 2))"
check v1.2.3 "0.1.0-$((count * 2 + 1))"
check v1.2.3-rc.1 "0.1.0-$((count * 2 + 1))"
check v1.2.3+metadata "0.1.0-$((count * 2 + 1))"

git -C "$tmp" -c user.email=test@example.invalid -c user.name=test commit -q --allow-empty -m c
count="$((count + 1))"
check snapshot "0.1.0-$((count * 2))"
if (cd "$tmp"; XDRIVE_RELEASE_VERSION=v1.2.x source "$ROOT/scripts/ci/synology-spk-version.sh") >"$tmp/rejected" 2>&1; then
  echo 'invalid stable tag accepted' >&2
  exit 1
fi
git clone -q --depth 1 "file://$tmp" "$tmp/shallow"
if (cd "$tmp/shallow"; XDRIVE_RELEASE_VERSION=snapshot source "$ROOT/scripts/ci/synology-spk-version.sh") >>"$tmp/rejected" 2>&1; then
  echo "shallow package version unexpectedly accepted" >&2
  exit 1
fi
grep -Fq 'full Git history' "$tmp/rejected"
echo 'DSM snapshot/stable monotonic versions, switch order and shallow rejection passed.'
