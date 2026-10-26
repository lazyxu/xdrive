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
