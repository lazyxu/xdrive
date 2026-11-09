#!/usr/bin/env bash
# Every stable v* Registry upload, including private-looking ci-* staging tags
# and the Photo Face reusable runtime, must be gated BEFORE first byte upload.
# GitLab still builds all images locally; GitHub only attests exact-tag CI.
set -euo pipefail

if [[ -z "${CI_COMMIT_TAG:-}" ]]; then
  exit 0
fi
: "${CI_COMMIT_SHA:?exact full source Commit required for stable release}"
[[ "$CI_COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]] || {
  echo "[xDrive] invalid stable release Commit" >&2
  exit 1
}
[[ "$CI_COMMIT_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([+-][A-Za-z0-9.-]+)?$ ]] || {
  echo "[xDrive] invalid stable release tag: $CI_COMMIT_TAG" >&2
  exit 1
}
echo "[xDrive] checking GitHub exact-tag Final Gate before any GitLab Registry write: $CI_COMMIT_TAG ($CI_COMMIT_SHA)"
go run scripts/ci/verify-github-stable-final-gate.go
