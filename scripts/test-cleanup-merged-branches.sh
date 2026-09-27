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
  endpoint="${2:-}"
  case "$endpoint" in
    *"pulls?state=open"*)
      cat <<'JSON'
[
  {
    "number": 201,
    "merged_at": null,
    "head": {"ref": "active-branch", "sha": "open1", "repo": {"full_name": "lazyxu/xdrive"}},
    "labels": []
  },
  {
    "number": 202,
    "merged_at": null,
    "head": {"ref": "superseded/reused", "sha": "new-open-tip", "repo": {"full_name": "lazyxu/xdrive"}},
    "labels": []
  },
  {
    "number": 203,
    "merged_at": null,
    "head": {"ref": "fork-open", "sha": "fork-open-tip", "repo": {"full_name": "someone/fork"}},
    "labels": []
  }
]
JSON
      ;;
    *"pulls?state=closed"*)
      cat <<'JSON'
[
  {
    "number": 101,
    "merged_at": "2026-09-24T00:00:00Z",
    "head": {"ref": "merged/rebased", "sha": "aaaa", "repo": {"full_name": "lazyxu/xdrive"}},
    "labels": []
  },
  {
    "number": 102,
    "merged_at": "2026-09-24T00:01:00Z",
    "head": {"ref": "advanced-branch", "sha": "bbbb", "repo": {"full_name": "lazyxu/xdrive"}},
    "labels": []
  },
  {
    "number": 103,
    "merged_at": "2026-09-24T00:02:00Z",
    "head": {"ref": "external-branch", "sha": "eeee", "repo": {"full_name": "someone/fork"}},
    "labels": []
  },
  {
    "number": 104,
    "merged_at": null,
    "head": {"ref": "superseded/closed", "sha": "ssss", "repo": {"full_name": "lazyxu/xdrive"}},
    "labels": [{"name": "superseded"}]
  },
  {
    "number": 105,
    "merged_at": null,
    "head": {"ref": "superseded/advanced", "sha": "tttt", "repo": {"full_name": "lazyxu/xdrive"}},
    "labels": [{"name": "superseded"}]
  },
  {
    "number": 106,
    "merged_at": null,
    "head": {"ref": "superseded/reused", "sha": "rrrr", "repo": {"full_name": "lazyxu/xdrive"}},
    "labels": [{"name": "superseded"}]
  },
  {
    "number": 107,
    "merged_at": null,
    "head": {"ref": "ordinary/closed", "sha": "vvvv", "repo": {"full_name": "lazyxu/xdrive"}},
    "labels": []
  },
  {
    "number": 108,
    "merged_at": null,
    "head": {"ref": "fork-superseded", "sha": "wwww", "repo": {"full_name": "someone/fork"}},
    "labels": [{"name": "superseded"}]
  }
]
JSON
      ;;
    *)
      echo "unexpected paginated endpoint: $endpoint" >&2
      exit 9
      ;;
  esac
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
  */git/ref/heads/superseded/closed) printf '%s\n' ssss ;;
  */git/ref/heads/superseded/advanced) printf '%s\n' uuuu ;;
  */git/ref/heads/superseded/reused) printf '%s\n' rrrr ;;
  */git/ref/heads/ordinary/closed) printf '%s\n' vvvv ;;
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
origin/ordinary/closed
origin/superseded/advanced
origin/superseded/closed
origin/superseded/reused
EOF
    ;;
  merge-base)
    [[ "${2:-}" == "--is-ancestor" ]] || exit 2
    case "${3:-}" in
      origin/ancestor-only|origin/active-branch|origin/superseded/reused) exit 0 ;;
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
grep -qx 'repos/lazyxu/xdrive/git/refs/heads/superseded/closed' "$DELETE_LOG"
grep -qx 'repos/lazyxu/xdrive/git/refs/heads/ancestor-only' "$DELETE_LOG"
[[ "$(wc -l < "$DELETE_LOG" | tr -d ' ')" == "3" ]]

! grep -q 'advanced-branch' "$DELETE_LOG"
! grep -q 'active-branch' "$DELETE_LOG"
! grep -q 'ordinary/closed' "$DELETE_LOG"
! grep -q 'superseded/advanced' "$DELETE_LOG"
! grep -q 'superseded/reused' "$DELETE_LOG"
! grep -q 'external-branch' "$DELETE_LOG"
! grep -q 'fork-superseded' "$DELETE_LOG"

grep -q 'keep active-branch — branch is used by an open PR' "$TMP/out"
grep -q 'keep superseded/reused — branch is used by an open PR' "$TMP/out"
grep -q 'removed 3 redundant branch(es)' "$TMP/out"

: > "$DELETE_LOG"
bash "$SCRIPT" --dry-run > "$TMP/dry-run.out"
[[ ! -s "$DELETE_LOG" ]]
grep -q 'cleanup: merged/rebased — tip matches merged PR head aaaa' "$TMP/dry-run.out"
grep -q 'cleanup: superseded/closed — tip matches closed superseded PR #104 head ssss' "$TMP/dry-run.out"
grep -q 'cleanup: ancestor-only — tip is already contained in master' "$TMP/dry-run.out"
grep -q 'removed 3 redundant branch(es)' "$TMP/dry-run.out"

echo "redundant branch cleanup tests passed"
