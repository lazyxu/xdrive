#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/cleanup-merged-branches.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
DELETE_LOG="$TMP/deletes.log"
: > "$DELETE_LOG"

cat > "$TMP/bin/mock-gh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" != "api" ]]; then
  exit 2
fi
shift
if [[ "${1:-}" == "--paginate" ]]; then
  cat <<'JSON'
[
  {
    "merged_at": "2026-09-24T00:00:00Z",
    "head": {"ref": "merged/rebased", "sha": "aaaa", "repo": {"full_name": "lazyxu/xdrive"}}
  },
  {
    "merged_at": "2026-09-24T00:01:00Z",
    "head": {"ref": "advanced-branch", "sha": "bbbb", "repo": {"full_name": "lazyxu/xdrive"}}
  },
  {
    "merged_at": "2026-09-24T00:02:00Z",
    "head": {"ref": "external-branch", "sha": "eeee", "repo": {"full_name": "someone/fork"}}
  },
  {
    "merged_at": null,
    "head": {"ref": "open-branch", "sha": "ffff", "repo": {"full_name": "lazyxu/xdrive"}}
  }
]
JSON
  exit 0
fi
if [[ "${1:-}" == "--method" && "${2:-}" == "DELETE" ]]; then
  printf '%s\n' "${3:-}" >> "$DELETE_LOG"
  exit 0
fi
endpoint="${1:-}"
case "$endpoint" in
  */git/ref/heads/merged/rebased) printf '%s\n' aaaa ;;
  */git/ref/heads/advanced-branch) printf '%s\n' cccc ;;
  *) exit 1 ;;
esac
SH
chmod +x "$TMP/bin/mock-gh"

cat > "$TMP/bin/mock-git" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  fetch)
    exit 0
    ;;
  for-each-ref)
    cat <<'EOF'
origin/master
origin/ancestor-only
origin/advanced-branch
origin/active-branch
origin/merged/rebased
EOF
    ;;
  merge-base)
    [[ "${2:-}" == "--is-ancestor" ]] || exit 2
    case "${3:-}" in
      origin/ancestor-only) exit 0 ;;
      *) exit 1 ;;
    esac
    ;;
  *)
    exit 2
    ;;
esac
SH
chmod +x "$TMP/bin/mock-git"

export DELETE_LOG
export GITHUB_REPOSITORY="lazyxu/xdrive"
export GH_BIN="$TMP/bin/mock-gh"
export GIT_BIN="$TMP/bin/mock-git"

bash "$SCRIPT" > "$TMP/out"

grep -qx 'repos/lazyxu/xdrive/git/refs/heads/merged/rebased' "$DELETE_LOG"
grep -qx 'repos/lazyxu/xdrive/git/refs/heads/ancestor-only' "$DELETE_LOG"
[[ "$(wc -l < "$DELETE_LOG" | tr -d ' ')" == "2" ]]
! grep -q 'advanced-branch' "$DELETE_LOG"
! grep -q 'active-branch' "$DELETE_LOG"
! grep -q 'external-branch' "$DELETE_LOG"
grep -q 'removed 2 redundant branch(es)' "$TMP/out"

echo "merged branch cleanup tests passed"
