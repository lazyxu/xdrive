#!/usr/bin/env bash
set -euo pipefail

repo="${GITHUB_REPOSITORY:-}"
default_branch="${XD_CLEANUP_DEFAULT_BRANCH:-master}"
superseded_label="${XD_CLEANUP_SUPERSEDED_LABEL:-superseded}"
GH_BIN="${GH_BIN:-gh}"
GIT_BIN="${GIT_BIN:-git}"
dry_run=0
retired_manifest="${XD_CLEANUP_RETIRED_MANIFEST:-.github/retired-branches.tsv}"

usage() {
  cat <<'EOF'
Usage: cleanup-merged-branches.sh [--dry-run]

Scan mode removes only proven-redundant branches:
  - current tip is the exact head of a merged pull request;
  - current tip is the exact head of a closed, explicitly superseded pull request;
  - current tip is an ancestor of master or its tree is identical to master;
  - branch + full tip SHA appear in the reviewed retirement manifest.

Never delete master, a branch used as an open PR head or base, an advanced
branch, or one whose remote tip changed since inspection. A failed PR
inventory or deletion check stops the job instead of guessing.
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
command -v "$GIT_BIN" >/dev/null 2>&1 || { echo "$GIT_BIN is required" >&2; exit 1; }
[[ -n "$superseded_label" ]] || { echo "XD_CLEANUP_SUPERSEDED_LABEL must not be empty" >&2; exit 2; }
command -v "$GH_BIN" >/dev/null 2>&1 || { echo "$GH_BIN is required" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 1; }

declare -A deleted=()
declare -A open_pr_branches=()
declare -A open_pr_bases=()

# GitHub App API rate limits previously made 'gh api | jq' inside a process
# substitution silently fail while the scan still reported success. Fetch
# both authoritative PR lists *before* any possible branch deletion, with
# checked status and schema, then parse the immutable local snapshots.
pr_snapshot_dir="$(mktemp -d)"
trap 'rm -rf "$pr_snapshot_dir"' EXIT
load_pr_snapshot() {
  local state="$1" output="$pr_snapshot_dir/$1.json"
  if ! "$GH_BIN" api --paginate "repos/$repo/pulls?state=$state&per_page=100" > "$output"; then
    echo "cleanup: unable to list $state PRs; refusing branch scan" >&2
    exit 1
  fi
  # --paginate produces one JSON array per response page, not one giant array.
  # Missing, truncated or error-object responses cannot establish safe cleanup.
  if ! jq -s -e '
    length > 0 and all(.[];
      type == "array" and all(.[];
        type == "object" and
        (.head | type) == "object" and
        (.head.ref | type) == "string" and
        (.head.sha | type) == "string"
      )
    )
  ' "$output" >/dev/null; then
    echo "cleanup: invalid $state PR response; refusing branch scan" >&2
    exit 1
  fi
}
load_pr_snapshot open
load_pr_snapshot closed

# One checked remote snapshot; never make thousands of branch-ref API requests.
"$GIT_BIN" fetch --prune origin '+refs/heads/*:refs/remotes/origin/*' >/dev/null

current_ref_sha() {
  local branch="$1"
  "$GIT_BIN" rev-parse --verify -q "refs/remotes/origin/$branch" 2>/dev/null || true
}

# Protect same-repository open PR heads AND bases (stacked PRs target other
# feature branches). These protections apply to every deletion category.
while IFS=$'\t' read -r branch number; do
  [[ -n "$branch" ]] || continue
  open_pr_branches["$branch"]="$number"
done < <(
  jq -r -s --arg repo "$repo" '
    .[][] | select(.head.repo.full_name == $repo)
    | [.head.ref, (.number | tostring)] | @tsv
  ' "$pr_snapshot_dir/open.json"
)
while IFS=$'\t' read -r branch number; do
  [[ -n "$branch" ]] || continue
  open_pr_bases["$branch"]="$number"
done < <(
  jq -r -s --arg repo "$repo" '
    .[][] | select(.base.repo.full_name == $repo)
    | [.base.ref, (.number | tostring)] | @tsv
  ' "$pr_snapshot_dir/open.json"
)

delete_branch() {
  local branch="$1" reason="$2" expected_sha
  [[ -n "$branch" ]] || return 0
  [[ "$branch" != "$default_branch" ]] || return 0
  [[ -z "${deleted[$branch]+x}" ]] || return 0
  if [[ -n "${open_pr_branches[$branch]+x}" ]]; then
    echo "cleanup: keep $branch — open PR #${open_pr_branches[$branch]} head"
    return 0
  fi
  if [[ -n "${open_pr_bases[$branch]+x}" ]]; then
    echo "cleanup: keep $branch — open PR #${open_pr_bases[$branch]} base"
    return 0
  fi
  expected_sha="$(current_ref_sha "$branch")"
  [[ -n "$expected_sha" ]] || return 0
  echo "cleanup: $branch — $reason ($expected_sha)"
  if [[ "$dry_run" != "1" ]]; then
    # CAS-style remote deletion: reject if a concurrent contributor moved HEAD.
    if ! "$GIT_BIN" push "--force-with-lease=refs/heads/$branch:$expected_sha" \
      origin ":refs/heads/$branch" >/dev/null; then
      local remote_state
      if ! remote_state="$("$GIT_BIN" ls-remote --heads origin "refs/heads/$branch")"; then
        echo "cleanup: cannot establish new remote state for $branch" >&2
        return 1
      fi
      if [[ -n "$remote_state" ]]; then
        echo "cleanup: $branch still exists, moved or delete was rejected; aborting" >&2
        return 1
      fi
      echo "cleanup: $branch was removed by another cleanup job"
    fi
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
  jq -r -s --arg repo "$repo" '
      .[][]
      | select(.merged_at != null)
      | select(.head.repo.full_name == $repo)
      | [.head.ref, .head.sha]
      | @tsv
    ' "$pr_snapshot_dir/closed.json"
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
  jq -r -s --arg repo "$repo" --arg label_name "$superseded_label" '
      .[][]
      | select(.merged_at == null)
      | select(.head.repo.full_name == $repo)
      | select(any(.labels[]?; .name == $label_name))
      | [.head.ref, .head.sha, (.number | tostring)]
      | @tsv
    ' "$pr_snapshot_dir/closed.json"
)

# Review-owned SHA-pinned retirement entries cover abandoned branches without PRs.
# Never delete by branch-name alone; open PR and default-branch guards are shared.
if [[ -f "$retired_manifest" ]]; then
  while IFS=$'\t' read -r branch retired_sha reason || [[ -n "$branch" ]]; do
    [[ -n "$branch" && "${branch:0:1}" != "#" ]] || continue
    if [[ ! "$retired_sha" =~ ^[0-9a-fA-F]{40}$ ]] ||
       ! "$GIT_BIN" check-ref-format "refs/heads/$branch" >/dev/null 2>&1; then
      echo "cleanup: invalid retired branch entry: $branch" >&2
      exit 2
    fi
    if [[ "$branch" == "$default_branch" ]]; then
      echo "cleanup: keep $branch — default branch is never deleted"
      continue
    fi
    current_sha="$(current_ref_sha "$branch")"
    if [[ "$current_sha" == "$retired_sha" ]]; then
      delete_branch "$branch" "tip matches reviewed retired head $retired_sha"
    elif [[ -n "$current_sha" ]]; then
      echo "cleanup: keep $branch — current tip differs from reviewed retired head"
    fi
  done < "$retired_manifest"
fi

# Also catch fully contained or tree-identical branches. Refresh after the PR
# cleanup so deleted refs disappear from origin/*.
"$GIT_BIN" fetch --prune origin '+refs/heads/*:refs/remotes/origin/*' >/dev/null
while IFS= read -r remote; do
  [[ -n "$remote" ]] || continue
  branch="${remote#origin/}"
  [[ "$branch" != "HEAD" && "$branch" != "$default_branch" ]] || continue
  [[ -z "${deleted[$branch]+x}" ]] || continue
  if "$GIT_BIN" merge-base --is-ancestor "$remote" "origin/$default_branch"; then
    delete_branch "$branch" "tip is already contained in $default_branch"
  elif "$GIT_BIN" diff --quiet "origin/$default_branch" "$remote" --; then
    delete_branch "$branch" "complete tree is identical to $default_branch"
  fi
done < <("$GIT_BIN" for-each-ref --format='%(refname:short)' refs/remotes/origin)

if [[ "$dry_run" == "1" ]]; then
  echo "cleanup: dry-run proposed ${#deleted[@]} redundant branch(es)"
else
  echo "cleanup: removed ${#deleted[@]} redundant branch(es)"
fi
# Refresh after the final wave of safe deletions so the audit table is a
# faithful remote branch inventory, not stale origin/* tracking refs.
"$GIT_BIN" fetch --prune origin '+refs/heads/*:refs/remotes/origin/*' >/dev/null

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "## xDrive branch cleanup"
    echo
    echo "- Deleted (or dry-run proposed): ${#deleted[@]}"
    echo "- Protected open PR heads: ${#open_pr_branches[@]}"
    echo "- Protected open PR bases: ${#open_pr_bases[@]}"
    echo
    echo "| Remaining branch | Ahead of master | Behind master | Reason kept |"
    echo "| --- | ---: | ---: | --- |"
    while IFS= read -r remote; do
      [[ -n "$remote" && "$remote" != "origin/HEAD" ]] || continue
      local_name="${remote#origin/}"
      ahead=0; behind=0
      if [[ "$local_name" != "$default_branch" ]]; then
        read -r behind ahead < <("$GIT_BIN" rev-list --left-right --count "origin/$default_branch...$remote")
      fi
      why="unique or unreviewed work; preserved"
      if [[ "$local_name" == "$default_branch" ]]; then
        why="protected default branch"
      elif [[ -n "${open_pr_branches[$local_name]+x}" ]]; then
        why="open PR #${open_pr_branches[$local_name]} head"
      elif [[ -n "${open_pr_bases[$local_name]+x}" ]]; then
        why="open PR #${open_pr_bases[$local_name]} base"
      fi
      printf '| `%s` | %s | %s | %s |\n' "$local_name" "$ahead" "$behind" "$why"
    done < <("$GIT_BIN" for-each-ref --format='%(refname:short)' refs/remotes/origin)
  } >> "$GITHUB_STEP_SUMMARY"
fi
