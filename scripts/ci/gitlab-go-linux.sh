#!/usr/bin/env bash
set -euo pipefail

bash scripts/ci/check-go-min-version.sh 1.25
echo "GOPROXY=$(go env GOPROXY)"
echo "GOSUMDB=$(go env GOSUMDB)"

pg_ready=0
for _ in $(seq 1 60); do
  if PGPASSWORD="$POSTGRES_PASSWORD" pg_isready     -h postgres -p 5432 -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
    pg_ready=1
    break
  fi
  sleep 1
done
if [[ "$pg_ready" != "1" ]]; then
  echo "GitLab PostgreSQL service did not become ready at postgres:5432." >&2
  exit 1
fi
PGPASSWORD="$POSTGRES_PASSWORD" psql   -h postgres -p 5432 -U "$POSTGRES_USER" -d "$POSTGRES_DB"   -v ON_ERROR_STOP=1 -c 'SELECT 1' >/dev/null

go mod tidy "-go=1.25"
git diff --exit-code -- go.mod go.sum

files="$(gofmt -l $(find cmd internal -name '*.go' -type f))"
if [[ -n "$files" ]]; then
  echo "$files"
  gofmt -d $files
  exit 1
fi

go list ./... | grep -vx 'github.com/lazyxu/xdrive/internal/api' | xargs go test -p 1 -race
go vet ./...
go build ./cmd/server ./cmd/xd ./cmd/xdrive-agent ./cmd/xdrive-updater
go build ./cmd/xdrive-source-agent
