#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?expected xd version required}"
OUT_DIR="${2:-release/backup-cli}"
CORE_DIR="${3:-release/core}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
test -s "$OUT_DIR/xdrive-backup-linux-amd64.tar.gz"
test -s "$OUT_DIR/xdrive-backup-windows-amd64.zip"
for file in linux-amd64/xd linux-amd64/xdrive-agent windows-amd64/xd.exe windows-amd64/xdrive-agent.exe; do
  test -s "$CORE_DIR/$file" || { echo "missing original core binary $file" >&2; exit 1; }
done

dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
tar -C "$dir" -xzf "$OUT_DIR/xdrive-backup-linux-amd64.tar.gz"
test -x "$dir/xdrive-backup/xd"
test -x "$dir/xdrive-backup/xdrive-agent"
test -f "$dir/xdrive-backup/xdrive-backup-agent.service"
test -f "$dir/xdrive-backup/README.md"
# A portable archive must ship byte-for-byte identical binaries, never a
# separately recompiled CLI, Agent or uploader.
cmp "$CORE_DIR/linux-amd64/xd" "$dir/xdrive-backup/xd"
cmp "$CORE_DIR/linux-amd64/xdrive-agent" "$dir/xdrive-backup/xdrive-agent"
actual_members="$(tar -tzf "$OUT_DIR/xdrive-backup-linux-amd64.tar.gz" | LC_ALL=C sort)"
expected_members="$(printf '%s\n' \
  'xdrive-backup/' \
  'xdrive-backup/README.md' \
  'xdrive-backup/xd' \
  'xdrive-backup/xdrive-agent' \
  'xdrive-backup/xdrive-backup-agent.service' | LC_ALL=C sort)"
[[ "$actual_members" == "$expected_members" ]] || {
  echo "CLI-only Linux archive contains missing or unexpected files" >&2
  exit 1
}
[[ "$("$dir/xdrive-backup/xd" version)" == "$VERSION" ]]
"$dir/xdrive-backup/xd" backup help > "$dir/backup-help.txt"
grep -Fq 'xd backup init' "$dir/backup-help.txt"
grep -Fq 'xd backup agent' "$dir/backup-help.txt"
if "$dir/xdrive-backup/xd" backup init --name Smoke --path relative --target-id 1 > "$dir/rejected-init.txt" 2>&1; then
  echo "relative local Root unexpectedly accepted by standalone CLI" >&2
  exit 1
fi
grep -Fq 'absolute directory' "$dir/rejected-init.txt"
if "$dir/xdrive-backup/xdrive-agent" --backup-only --mount > "$dir/rejected-agent.txt" 2>&1; then
  echo "headless Agent unexpectedly accepted mount arguments" >&2
  exit 1
fi
grep -Fq 'does not accept additional arguments' "$dir/rejected-agent.txt"
go version -m "$dir/xdrive-backup/xd" | grep -q 'GOOS=linux'
go version -m "$dir/xdrive-backup/xdrive-agent" | grep -q 'GOOS=linux'
go version -m "$dir/xdrive-backup/xd" | grep -q 'GOARCH=amd64'
go version -m "$dir/xdrive-backup/xdrive-agent" | grep -q 'GOARCH=amd64'
grep -Fq -- '--backup-only' "$dir/xdrive-backup/xdrive-backup-agent.service"

python3 - "$OUT_DIR/xdrive-backup-windows-amd64.zip" "$dir" "$CORE_DIR" <<'PY'
import pathlib
import sys
import zipfile
archive_path, output, core = map(pathlib.Path, sys.argv[1:])
with zipfile.ZipFile(archive_path) as archive:
    members = set(archive.namelist())
    expected = {
        "xdrive-backup/xd.exe",
        "xdrive-backup/xdrive-agent.exe",
        "xdrive-backup/README.md",
    }
    assert members == expected, (members, expected)
    for relative, original in (
        ("xdrive-backup/xd.exe", "windows-amd64/xd.exe"),
        ("xdrive-backup/xdrive-agent.exe", "windows-amd64/xdrive-agent.exe"),
    ):
        assert archive.read(relative) == (core / original).read_bytes(), (
            "Windows CLI archive binary differs from original client core", relative
        )
    archive.extractall(output)
PY
go version -m "$dir/xdrive-backup/xd.exe" | grep -q 'GOOS=windows'
go version -m "$dir/xdrive-backup/xdrive-agent.exe" | grep -q 'GOOS=windows'
go version -m "$dir/xdrive-backup/xd.exe" | grep -q 'GOARCH=amd64'
go version -m "$dir/xdrive-backup/xdrive-agent.exe" | grep -q 'GOARCH=amd64'
if find "$dir/xdrive-backup" -maxdepth 1 -iname '*desktop*' | grep -q .; then
  echo "CLI-only distribution must not contain Electron Desktop" >&2
  exit 1
fi
# Exercise the real no-mount Agent process under an isolated, unconfigured
# user directory. A systemd stop sends SIGTERM; the process must shut down
# cleanly via context cancellation, not exit with the default signal code.
mkdir -p "$dir/home" "$dir/config" "$dir/cache"
started="$(date +%s)"
timeout --preserve-status --signal=TERM --kill-after=5s 2s \
  env HOME="$dir/home" XDG_CONFIG_HOME="$dir/config" XDG_CACHE_HOME="$dir/cache" \
  "$dir/xdrive-backup/xdrive-agent" --backup-only
elapsed="$(( $(date +%s) - started ))"
[[ "$elapsed" -ge 2 ]] || {
  echo "headless Agent terminated before receiving the test SIGTERM" >&2
  exit 1
}
# Repeat with EXACTLY the same OS user, discovery directory and lock.
# This catches stale single-instance ownership or an Agent left running after
# a graceful service-manager stop without relying on a mounted drive.
started="$(date +%s)"
timeout --preserve-status --signal=TERM --kill-after=5s 2s \
  env HOME="$dir/home" XDG_CONFIG_HOME="$dir/config" XDG_CACHE_HOME="$dir/cache" \
  "$dir/xdrive-backup/xdrive-agent" --backup-only
elapsed="$(( $(date +%s) - started ))"
[[ "$elapsed" -ge 2 ]] || {
  echo "headless Agent failed to restart after SIGTERM (stale lock or early exit)" >&2
  exit 1
}
# "xd backup agent" is also a supported foreground service entrypoint.
# Send SIGTERM only to the wrapper, not to its process group: otherwise
# timeout also signals the child while CommandContext forwards os.Interrupt,
# racing two signals and intermittently reporting "xd: signal: interrupt".
# The wrapper must prove it gracefully stops the owning Agent itself,
# without CommandContext's default immediate SIGKILL.
mkdir -p "$dir/foreground-home" "$dir/foreground-config" "$dir/foreground-cache"
started="$(date +%s)"
timeout --foreground --preserve-status --signal=TERM --kill-after=8s 3s \
  env HOME="$dir/foreground-home" XDG_CONFIG_HOME="$dir/foreground-config" \
  XDG_CACHE_HOME="$dir/foreground-cache" \
  "$dir/xdrive-backup/xd" backup agent
elapsed="$(( $(date +%s) - started ))"
[[ "$elapsed" -ge 3 ]] || {
  echo "foreground Agent wrapper terminated before test SIGTERM" >&2
  exit 1
}
echo "CLI-only binaries match Desktop core bytes; archives, input rejection, direct and wrapped no-mount Agent graceful SIGTERM verified."
