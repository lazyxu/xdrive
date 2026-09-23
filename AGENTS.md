# AGENTS.md

## Repository workflow

For every code change in this repository, use this workflow by default:

1. Run `git fetch origin` first.
2. Create a new short-lived branch from the latest `origin/master`.
3. Make the requested change only on that branch.
4. Add or update relevant tests.
5. Run the applicable local tests and require them to pass before opening or updating the PR.
6. Before the first PR push, fetch `origin` again. Rebase onto `origin/master` only if `master` has actually advanced; do not perform no-op rebases merely to retrigger CI.
7. Before the final PR push, squash the work branch to exactly one commit relative to `origin/master`. Verify with:

   ```bash
   git rev-list --count origin/master..HEAD
   ```

   The result must be `1`. Do not merge a multi-commit work branch into `master`.
8. Push the branch and open or update the PR. The PR CI run is the authoritative full validation for that source tree. Once it is green, do not push, rebase, amend, or otherwise retrigger CI unless the source tree must change.
9. If `origin/master` advances after CI is green, rebase only when required by repository rules or to resolve an actual conflict. A required rebase changes the tested commit and therefore requires the PR CI to run again.
10. Merge the single-commit PR into `master` using a linear-history merge.
11. After the merge succeeds, delete the merged remote branch.
12. Keep long-lived branches to a minimum.

## CI policy

- Full CI runs for pull requests targeting `master`, not for ordinary pushes to short-lived feature/fix branches.
- `workflow_dispatch` may be used when an explicit manual full-CI run is needed.
- A successful PR CI run is the normal test gate. Do not duplicate the same full test suite on the subsequent `master` push.
- `master` and version-tag workflows should focus on build, packaging, signing, image publication, and release-specific validation.
- Release jobs should not rerun test suites that are already required by PR CI unless a test is specifically validating the produced release artifact.

## Master protection

- Never force-push `master` or rewrite its published history.
- Never use `git push --force`, `git push -f`, or `git push --force-with-lease` against `master`.
- Repository branch protection/rulesets for `master` must keep force pushes and branch deletion disabled.
- Normal changes must arrive through a tested short-lived branch/PR; do not bypass required CI checks.
- Force-pushing a work branch is allowed only when needed to squash/rebase that branch before merge, and only after verifying the target is not `master`.

Do not merge known failing or untested changes into `master`.

When multiple unmerged branches exist, process them sequentially. Prefer dependency order when one branch depends on another; otherwise use the oldest appropriate branch first. For each branch, update it from the latest `master` only when needed, keep it at exactly one commit, require its PR CI to pass, merge it, delete it, then continue with the next branch. Avoid rebasing an already-green PR solely to create another CI run.

Prefer small, focused branches and a single final commit to minimize conflicts and keep `master` history reviewable.
