#!/usr/bin/env bash
set -euo pipefail
core="${1:-release/synology/core}"
version="${2:-0.1.0+synology-dev}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
command -v qemu-arm >/dev/null || { echo 'qemu-arm is required' >&2; exit 1; }
command -v go >/dev/null || { echo 'Go compiler is required' >&2; exit 1; }

for exe in xd xdrive-agent; do
  test -x "$core/$exe"
  info="$(go version -m "$core/$exe")"
  grep -Fq 'GOOS=linux' <<<"$info"
  grep -Fq 'GOARCH=arm' <<<"$info"
  grep -Fq 'GOARM=7' <<<"$info"
done

actual="$(qemu-arm -cpu cortex-a9 "$core/xd" version)"
[[ "$actual" == "$version" ]] || {
  echo "QEMU original ARMv7 CLI wrong version: got $actual want $version" >&2
  exit 1
}
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
qemu-arm -cpu cortex-a9 "$core/xd" backup help >"$tmp/backup-help.txt"
grep -Fq 'xd backup init' "$tmp/backup-help.txt"
grep -Fq 'xd backup agent' "$tmp/backup-help.txt"
# Verify the newly shared secure headless login flag rejects ambiguous secrets
# before any HTTP request; errors must never reproduce the supplied password.
if printf 'pipe-password\n' | qemu-arm -cpu cortex-a9 "$core/xd" login \
  --server https://drive.invalid --username fixture \
  --password=argv-password --password-stdin >"$tmp/password-invalid.txt" 2>&1; then
  echo 'ARMv7 CLI accepted conflicting stdin/argv credentials' >&2
  exit 1
fi
grep -Fq -- '--password-stdin cannot be combined' "$tmp/password-invalid.txt"
if grep -Fq 'pipe-password' "$tmp/password-invalid.txt" || grep -Fq 'argv-password' "$tmp/password-invalid.txt"; then
  echo 'ARMv7 CLI leaked password in diagnostic' >&2
  exit 1
fi


# The original Agent must reject attempts to enable desktop mounts in NAS mode.
if qemu-arm -cpu cortex-a9 "$core/xdrive-agent" --backup-only --mount >"$tmp/agent-invalid.txt" 2>&1; then
  echo 'ARMv7 agent accepted forbidden backup-only mount mode' >&2
  exit 1
fi
grep -Fq 'does not accept additional arguments' "$tmp/agent-invalid.txt"

mkdir -p "$tmp/home" "$tmp/config" "$tmp/cache"
start="$(date +%s)"
timeout --foreground --preserve-status --signal=TERM --kill-after=8s 3s \
  env HOME="$tmp/home" XDG_CONFIG_HOME="$tmp/config" XDG_CACHE_HOME="$tmp/cache" \
  qemu-arm -cpu cortex-a9 "$core/xdrive-agent" --backup-only
elapsed="$(( $(date +%s) - start ))"
[[ "$elapsed" -ge 3 ]] || { echo 'ARMv7 Agent exited before graceful SIGTERM' >&2; exit 1; }

# Sparse allocation: only a few bytes are physically written, but all offsets
# and Stat.Size must remain signed int64 even in a 32-bit userspace process.
CGO_ENABLED=0 GOOS=linux GOARCH=arm GOARM=7 go build -trimpath \
  -o "$tmp/largefile-arm" "$root/scripts/ci/synology-armv7-largefile-probe.go"
qemu-arm -cpu cortex-a9 "$tmp/largefile-arm"
echo 'ARMv7 QEMU genuine xd/Agent runtime, SIGTERM and >4GiB sparse offset checks passed.'
