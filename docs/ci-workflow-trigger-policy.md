# GitHub Actions: avoid unrelated Skipped workflow runs

## Why the Actions page was flooded

`pull_request.branches: [master]` matches the PR **base**, not the feature
branch. A branch-only `jobs.if: github.head_ref == 'some-test-branch'` does
not suppress the workflow run: GitHub creates the run, evaluates its job and
marks it **Skipped**. Reopening a PR can therefore create hundreds of empty
runs even though nothing was actually tested.

## Repository policy

- **Normal PR / Snapshot / stable:** `.github/workflows/ci.yml` remains
  always-on and retains complete source, artifact, security and Final Gate.
- **One-off performance and evidence work:** keep branch-specific job gates
  and limit `pull_request.paths` to the test fixture or narrow source files
  that activate the scenario. PRs changing unrelated Android/Web/Server code
  must not create a run for that old experiment.
- **Stacked PRs:** preserve original supported base branches and the exact
  owner/target branch guard. Restrict the event using `paths`, not by deleting
  necessary review or regression cases.
- **Explicit one-off runs:** use an existing `workflow_dispatch` when its
  code supports non-PR event context. Do not silently change historical PR
  fixtures that need `github.event.pull_request` into push/dispatch events.
  A missing dispatch entrypoint should be added with a source-exact reviewed
  follow-up rather than simulated with a skip-only button.
- Do not manipulate workflows/PR state solely to get extra green/skipped
  records. The evidence is the **conclusion for the exact SHA**, not the
  number of rows in Actions.

## Core CI job inventory (2026-10-27)

A 2026-10-27 audit found 50 one-off jobs inside the broadly triggered `ci.yml` which ran only when `github.head_ref` matched now-absent experimental branches. With no matching live branch or open PR, these jobs created 50 `Skipped` entries per `master` run without executing tests. They were removed from the GitHub CI job graph and from the matching GitLab branch-only job graph to preserve the enforced GitHub/GitLab parity contract, not from the underlying benchmark/test files or Git history. All 30 GitHub continuous/branch-relevant jobs (including `final-gate` and both release paths) and all 25 GitLab core jobs were retained with their job bodies and dependencies unchanged.

Do not reintroduce branch-exclusive performance/evidence experiments in `ci.yml`. For an active experiment, use a standalone PR workflow with narrow `pull_request.paths` and an exact source-ref guard, or implement a safely reviewed `workflow_dispatch`. Existing evidence remains accessible in the historical commit and Actions artifacts. Changing the CI graph does not cancel existing queued runs or erase old Skipped checks; new runs use the new workflow graph only.

## Repeated PR synchronizations and job backlogs

A pull request whose diff matches several standalone workflows will enqueue
all of them after each head update (even if the latest individual commit did
not modify those paths). Path scoping alone cannot cancel older SHA runs.
Use workflow-level PR-specific cancellation, without sacrificing independent
`master`/tag/manual run artifacts:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.run_id }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

Do not share group keys between different workflows, and do not key master
runs only by branch: an adjacent snapshot must not evict another snapshot's
build or release prerequisite. Historical completed/cancelled runs stay in
GitHub's audit history. Do not rewrite PR heads simply to retrigger CI;
check the unchanged source diff and existing passing evidence first.

## Retire queued CI after a PR merges

A merged pull request may still have an expensive `CI` run marked queued
while late Windows/Linux artifact jobs are pending. The trusted
`.github/workflows/cancel-merged-pr-queued-ci.yml` handles only
`pull_request_target: closed` for a merged same-repository PR into `master`.
It retrieves the current PR from GitHub, verifies the exact head SHA and
branch, then rechecks each **still queued** `pull_request` `CI` run before
requesting cancellation. It never cancels master pushes, running checks, other
workflows, or an unmerged PR.

Each cancellation workflow uses a concurrency key containing the **PR number**,
so a different merged PR cannot displace the single pending cancellation slot.
This is deliberately separate from the globally serialized, more expensive
branch-prune scan. GitHub's group with `cancel-in-progress: false` still
replaces an older pending run when more than one run queues in the same group.
The branch-prune workflow therefore no longer has `actions: write`; the
lightweight trusted cancellation workflow owns that minimal added permission,
checks out only default-branch source with credential persistence disabled,
and executes the exact-head selector unit tests.

Cancellation is best-effort queue hygiene, **not** a green CI check or approval
to bypass GitHub branch rules. An already-running PR test remains untouched.

## Verification

```sh
python3 scripts/ci/check_workflow_pr_scope.py
python3 -m unittest discover -s scripts/ci -p 'test_workflow_pr_scope.py'
```

The first command rejects unrestricted standalone PR workflows, including
`pull_request: {}`, wildcard scopes and fixtureless path filters. The second
tests that broad triggers are detected and that an unrelated Android PR
cannot match an old CAS-only benchmark fixture.

GitHub may still show **historical** Skipped runs: this change only prevents
future unrelated event matches; it does not delete old run history or disable
tests intentionally associated with a changed fixture.
