# AGENTS.md

## Repository workflow

For every code change in this repository, use this workflow by default:

1. Run `git fetch origin` first.
2. Create a new short-lived branch from the latest `origin/master`.
3. Make the requested change only on that branch.
4. Add or update relevant tests.
5. Run the applicable tests and require them to pass.
6. Before merging, fetch again and rebase the branch onto the latest `origin/master`.
7. After rebasing, either rerun the relevant tests or verify that the final source tree is byte-for-byte identical to the already tested tree.
8. **Before the final merge, squash the work branch to exactly one commit relative to `origin/master`.** Verify with:

   ```bash
   git rev-list --count origin/master..HEAD
   ```

   The result must be `1`. Do not merge a multi-commit work branch into `master`.
9. Merge that single commit into `master` using a linear-history merge.
10. After the merge succeeds, delete the merged remote branch.
11. Keep long-lived branches to a minimum.

## Master protection

- Never force-push `master` or rewrite its published history.
- Never use `git push --force`, `git push -f`, or `git push --force-with-lease` against `master`.
- Repository branch protection/rulesets for `master` must keep force pushes and branch deletion disabled.
- Normal changes must arrive through a tested short-lived branch/PR; do not bypass required CI checks.
- Force-pushing a work branch is allowed only when needed to squash/rebase that branch before merge, and only after verifying the target is not `master`.

Do not merge known failing or untested changes into `master`.

When multiple unmerged branches exist, process them sequentially. Prefer dependency order when one branch depends on another; otherwise use the oldest appropriate branch first. For each branch: rebase it onto the latest `master`, test it, squash it to one commit, verify the commit count is exactly one, merge it, delete it, then continue with the next branch.

Prefer small, focused branches and a single final commit to minimize conflicts and keep `master` history reviewable.
