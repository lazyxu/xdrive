#!/usr/bin/env bash
set -euo pipefail

repo="${GITHUB_REPOSITORY:-}"
default_branch="${XD_CLEANUP_DEFAULT_BRANCH:-master}"
GH_BIN="${GH_BIN:-gh}"
GIT_BIN="${GIT_BIN:-git}"
dry_run=0

usage() {
  cat <<'EOF'
Usage: cleanup-merged-branches.sh [--dry-run]

Deletes only remote branches that are provably redundant:
  1. the current branch tip exactly matches the head SHA of a merged PR from
     this repository; or
  2. the current branch tip is already an ancestor of origin/master.

The default branch is never deleted.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) dry_run=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ -n "$repo" ]] || { echo "GITHUB_REPOSITORY is required" >&2; exit 2; }
command -v "$GH_BIN" >/dev/null 2>&1 || { echo "$GH_BIN is required" >&2; exit 1; }
command -v "$GIT_BIN" >/dev/null 2>&1 || { echo "$GIT_BIN is required" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 1; }

declare -A deleted=()

current_ref_sha() {
  local branch="$1"
  "$GH_BIN" api "repos/$repo/git/ref/heads/$branch" --jq '.object.sha' 2>/dev/null || true
}

delete_branch() {
  local branch="$1" reason="$2"
  [[ -n "$branch" ]] || return 0
  [[ "$branch" != "$default_branch" ]] || return 0
  [[ -z "${deleted[$branch]+x}" ]] || return 0

  echo "cleanup: $branch — $reason"
  if [[ "$dry_run" != "1" ]]; then
    "$GH_BIN" api --method DELETE "repos/$repo/git/refs/heads/$branch" >/dev/null
  fi
  deleted["$branch"]=1
}

# Rebase merges intentionally create new commit SHAs on the default branch, so
# ancestry alone cannot identify their source branches. A source branch is safe
# to remove when its current tip still exactly equals a merged PR's recorded
# head SHA.
while IFS=$'\t' read -r branch merged_sha; do
  [[ -n "$branch" && -n "$merged_sha" ]] || continue
  [[ "$branch" != "$default_branch" ]] || continue
  current_sha="$(current_ref_sha "$branch")"
  if [[ -n "$current_sha" && "$current_sha" == "$merged_sha" ]]; then
    delete_branch "$branch" "tip matches merged PR head $merged_sha"
  fi
done < <(
  "$GH_BIN" api --paginate "repos/$repo/pulls?state=closed&per_page=100" |
    jq -r --arg repo "$repo" '
      .[]
      | select(.merged_at != null)
      | select(.head.repo.full_name == $repo)
      | [.head.ref, .head.sha]
      | @tsv
    '
)

# Also catch branches that were merged without a PR or fast-forwarded into
# master. Fetch after the PR cleanup so deleted refs disappear from origin/*.
"$GIT_BIN" fetch --prune origin '+refs/heads/*:refs/remotes/origin/*' >/dev/null
while IFS= read -r remote; do
  [[ -n "$remote" ]] || continue
  branch="${remote#origin/}"
  [[ "$branch" != "HEAD" && "$branch" != "$default_branch" ]] || continue
  [[ -z "${deleted[$branch]+x}" ]] || continue
  if "$GIT_BIN" merge-base --is-ancestor "$remote" "origin/$default_branch"; then
    delete_branch "$branch" "tip is already contained in $default_branch"
  fi
done < <("$GIT_BIN" for-each-ref --format='%(refname:short)' refs/remotes/origin)

echo "cleanup: removed ${#deleted[@]} redundant branch(es)"
