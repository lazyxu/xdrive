#!/usr/bin/env bash
set -euo pipefail

for cmd in go git; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "required Windows CI command is missing from PATH: $cmd" >&2
    exit 1
  }
done

bash scripts/ci/check-go-min-version.sh 1.25
echo "GOPROXY=$(go env GOPROXY)"
echo "GOSUMDB=$(go env GOSUMDB)"

# The self-hosted Windows runner may use Go newer than the module baseline.
bash scripts/ci/prepare-go-mod-cache.sh
git diff --exit-code -- go.mod go.sum
go test -mod=readonly ./internal/... ./cmd/xdrive-agent
go test -mod=readonly -tags=xdrive_e2e ./internal/mount -run ^TestWindowsCfAPI -v -count=1
