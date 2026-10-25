#!/usr/bin/env bash
set -euo pipefail

# Package the exact SAME xd + xdrive-agent binaries already built by
# build-client-core.sh. No recompilation, Desktop, GUI or duplicate uploader.
CORE_DIR="${1:-release/core}"
OUTPUT_DIR="${2:-release/backup-cli}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$OUTPUT_DIR"
CORE_DIR="$(cd "$CORE_DIR" && pwd)"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"

for file in linux-amd64/xd linux-amd64/xdrive-agent windows-amd64/xd.exe windows-amd64/xdrive-agent.exe; do
  test -s "$CORE_DIR/$file" || { echo "missing client core $file" >&2; exit 1; }
done

staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
mkdir -p "$staging/linux/xdrive-backup" "$staging/windows/xdrive-backup"

install -m 0755 "$CORE_DIR/linux-amd64/xd" "$staging/linux/xdrive-backup/xd"
install -m 0755 "$CORE_DIR/linux-amd64/xdrive-agent" "$staging/linux/xdrive-backup/xdrive-agent"
install -m 0644 "$ROOT/packaging/linux/xdrive-backup-agent.service" \
  "$staging/linux/xdrive-backup/xdrive-backup-agent.service"
install -m 0644 "$ROOT/docs/xd-backup-only-cli.md" "$staging/linux/xdrive-backup/README.md"

install -m 0644 "$CORE_DIR/windows-amd64/xd.exe" "$staging/windows/xdrive-backup/xd.exe"
install -m 0644 "$CORE_DIR/windows-amd64/xdrive-agent.exe" "$staging/windows/xdrive-backup/xdrive-agent.exe"
install -m 0644 "$ROOT/docs/xd-backup-only-cli.md" "$staging/windows/xdrive-backup/README.md"
install -m 0644 "$ROOT/packaging/windows/install-backup-agent-task.ps1" \
  "$staging/windows/xdrive-backup/install-backup-agent-task.ps1"
install -m 0644 "$ROOT/docs/xd-backup-agent-windows-task.md" \
  "$staging/windows/xdrive-backup/WINDOWS_TASK.md"

tar -C "$staging/linux" -czf "$OUTPUT_DIR/xdrive-backup-linux-amd64.tar.gz" xdrive-backup

# Python standard library avoids an extra native Windows packaging dependency.
python3 - "$staging/windows" "$OUTPUT_DIR/xdrive-backup-windows-amd64.zip" <<'PY'
import pathlib
import sys
import zipfile
base = pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2], "w", zipfile.ZIP_DEFLATED) as archive:
    for path in sorted((base / "xdrive-backup").iterdir()):
        archive.write(path, path.relative_to(base).as_posix())
PY

echo "CLI-only archives contain two original client binaries and no Desktop."
