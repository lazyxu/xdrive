#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# A real local bare Git remote exercises CAS deletion rather than a mocked REST DELETE.
git init --bare -q "$tmp/origin.git"
git clone -q "$tmp/origin.git" "$tmp/work"
cd "$tmp/work"
git config user.name "Cleanup regression"
git config user.email "cleanup@example.invalid"
printf "base\n" > tracked.txt
git add tracked.txt
git commit -qm "baseline"
git branch -M master
git push -q -u origin master
git --git-dir="$tmp/origin.git" symbolic-ref HEAD refs/heads/master

git branch ancestor
git push -q origin ancestor
printf "main\n" >> tracked.txt
git commit -qam "master advance"
git push -q origin master

git switch -q -c equivalent-tree master
git commit -q --allow-empty -m "identical master tree"
git push -q origin equivalent-tree
git switch -q master

make_branch() {
  local name="$1"
  git switch -q -c "$name" master
  printf "%s\n" "$name" > "$name.txt"
  git add "$name.txt"
  git commit -qm "work on $name"
  git push -q origin "$name"
  git switch -q master
}
for name in merged-exact superseded retired retired-advanced protected-head protected-base unmerged-no-pr abandoned; do
  make_branch "$name"
done
old_retired_advanced="$(git rev-parse retired-advanced)"
git switch -q retired-advanced
printf "newer unreviewed commit\n" >> retired-advanced.txt
git commit -qam "advance branch after retirement approval"
git push -q origin retired-advanced
git switch -q master

cat > "$tmp/mock-gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  *"state=open"*)
    if [[ "${MOCK_BAD_OPEN:-}" == "1" ]]; then
      echo '{"message":"forbidden"}'
    else
      cat "$MOCK_OPEN"
    fi
    ;;
  *"state=closed"*) cat "$MOCK_CLOSED" ;;
  *) echo "unexpected gh api call: $*" >&2; exit 3 ;;
esac
EOF
chmod +x "$tmp/mock-gh"

cat > "$tmp/open.json" <<EOF
[{"number":71,"head":{"ref":"protected-head","sha":"$(git rev-parse protected-head)","repo":{"full_name":"lazyxu/xdrive"}},"base":{"ref":"protected-base","repo":{"full_name":"lazyxu/xdrive"}}}]
EOF
cat > "$tmp/closed.json" <<EOF
[
  {"number":72,"merged_at":"2026-10-22T00:00:00Z","head":{"ref":"merged-exact","sha":"$(git rev-parse merged-exact)","repo":{"full_name":"lazyxu/xdrive"}},"labels":[]},
  {"number":73,"merged_at":null,"head":{"ref":"superseded","sha":"$(git rev-parse superseded)","repo":{"full_name":"lazyxu/xdrive"}},"labels":[{"name":"superseded"}]},
  {"number":74,"merged_at":null,"head":{"ref":"abandoned","sha":"$(git rev-parse abandoned)","repo":{"full_name":"lazyxu/xdrive"}},"labels":[]}
]
EOF
printf "retired\t%s\tverified test branch\n" "$(git rev-parse retired)" > "$tmp/retired.tsv"
printf "retired-advanced\t%s\told head must never delete new work\n" "$old_retired_advanced" >> "$tmp/retired.tsv"

export GITHUB_REPOSITORY=lazyxu/xdrive
export GH_BIN="$tmp/mock-gh"
export MOCK_OPEN="$tmp/open.json"
export MOCK_CLOSED="$tmp/closed.json"
export XD_CLEANUP_RETIRED_MANIFEST="$tmp/retired.tsv"
export GITHUB_STEP_SUMMARY="$tmp/summary.md"

# Fail closed when the API responds with a 200 JSON error object.
if MOCK_BAD_OPEN=1 bash "$root/scripts/cleanup-merged-branches.sh" > "$tmp/invalid.log" 2>&1; then
  echo "cleanup accepted an invalid PR snapshot" >&2; exit 1
fi
grep -q "invalid open PR response" "$tmp/invalid.log"

# Dry run must not delete or move any ref.
bash "$root/scripts/cleanup-merged-branches.sh" --dry-run > "$tmp/dry-run.log"
for name in ancestor equivalent-tree merged-exact superseded retired; do
  [[ -n "$(git ls-remote --heads origin "refs/heads/$name")" ]] || {
    echo "Dry run removed $name" >&2; exit 1;
  }
done

# One real sweep deletes five redundant tips but preserves all unmerged work.
: > "$GITHUB_STEP_SUMMARY" # Discard the dry-run snapshot before checking real survivors.
bash "$root/scripts/cleanup-merged-branches.sh" > "$tmp/real-run.log"
grep -q "removed 5 redundant branch(es)" "$tmp/real-run.log"
for name in ancestor equivalent-tree merged-exact superseded retired; do
  [[ -z "$(git ls-remote --heads origin "refs/heads/$name")" ]] || {
    echo "Redundant ref survived: $name" >&2; exit 1;
  }
done
for name in master protected-head protected-base unmerged-no-pr abandoned retired-advanced; do
  [[ -n "$(git ls-remote --heads origin "refs/heads/$name")" ]] || {
    echo "Protected or advanced ref was deleted: $name" >&2; exit 1;
  }
done
for name in ancestor equivalent-tree merged-exact superseded retired; do
  if grep -Fq -- "\`$name\`" "$GITHUB_STEP_SUMMARY"; then
    echo "Cleanup summary includes deleted branch $name" >&2; exit 1
  fi
done
grep -q "open PR #71 base" "$GITHUB_STEP_SUMMARY"
grep -q "open PR #71 head" "$GITHUB_STEP_SUMMARY"
grep -q "current tip differs from reviewed retired head" "$tmp/real-run.log"
grep -Fq '`protected-head`' "$GITHUB_STEP_SUMMARY"
echo "cleanup: local Git regression passed (5 retired, 6 preserved, no unsafe dry run)"
