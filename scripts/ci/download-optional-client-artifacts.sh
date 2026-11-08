#!/usr/bin/env bash
# Collect only the exact source run's successful client packages. Absent
# platforms are intentionally omitted; a present-but-invalid artifact fails.
set -euo pipefail
: "${GH_TOKEN:?GitHub Actions read token required}"
: "${GITHUB_RUN_ID:?Source workflow run required}"
: "${GITHUB_REPOSITORY:?Repository required}"
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ ]] || exit 2
[[ "$GITHUB_REPOSITORY" == lazyxu/xdrive ]] || exit 2
dest="${1:?output directory}"
mkdir -p "$dest"
[[ -d "$dest" && ! -L "$dest" ]] || exit 2

inventory="$(gh api --paginate "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/artifacts?per_page=100")"
mapfile -t names < <(jq -s -r '.[].artifacts[] | select(.expired == false) | .name' <<< "$inventory" | LC_ALL=C sort -u)
available() {
  local item candidate
  item="$1"
  for candidate in "${names[@]}"; do
    [[ "$candidate" == "$item" ]] && return 0
  done
  return 1
}
for item in xdrive-linux-amd64 xdrive-windows-amd64 xdrive-backup-cli xdrivenas-spk; do
  if ! available "$item"; then
    echo "::notice::No exact-run $item artifact for $GITHUB_SHA; omit this platform."
    continue
  fi
  echo "[xDrive] Collecting verified source-run artifact $item"
  gh run download "$GITHUB_RUN_ID" --repo "$GITHUB_REPOSITORY" --name "$item" --dir "$dest"
done
# Source CI artifacts are untrusted files until downstream package/allowlist
# verification. No archive expansion, symlink or extra top-level files.
if find "$dest" -maxdepth 1 -type l | grep -q .; then
  echo "symlinked client artifact" >&2
  exit 1
fi
echo "Collected only existing exact-run client packages."
