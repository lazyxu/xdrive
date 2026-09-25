#!/usr/bin/env bash
set -euo pipefail

for cmd in go; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "required Go cache command is missing from PATH: $cmd" >&2
    exit 1
  fi
done

modcache="${GOMODCACHE:-$(go env GOMODCACHE)}"
verify_log="$(mktemp)"
trap 'rm -f "$verify_log"' EXIT INT TERM

verify_modules() {
  : >"$verify_log"
  go mod download
  go mod verify >"$verify_log" 2>&1
}

if verify_modules; then
  cat "$verify_log"
  exit 0
fi

echo "[ci] restored Go module cache failed verification; rebuilding it." >&2
tail -n 20 "$verify_log" >&2 || true

# go clean -modcache knows how to clear read-only Go module trees. Keep a
# Windows-native fallback because self-hosted Shell runners can leave ACL or
# attribute residue behind after cache extraction.
GOMODCACHE="$modcache" GOFLAGS= go clean -modcache || true
if [[ -d "$modcache" ]]; then
  if command -v powershell.exe >/dev/null 2>&1 && [[ -n "${CI_PROJECT_DIR:-}" ]]; then
    powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command       '$path = Join-Path $env:CI_PROJECT_DIR ".cache\go-mod"; if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop }'
  else
    rm -rf "$modcache"
  fi
fi

if ! verify_modules; then
  echo "[ci] Go module cache still fails verification after a clean download." >&2
  cat "$verify_log" >&2
  exit 1
fi

cat "$verify_log"
echo "[ci] Go module cache rebuilt and verified."
