# AGENTS.md

## Repository workflow

For every code change in this repository, use this workflow by default:

1. Run `git fetch origin` first.
2. Create a new branch from the latest `origin/master`.
3. Make the requested change only on that branch.
4. Add or update relevant tests.
5. Run the applicable tests and require them to pass.
6. Before merging, fetch again and rebase the branch onto the latest `origin/master`.
7. After rebasing, either:
   - run the relevant tests again; or
   - when the rebase changed only Git history, verify that the final source tree is byte-for-byte identical to the already tested tree.
8. Merge into `master` using **rebase merge**.
9. After the merge succeeds, delete the merged remote branch.
10. Keep long-lived branches to a minimum.

Do not merge known failing or untested changes into `master`.

When multiple unmerged branches exist, process them sequentially. Prefer dependency order when one branch depends on another; otherwise use the oldest appropriate branch first. For each branch: rebase it onto the latest `master`, test it, rebase-merge it, delete it, then continue with the next branch.

Prefer small, focused branches and commits to minimize conflicts.
