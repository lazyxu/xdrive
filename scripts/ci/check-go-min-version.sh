#!/usr/bin/env bash
set -euo pipefail

minimum="${1:-1.25}"
current="${XDRIVE_CI_GO_VERSION_OVERRIDE:-$(go env GOVERSION)}"
version="${current#go}"

if [[ ! "$minimum" =~ ^([0-9]+)\.([0-9]+)$ ]]; then
  echo "invalid minimum Go version: $minimum" >&2
  exit 2
fi
min_major="${BASH_REMATCH[1]}"
min_minor="${BASH_REMATCH[2]}"

if [[ ! "$version" =~ ^([0-9]+)\.([0-9]+) ]]; then
  echo "unable to parse Go version: $current" >&2
  exit 2
fi
major="${BASH_REMATCH[1]}"
minor="${BASH_REMATCH[2]}"

if (( major < min_major || (major == min_major && minor < min_minor) )); then
  echo "Go >= $minimum is required; found $current." >&2
  exit 1
fi

echo "Go version OK: $current (minimum $minimum)"
