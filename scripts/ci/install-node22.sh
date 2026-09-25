#!/usr/bin/env bash
set -euo pipefail

ROOT="${CI_PROJECT_DIR:-$PWD}"
cache="$ROOT/.cache/ci-tools/node"
mkdir -p "$cache"

case "$(uname -m)" in
  x86_64) node_arch="x64" ;;
  *) echo "unsupported GitLab Linux CI architecture: $(uname -m)" >&2; exit 1 ;;
esac

version="${XDRIVE_CI_NODE_VERSION:?XDRIVE_CI_NODE_VERSION is required}"
node_file="node-v${version}-linux-${node_arch}.tar.xz"
archive="$cache/$node_file"
sums="$cache/SHASUMS256-v${version}.txt"
mirror="${XDRIVE_CI_NODE_MIRROR:-https://mirrors.huaweicloud.com/nodejs}"

if [[ ! -f "$sums" ]] || ! grep -Eq "^[0-9a-fA-F]{64}[[:space:]]+${node_file}$" "$sums"; then
  rm -f "$sums"
  bash scripts/ci/download-with-fallback.sh "$sums" \
    "${mirror%/}/v${version}/SHASUMS256.txt" \
    "https://nodejs.org/dist/v${version}/SHASUMS256.txt"
fi

if [[ -f "$archive" ]] && ! (cd "$cache" && grep " ${node_file}$" "$(basename "$sums")" | sha256sum -c - >/dev/null 2>&1); then
  echo "[ci-node] cached archive failed checksum; redownloading" >&2
  rm -f "$archive"
fi

if [[ ! -f "$archive" ]]; then
  bash scripts/ci/download-with-fallback.sh "$archive" \
    "${mirror%/}/v${version}/${node_file}" \
    "https://nodejs.org/dist/v${version}/${node_file}"
fi

(cd "$cache" && grep " ${node_file}$" "$(basename "$sums")" | sha256sum -c -)
tar -xJf "$archive" -C /usr/local --strip-components=1
test "$(node -p 'process.versions.node')" = "$version"
echo "[ci-node] installed Node $(node --version)"
