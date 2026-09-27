#!/usr/bin/env bash
set -euo pipefail

repo="${GITHUB_REPOSITORY:-}"
default_branch="${XD_CLEANUP_DEFAULT_BRANCH:-master}"
superseded_label="${XD_CLEANUP_SUPERSEDED_LABEL:-superseded}"
GH_BIN="${GH_BIN:-gh}"
GIT_BIN="${GIT_BIN:-git}"
dry_run=0

usage() {
  cat <<'EOF'
Usage: cleanup-merged-branches.sh [--dry-run]

Deletes only remote branches that are provably redundant:
  1. the current branch tip exactly matches the head SHA of a merged PR from
     this repository;
  2. a PR from this repository is closed without merge, is explicitly labeled
     "superseded", and the current branch tip still exactly matches that PR's
     recorded head SHA; or
  3. the current branch tip is already an ancestor of origin/master.

A branch used by any open PR from this repository is never deleted, even if it
otherwise matches one of the rules above. The default branch is never deleted.
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
[[ -n "$superseded_label" ]] || { echo "XD_CLEANUP_SUPERSEDED_LABEL must not be empty" >&2; exit 2; }
command -v "$GH_BIN" >/dev/null 2>&1 || { echo "$GH_BIN is required" >&2; exit 1; }
command -v "$GIT_BIN" >/dev/null 2>&1 || { echo "$GIT_BIN is required" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 1; }

declare -A deleted=()
declare -A open_pr_branches=()

current_ref_sha() {
  local branch="$1"
  "$GH_BIN" api "repos/$repo/git/ref/heads/$branch" --jq '.object.sha' 2>/dev/null || true
}

# Protect every same-repository branch currently used by an open PR. This guard
# applies to all deletion rules, including ancestry cleanup and branch-name reuse
# after an older PR was merged or superseded.
while IFS= read -r branch; do
  [[ -n "$branch" ]] || continue
  open_pr_branches["$branch"]=1
done < <(
  "$GH_BIN" api --paginate "repos/$repo/pulls?state=open&per_page=100" |
    jq -r --arg repo "$repo" '
      .[]
      | select(.head.repo.full_name == $repo)
      | .head.ref
    '
)

delete_branch() {
  local branch="$1" reason="$2"
  [[ -n "$branch" ]] || return 0
  [[ "$branch" != "$default_branch" ]] || return 0
  [[ -z "${deleted[$branch]+x}" ]] || return 0
  if [[ -n "${open_pr_branches[$branch]+x}" ]]; then
    echo "cleanup: keep $branch — branch is used by an open PR"
    return 0
  fi

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

# Closed-but-unmerged work is not normally safe to delete. The one explicit
# exception is an in-repository PR carrying the configured superseded label.
# Even then, require its branch tip to still equal the PR's recorded head SHA so
# a branch reused or advanced after closure cannot be removed accidentally.
while IFS=$'\t' read -r branch superseded_sha pr_number; do
  [[ -n "$branch" && -n "$superseded_sha" && -n "$pr_number" ]] || continue
  [[ "$branch" != "$default_branch" ]] || continue
  current_sha="$(current_ref_sha "$branch")"
  if [[ -n "$current_sha" && "$current_sha" == "$superseded_sha" ]]; then
    delete_branch "$branch" "tip matches closed superseded PR #$pr_number head $superseded_sha"
  fi
done < <(
  "$GH_BIN" api --paginate "repos/$repo/pulls?state=closed&per_page=100" |
    jq -r --arg repo "$repo" --arg label "$superseded_label" '
      .[]
      | select(.merged_at == null)
      | select(.head.repo.full_name == $repo)
      | select(any(.labels[]?; .name == $label))
      | [.head.ref, .head.sha, (.number | tostring)]
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
