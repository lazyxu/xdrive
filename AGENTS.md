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
- GitHub `.github/workflows/release.yml` and GitLab `infra/ci/gitlab-release.yml` implement the same release contract. A master push must pass full CI before producing a commit-specific snapshot release; a `v*` tag must pass full CI before producing a formal release. GitLab enforces this with stage ordering; GitHub Build Packages explicitly waits for the successful `CI` push run with the same commit SHA before any package job can proceed.
- Release-grade GitHub and GitLab builds must publish the same named file set, use the same release/desktop version semantics, generate `SHA256SUMS.txt`, and build the same three server images. The registries and exact binary hashes may differ because the providers, signing environment, timestamps, and build hosts differ.
- GitLab keeps release-job artifacts for 14 days for pipeline access, but durable release files are uploaded to the GitLab Generic Package Registry and attached to the GitLab Release. Do not use expiring job-artifact URLs as the long-term release source.
- The server installer supports both registries. GitHub release artifacts bake `ghcr.io/<owner>` as the default image registry; GitLab release artifacts bake `$CI_REGISTRY_IMAGE`. At runtime, `XD_IMAGE_REGISTRY` overrides either default. Do not implement silent cross-registry failover.
- Stable `v*` Windows releases require `XD_WINDOWS_SIGN_PFX_B64` and `XD_WINDOWS_SIGN_PFX_PASSWORD` on both providers. Master snapshots may be unsigned when those secrets are unavailable.

## GitHub / GitLab CI parity

- `.github/workflows/ci.yml` and `.gitlab-ci.yml` are two front ends for the same CI contract. Any change to CI jobs, platform coverage, toolchain versions, test/build commands, Docker/deployment validation, trigger semantics, or merge gates must update both files in the same code change.
- Keep these jobs one-to-one across both systems: `single-commit`, `desktop-linux`, `desktop-windows`, `go-linux`, `go-windows`, and `web`.
- Keep trigger behavior equivalent: GitHub PR-to-`master` corresponds to GitLab MR-to-`master`; pushes to `master` run full CI on both providers; `v*` tags run full CI before release packaging on both providers; GitHub `workflow_dispatch` corresponds to a GitLab Web/Run pipeline; GitHub cancel-in-progress corresponds to GitLab interruptible auto-cancel.
- `internal/cicontract/ci_parity_test.go` is the executable parity guard. It parses both YAML files, requires the same job set and key commands, and is part of the normal Go test suites. Do not weaken or bypass it to make one CI provider diverge.
- GitLab jobs use the same literal runner tags as the established GitLab runner setup: `linux` for Linux jobs and `windows` for Windows jobs. Do not indirect these tags through CI/CD variables unless the runner topology itself changes.
- GitLab Linux jobs must run in explicit Docker images, following the same pattern as the established GitLab project. Centralize image names and pinned Linux tool versions in `infra/ci/images.yml`; do not fall back to tools installed on the Linux runner host.
- The `linux` runner must use the Docker executor (or an equivalent container executor that honors GitLab's `image:` keyword). It must be x86_64 and provide access to a Docker daemon for jobs that execute `docker build`, `docker run`, or `docker compose`. With Docker socket binding, mount `/var/run/docker.sock` into job containers; an explicitly configured DinD endpoint is also acceptable. The job image provides Go/Node/Docker CLI tooling; the runner host should not be treated as the toolchain.
- The `go-linux` job uses a resource group because deployment tests intentionally exercise real Docker resources. `single-commit` and `go-linux` use the Go CI image; `desktop-linux` and `web` use the Node CI image. Windows jobs intentionally have no Linux `image:` and continue on the `windows` runner.
- Electron packaging commands must pass `--publish never` in normal CI/build scripts; publishing is handled by the repository release workflow, not implicitly by electron-builder. GitLab uses `ELECTRON_MIRROR` and `ELECTRON_BUILDER_BINARIES_MIRROR` from `infra/ci/images.yml` for release-asset downloads, and Linux Electron/builder binary caches live under `$CI_PROJECT_DIR/.cache`. These mirror variables may be overridden by GitLab project/group CI/CD variables when an internal mirror is available.
- GitLab CI defaults to mainland-China-friendly dependency endpoints: `GOPROXY` falls back from goproxy.cn to Aliyun, then proxy.golang.org and direct on any error; `GOSUMDB=sum.golang.google.cn` preserves Go checksum verification; Node binaries prefer Huawei Cloud; Docker CLI prefers Aliyun; npm uses npmmirror. Official sources remain fallbacks. `HTTPS_PROXY`/`HTTP_PROXY` are honored normally, and `XDRIVE_CI_GITHUB_RELEASE_PROXY` may prefix GitHub Release downloads when an organization-approved proxy is available.
- Large CI tool downloads must use `scripts/ci/download-with-fallback.sh` so interrupted downloads resume, retry, and fall back between mirrors. Partial tool downloads and Go/npm caches live under `$CI_PROJECT_DIR/.cache`; GitLab caches them with `when: always` so a failed pipeline can resume on the same runner instead of restarting from zero.
- Go 1.25 is the minimum supported toolchain baseline, not an exact CI-only version. GitHub continues to run Go 1.25.x to validate that minimum; self-hosted GitLab runners may use Go 1.25 or newer. CI uses `go mod tidy -go=1.25` so a newer runner toolchain does not raise the module compatibility baseline.
- The GitLab Windows runner is a Windows Shell executor configured with Bash/Git Bash. GitLab `script:` entries for Windows jobs must therefore be Bash commands; do not place raw PowerShell syntax directly in `.gitlab-ci.yml`. Use Bash wrapper scripts and invoke `powershell.exe` explicitly only for Windows-native operations such as certificate creation, Authenticode validation, registry checks, and installer smoke tests. The runner must provide Go >= 1.25, Node.js 22, npm, Git Bash, Windows PowerShell, Chocolatey, Windows CfAPI support, certificate creation/signing support, and permission to install/use Inno Setup.

## Master protection

- Never force-push `master` or rewrite its published history.
- Never use `git push --force`, `git push -f`, or `git push --force-with-lease` against `master`.
- Repository branch protection/rulesets for `master` must keep force pushes and branch deletion disabled.
- Normal changes must arrive through a tested short-lived branch/PR; do not bypass required CI checks.
- Force-pushing a work branch is allowed only when needed to squash/rebase that branch before merge, and only after verifying the target is not `master`.

Do not merge known failing or untested changes into `master`.

When multiple unmerged branches exist, process them sequentially. Prefer dependency order when one branch depends on another; otherwise use the oldest appropriate branch first. For each branch, update it from the latest `master` only when needed, keep it at exactly one commit, require its PR CI to pass, merge it, delete it, then continue with the next branch. Avoid rebasing an already-green PR solely to create another CI run.

Prefer small, focused branches and a single final commit to minimize conflicts and keep `master` history reviewable.
