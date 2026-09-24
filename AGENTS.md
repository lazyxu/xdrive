# AGENTS.md

## Repository workflow

For every code change in this repository, use this workflow by default:

1. Run `git fetch origin` first.
2. Before creating or continuing a work branch, reconcile every non-`master` branch:
   - delete branches whose commits are already fully contained in `origin/master`;
   - inspect every unmerged branch for its diff, PR state, CI state, conflicts, and whether it contains unfinished work;
   - finish and merge safe in-progress work before starting unrelated work;
   - delete abandoned, duplicate, or superseded branches;
   - keep a branch only when there is a concrete reason it cannot yet be merged or deleted, and state that reason.
   Do not start a fresh implementation while an older viable half-finished branch for the same or related work is still unresolved.
3. After branch reconciliation, create a new short-lived branch from the latest `origin/master` only when no existing branch should be continued.
4. Make the requested change only on that branch.
5. Add or update relevant tests.
6. Run the applicable local tests and require them to pass before opening or updating the PR/MR.
7. Before the first PR/MR validation push, fetch `origin` again. Rebase onto `origin/master` only if `master` has actually advanced; do not perform no-op rebases merely to retrigger CI.
8. Before the final PR push, squash the work branch to exactly one commit relative to `origin/master`. Verify with:

   ```bash
   git rev-list --count origin/master..HEAD
   ```

   The result must be `1`. Do not merge a multi-commit work branch into `master`.
9. Push the branch and open or update the PR (or the corresponding GitLab MR when validating the GitLab mirror). The PR/MR CI run is the authoritative full validation for that source tree. Once it is green, do not push, rebase, amend, or otherwise retrigger CI unless the source tree must change.
10. If `origin/master` advances after CI is green, rebase only when required by repository rules or to resolve an actual conflict. A required rebase changes the tested commit and therefore requires the PR/MR CI to run again.
11. Merge the single-commit PR/MR into `master` using a linear-history merge.
12. After the merge succeeds, delete the merged remote branch.
13. Keep long-lived branches to a minimum.

## CI policy

- Full CI runs for GitHub pull requests or GitLab merge requests targeting `master`, and also for direct pushes to `master` on both providers. Ordinary pushes to short-lived feature/fix branches do not run full CI.
- GitHub `workflow_dispatch` and a GitLab Web/Run pipeline are the equivalent manual full-CI entry points.
- A successful PR/MR CI run is the pre-merge test gate. The subsequent `master` push intentionally runs the same full CI again on each provider as post-merge/mirror verification.
- Release and version-tag workflows should focus on build, packaging, signing, image publication, and release-specific validation.
- Release jobs should not rerun test suites that are already required by the full CI unless a test is specifically validating the produced release artifact.

## GitHub / GitLab CI parity

- `.github/workflows/ci.yml` and `.gitlab-ci.yml` are two front ends for the same CI contract. Any change to CI jobs, platform coverage, toolchain versions, test/build commands, Docker/deployment validation, trigger semantics, or merge gates must update both files in the same code change.
- Keep these jobs one-to-one across both systems: `single-commit`, `desktop-linux`, `desktop-windows`, `go-linux`, `go-windows`, and `web`.
- Keep trigger behavior equivalent: GitHub PR-to-`master` corresponds to GitLab MR-to-`master`; pushes to `master` run full CI on both providers; GitHub `workflow_dispatch` corresponds to a GitLab Web/Run pipeline; GitHub cancel-in-progress corresponds to GitLab interruptible auto-cancel.
- `internal/cicontract/ci_parity_test.go` is the executable parity guard. It parses both YAML files, requires the same job set and key commands, and is part of the normal Go test suites. Do not weaken or bypass it to make one CI provider diverge.
- GitLab jobs use the same literal runner tags as the established GitLab runner setup: `linux` for Linux jobs and `windows` for Windows jobs. Do not indirect these tags through CI/CD variables unless the runner topology itself changes.
- The GitLab Linux runner must be an x86_64 Linux shell runner with Bash, Git, Go 1.25.x, Node.js 22, npm, Docker Engine with Compose v2, Python 3, curl, and `dpkg-deb`; the runner user must be allowed to use Docker. The `go-linux` job uses a resource group because the deployment tests intentionally exercise real Docker Compose resources.
- The GitLab Windows runner must be a Windows shell runner using PowerShell with Go 1.25.x, Node.js 22, npm, Chocolatey, Windows CfAPI support, certificate creation/signing support, and permission to install/use Inno Setup.

## Master protection

- Never force-push `master` or rewrite its published history.
- Never use `git push --force`, `git push -f`, or `git push --force-with-lease` against `master`.
- Repository branch protection/rulesets for `master` must keep force pushes and branch deletion disabled.
- Normal changes must arrive through a tested short-lived branch/PR; do not bypass required CI checks.
- Force-pushing a work branch is allowed only when needed to squash/rebase that branch before merge, and only after verifying the target is not `master`.

Do not merge known failing or untested changes into `master`.

When multiple unmerged branches exist, process them sequentially. Prefer dependency order when one branch depends on another; otherwise use the oldest appropriate branch first. For each branch, update it from the latest `master` only when needed, keep it at exactly one commit, require its PR CI to pass, merge it, delete it, then continue with the next branch. Avoid rebasing an already-green PR solely to create another CI run.

Prefer small, focused branches and a single final commit to minimize conflicts and keep `master` history reviewable.
