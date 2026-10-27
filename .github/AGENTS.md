# GitHub Actions scope rules (apply inside .github/)

This scoped instruction supplements, and does not replace, the repository-root
AGENTS.md. Preserve the root policy and all other work.

- Keep the primary .github/workflows/ci.yml subscribed to every PR; it is the
  only intentionally broad PR CI workflow in this repository.
- Keep one-off historical / branch-only benchmarks OUT of that always-on CI jobs graph, even when gated by `github.head_ref`; inactive one-off branch jobs create `Skipped` entries on every master push. Preserve regular Go/Web/Desktop/Android, security, artifact, release and Final Gate jobs. Use a narrowly path-scoped standalone PR workflow for active experiments, or a reviewed manual workflow for genuine one-off reproduction.
- A standalone benchmark, performance diagnosis, historical evidence or
  branch-specific experiment must NOT use a broad `on.pull_request` plus a
  `jobs.<job>.if: github.head_ref == ...` guard. That still creates a Skipped
  workflow entry for every unrelated PR, especially when a PR is reopened.
- Use `on.pull_request.paths` scoped to the experiment's specific test or
  fixture files. Preserve any established base-branch guards and job-level
  identity checks. For experiments that cannot be safely scoped, prefer an
  explicit `workflow_dispatch` with reviewed exact-ref semantics.
- Never put catch-all `**` under one-off PR triggers, or use only the workflow
  YAML's own path as a trigger.
- New workflow definitions and edits must pass
  `python3 scripts/ci/check_workflow_pr_scope.py` and
  `python3 -m unittest discover -s scripts/ci -p 'test_workflow_pr_scope.py'`.
- Do not close/reopen PRs simply to force all workflows to produce status
  records. Trigger only the required targeted workflow on the correct SHA.
- Every independently triggered PR workflow must avoid accumulating older SHA
  runs. Namespace workflow-level `concurrency.group` by `github.workflow` and
  `github.event.pull_request.number`, with a unique `github.run_id` fallback
  for non-PR runs. Use `cancel-in-progress` only for `pull_request` events;
  never cancel master snapshot, tagged release, or manual evidence runs.
- Do not repeatedly rebase, amend or force-push an otherwise unchanged PR merely
  to chase every unrelated new master SHA. Preserve accepted green evidence
  when product code and affected test inputs are unchanged and protection
  rules allow it; do one final update only if an actual conflict, relevant
  source/test change, or platform-required check requires it.
- Do not disable or weaken full CI, exact-head Final Gate, owner/permissions
  validation, release prerequisites, source-provenance checks, or GitHub-first
  merge/GitLab fast-forward safety. Production-only inaccessible security
  sign-off remains "按用户决定跳过（未验收）"; controllable CI/security tests do not.
