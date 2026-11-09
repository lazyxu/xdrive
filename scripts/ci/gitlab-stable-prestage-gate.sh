#!/usr/bin/env bash
# Stable v* Registry uploads must wait for the exact GitHub tag's full Final
# Gate, including *temporary* ci-* tags and Photo Face runtime cache writes.
# Build from GitLab source first; gate only the FIRST Registry write.
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

# GitHub tag CI is triggered at approximately the same time as GitLab's
# independent source-build pipeline. An early "pending" result must not force
# every perfectly healthy GitLab stable image builder to fail immediately.
# Bound all waiting: never publish on API errors, failed or missing CI.
wait_seconds="${XDRIVE_STABLE_GATE_MAX_WAIT_SECONDS:-1800}"
poll_seconds="${XDRIVE_STABLE_GATE_POLL_SECONDS:-300}"
if [[ ! "$wait_seconds" =~ ^(0|[1-9][0-9]{0,3})$ ]] || (( wait_seconds > 5400 )) ||
   [[ ! "$poll_seconds" =~ ^[1-9][0-9]{0,3}$ ]] || (( poll_seconds > 900 )); then
  echo "[xDrive] invalid stable gate wait configuration" >&2
  exit 2
fi

start=$SECONDS
result="$(mktemp)"
trap 'rm -f "$result"' EXIT
echo "[xDrive] requiring GitHub exact-tag Final Gate before any GitLab Registry write: $CI_COMMIT_TAG ($CI_COMMIT_SHA)"
while true; do
  if go run scripts/ci/verify-github-stable-final-gate.go > "$result" 2>&1; then
    cat "$result"
    exit 0
  fi
  # Only the well-defined pending/no-success case is retryable. Mismatched
  # tags, invalid auth, HTTP 4xx/5xx, or malformed response are fail-closed.
  if ! grep -Fq 'has not completed with successful Final Gate and OCR smoke' "$result"; then
    cat "$result" >&2
    echo "[xDrive] stable gate rejected or unavailable; no Registry upload" >&2
    exit 1
  fi
  elapsed=$((SECONDS-start))
  remaining=$((wait_seconds-elapsed))
  if (( remaining <= 0 )); then
    cat "$result" >&2
    echo "[xDrive] stable tag CI remained pending/non-green after ${wait_seconds}s; no Registry upload" >&2
    exit 1
  fi
  delay=$poll_seconds
  (( delay > remaining )) && delay=$remaining
  echo "[xDrive] exact GitHub tag CI not yet green; retrying after ${delay}s (bounded wait remaining ${remaining}s)" >&2
  sleep "$delay"
done
