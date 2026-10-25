#!/usr/bin/env bash
# Reuse the exact pinned image from the existing photo-face-image build.
# The source test is opt-in because normal Go/API CI must not depend on Docker.
set -euo pipefail

image_ref="xdrive/photo-face:test"
docker image inspect "$image_ref" >/dev/null
postgres_container="xdrive-ocr-postgres-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-$$"
docker run -d --rm --name "$postgres_container" \
  -e POSTGRES_USER=xdrive -e POSTGRES_PASSWORD=xdrive \
  -e POSTGRES_DB=xdrive_test -p 127.0.0.1:5432:5432 postgres:17-alpine
trap 'docker rm -f "$postgres_container" >/dev/null 2>&1 || true' EXIT

ready=0
for trial in $(seq 1 60); do
  if docker exec "$postgres_container" pg_isready -U xdrive -d xdrive_test >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" != "1" ]]; then
  docker logs "$postgres_container"
  exit 1
fi

XD_TEST_DATABASE_URL="postgres://xdrive:xdrive@127.0.0.1:5432/xdrive_test?sslmode=disable" \
XD_OCR_REAL_MODEL_E2E=1 \
XD_OCR_REAL_MODEL_IMAGE=xdrive/photo-face:test \
  go test ./internal/api -run 'TestQueryMediaItemsFilters/real_JPEG_pinned_OCR_model_to_Gallery_search' \
  -count=1 -timeout=15m -v
