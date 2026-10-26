# GitHub Actions scope rules (apply inside .github/)

This scoped instruction supplements, and does not replace, the repository-root
AGENTS.md. Preserve the root policy and all other work.

- Keep the primary .github/workflows/ci.yml subscribed to every PR; it is the
  only intentionally broad PR CI workflow in this repository.
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
- Do not disable or weaken full CI, exact-head Final Gate, owner/permissions
  validation, release prerequisites, source-provenance checks, or GitHub-first
  merge/GitLab fast-forward safety. Production-only inaccessible security
  sign-off remains "按用户决定跳过（未验收）"; controllable CI/security tests do not.
