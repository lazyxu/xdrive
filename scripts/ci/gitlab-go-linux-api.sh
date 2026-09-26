#!/usr/bin/env bash
set -euo pipefail

bash scripts/ci/check-go-min-version.sh 1.25
echo "GOPROXY=$(go env GOPROXY)"
echo "GOSUMDB=$(go env GOSUMDB)"

pg_ready=0
for _ in $(seq 1 60); do
  if PGPASSWORD="$POSTGRES_PASSWORD" pg_isready \
    -h postgres -p 5432 -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
    pg_ready=1
    break
  fi
  sleep 1
done
if [[ "$pg_ready" != "1" ]]; then
  echo "GitLab PostgreSQL service did not become ready at postgres:5432." >&2
  exit 1
fi
PGPASSWORD="$POSTGRES_PASSWORD" psql \
  -h postgres -p 5432 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v ON_ERROR_STOP=1 -c 'SELECT 1' >/dev/null

go test -p 1 -race ./internal/api
