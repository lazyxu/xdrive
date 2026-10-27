#!/usr/bin/env python3
"""Source-only regressions for GitHub PR workflow trigger scoping."""
import fnmatch
import re
from pathlib import Path
import tempfile
import unittest

from check_workflow_pr_scope import lint_workflows, pr_paths


class ScopeTests(unittest.TestCase):
    def test_unrestricted_pr_with_head_guard_is_not_sufficient(self):
        code = (
            "name: Experiment\non:\n  pull_request:\n    branches: [master]\n"
            "jobs:\n  test:\n    if: github.head_ref == 'perf/example'\n"
        )
        self.assertEqual(pr_paths(code), [])

    def test_empty_pr_event_is_unrestricted(self):
        self.assertEqual(pr_paths("on:\n  pull_request: {}\njobs:\n  test:\n"), [])

    def test_scoped_stacked_pr_preserves_base_branches(self):
        code = (
            "on:\n  pull_request:\n    branches: [master, feat/stack]\n"
            "    paths:\n      - 'desktop/tests/real-100k-source.cjs'\n"
            "  workflow_dispatch:\npermissions:\n  contents: read\n"
        )
        self.assertEqual(pr_paths(code), ["desktop/tests/real-100k-source.cjs"])

    def test_manual_only_does_not_subscribe_to_pr(self):
        self.assertIsNone(pr_paths("on:\n  workflow_dispatch:\njobs:\n  test:\n"))

    def test_related_fixture_is_matched_but_unrelated_android_pr_is_not(self):
        scoped = ["internal/api/cas_a01_shared_blob_100k_http_performance_integration_test.go",
                  "desktop/tests/cas-a01-shared-blob-100k-ref-gc-source.cjs"]
        android = ["android/app/src/main/java/com/tfluid/xdrive/DriveApp.kt",
                   "android/core/src/main/kotlin/com/tfluid/xdrive/core/XDriveApi.kt",
                   "android/app/src/androidTest/java/com/tfluid/xdrive/DriveAppTest.kt"]
        self.assertFalse(any(fnmatch.fnmatchcase(change, pattern)
                             for change in android for pattern in scoped))
        self.assertTrue(fnmatch.fnmatchcase(scoped[1], scoped[1]))

    def test_hygiene_workflow_scopes_workflow_edits_without_broad_glob(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "workflow-trigger-hygiene.yml").write_text(
                "on:\n  pull_request:\n    branches: [master]\n    paths:\n"
                "      - '.github/workflows/*.yml'\n"
                "      - 'scripts/ci/check_workflow_pr_scope.py'\n"
            )
            total, scoped, errors = lint_workflows(root)
            self.assertEqual((total, scoped, errors), (1, 1, []))
            (root / "workflow-trigger-hygiene.yml").write_text(
                "on:\n  pull_request:\n    branches: [master]\n    paths:\n"
                "      - '.github/workflows/**'\n"
                "      - 'scripts/ci/check_workflow_pr_scope.py'\n"
            )
            _, scoped, errors = lint_workflows(root)
            self.assertEqual(scoped, 0)
            self.assertTrue(any("unsafe broad" in error for error in errors))

    def test_places_workflow_requires_real_feature_scope(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "places-b1d-scoped.yml").write_text(
                "on:\n  pull_request:\n    branches: [master]\n    paths:\n"
                "      - '.github/workflows/places-b1d-scoped.yml'\n"
                "      - 'desktop/tests/media-gallery-places-b1d-contract.cjs'\n"
            )
            total, scoped, errors = lint_workflows(root)
            self.assertEqual((total, scoped, errors), (1, 1, []))

    def test_inline_comment_on_key_retains_pr_scope(self):
        code = (
            "on:  # event configuration\n"
            "  pull_request:\n"
            "    paths:\n      - 'desktop/tests/example-source.cjs'\n"
        )
        self.assertEqual(pr_paths(code), ["desktop/tests/example-source.cjs"])

    def test_shorthand_and_quoted_pr_events_cannot_bypass_scope_check(self):
        broad = (
            "on: [pull_request]\n",
            "on: {pull_request: {}}\n",
            "'on':\n  'pull_request':\n    branches: [master]\n",
            '"on":\n  "pull_request":\n    branches: [master]\n',
            "on:\n  - pull_request\n  - workflow_dispatch\n",
            "on: pull_request\n",
            "on:\n    pull_request:\n      branches: [master]\n",
            "on: [\n  push,\n  pull_request,\n]\n",
        )
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for index, source in enumerate(broad):
                name = f"broad-{index}.yaml"
                (root / name).write_text(source)
                self.assertEqual(pr_paths(source), [], name)
            (root / "quoted-scoped.yml").write_text(
                "'on':\n  'pull_request':\n    branches: [master]\n"
                "    paths:\n      - 'desktop/tests/example-source.cjs'\n"
            )
            (root / "push-only.yml").write_text("on: [push]\n")
            total, scoped, errors = lint_workflows(root)
            self.assertEqual((total, scoped, len(errors)), (len(broad) + 2, 1, len(broad)))

    def test_yaml_workflows_cannot_bypass_pr_trigger_scope_check(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "bad.yaml").write_text("on:\n  pull_request: {}\n")
            (root / "scoped.yaml").write_text(
                "on:\n  pull_request:\n    paths:\n"
                "      - 'desktop/tests/example-source.cjs'\n"
            )
            total, scoped, errors = lint_workflows(root)
            self.assertEqual((total, scoped), (2, 1))
            self.assertEqual(len(errors), 1)
            self.assertIn("bad.yaml", errors[0])


    def test_core_ci_has_no_dormant_branch_only_benchmark_jobs(self):
        """Core CI must not show dozens of Skipped jobs on every master push."""
        core = Path(__file__).resolve().parents[2] / ".github/workflows/ci.yml"
        source = core.read_text(encoding="utf-8")
        body = source.split("\njobs:\n", 1)[1]
        markers = list(re.finditer(r"(?m)^  ([a-z][a-z0-9-]*):\s*$", body))
        jobs = {}
        for i, marker in enumerate(markers):
            end = markers[i + 1].start() if i + 1 < len(markers) else len(body)
            jobs[marker.group(1)] = body[marker.start():end]
        required = {"android-native", "go-linux-api", "go-linux", "go-windows",
                    "web", "desktop-tests", "server-validation", "server-image",
                    "final-gate", "publish-master", "publish-stable",
                    "photo-ocr-master-smoke"}
        self.assertTrue(required <= set(jobs), required - set(jobs))
        for name, job in jobs.items():
            # Evaluate only the job header. Steps may legitimately use
            # github.head_ref for conditional targeted tests within real gates.
            header = job.split("\n    steps:", 1)[0]
            if "github.head_ref" not in header:
                continue
            self.assertEqual(name, "photo-ocr-master-smoke",
                             f"{name} is a branch-only job in broad CI")
            self.assertIn("github.ref == 'refs/heads/master'", header)

    def test_validator_catches_broad_and_fixtureless_trigger(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "ci.yml").write_text("on:\n  pull_request:\n    branches: [master]\n")
            (root / "bad.yml").write_text("on:\n  pull_request: {}\n")
            (root / "broad.yml").write_text("on:\n  pull_request:\n    paths:\n      - '**'\n")
            (root / "scope-only.yml").write_text(
                "on:\n  pull_request:\n    paths:\n      - '.github/workflows/scope-only.yml'\n"
            )
            (root / "valid.yml").write_text(
                "on:\n  pull_request:\n    paths:\n      - 'scripts/ci/perf_fixture.py'\n"
            )
            total, scoped, errors = lint_workflows(root)
            self.assertEqual((total, scoped), (5, 1))
            self.assertEqual(len(errors), 3)
            self.assertTrue(any("bad.yml" in issue for issue in errors))


if __name__ == "__main__":
    unittest.main()
