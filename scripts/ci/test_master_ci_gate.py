"""Regression tests for the exact master/PR/merge-group Final Gate.

Runs with only Python stdlib + git. Uses the *actual* workflow run script,
not a duplicate of its ancestry policy, against local immutable git fixtures.
"""
import os
from pathlib import Path
import re
import subprocess
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")


def final_gate_script():
    start = WORKFLOW.index("      - name: Verify exact CI checkout and PR merge candidate parents")
    marker = "        run: |\n"
    body_start = WORKFLOW.index(marker, start) + len(marker)
    body_end = WORKFLOW.index("      - name: Require every applicable CI gate to succeed", body_start)
    return textwrap.dedent(WORKFLOW[body_start:body_end])


class FinalGateContract(unittest.TestCase):
    def test_merge_queue_full_ci_and_publish_waits_for_tests(self):
        self.assertRegex(WORKFLOW, r"(?m)^  merge_group:\n    types: \[checks_requested\]")
        self.assertIn('if [[ "$GITHUB_EVENT_NAME" == "pull_request"', WORKFLOW)
        self.assertIn("scope=full", WORKFLOW)
        gate_start = WORKFLOW.index("  final-gate:\n")
        publish_start = WORKFLOW.index("  publish-master:\n", gate_start)
        gate = WORKFLOW[gate_start:publish_start]
        self.assertIn("      - android-native\n", gate)
        self.assertIn("      - test-windows-upgrade-artifact\n", gate)
        self.assertIn('all(.[]; .result == "success")', gate)
        publish = WORKFLOW[publish_start:WORKFLOW.index("  publish-content-addressed-offline:", publish_start)]
        self.assertIn("      - final-gate\n", publish)
        self.assertIn("uses: ./.github/workflows/release.yml", publish)

    def test_pr_ancestry_allows_master_advance_and_queue_rejects_stale_head(self):
        # Git's parent order is significant: first is candidate master,
        # second is the precise PR HEAD which was tested.
        script = final_gate_script()
        self.assertIn('actual_parents[1]', script)
        self.assertIn('actual_parents[0]', script)
        self.assertIn('"$live_master_sha"', script)
        self.assertIn('GITHUB_EVENT_NAME" == "merge_group"', script)
        with tempfile.TemporaryDirectory() as directory:
            origin = Path(directory, "origin.git")
            repo = Path(directory, "work")
            self.git(directory, "init", "--bare", str(origin))
            self.git(directory, "init", "-b", "master", str(repo))
            self.git(repo, "config", "user.email", "ci-fixture@example.invalid")
            self.git(repo, "config", "user.name", "CI Fixture")
            self.git(repo, "remote", "add", "origin", str(origin))
            (repo / "base.txt").write_text("master-1\n")
            self.git(repo, "add", "base.txt")
            self.git(repo, "commit", "-m", "base")
            base = self.git(repo, "rev-parse", "HEAD").strip()
            self.git(repo, "push", "-u", "origin", "master")

            self.git(repo, "checkout", "-b", "feature")
            (repo / "pr.txt").write_text("feature\n")
            self.git(repo, "add", "pr.txt")
            self.git(repo, "commit", "-m", "feature")
            pr_head = self.git(repo, "rev-parse", "HEAD").strip()

            self.git(repo, "checkout", "master")
            self.git(repo, "checkout", "-b", "old-candidate")
            self.git(repo, "merge", "--no-ff", "--no-edit", "feature")
            old_candidate = self.git(repo, "rev-parse", "HEAD").strip()
            self.assertEqual(0, self.run_gate(repo, script, "pull_request", old_candidate, base, pr_head).returncode)

            self.git(repo, "checkout", "master")
            (repo / "base.txt").write_text("master-2\n")
            self.git(repo, "commit", "-am", "advance master")
            current_master = self.git(repo, "rev-parse", "HEAD").strip()
            self.git(repo, "push", "origin", "master")

            self.git(repo, "checkout", "old-candidate")
            # An exact-HEAD, tested PR remains green when unrelated commits
            # advance master; GitHub's mergeability check still handles conflicts.
            advanced = self.run_gate(repo, script, "pull_request", old_candidate, base, pr_head)
            self.assertEqual(0, advanced.returncode, advanced.stdout + advanced.stderr)
            wrong_head = self.run_gate(repo, script, "pull_request", old_candidate, base, current_master)
            self.assertNotEqual(0, wrong_head.returncode)
            wrong_base = self.run_gate(repo, script, "pull_request", old_candidate, current_master, pr_head)
            self.assertNotEqual(0, wrong_base.returncode)
            # A synthetic merge built on a divergent first parent is untrusted.
            self.git(repo, "checkout", "-b", "divergent-base", base)
            (repo / "divergent.txt").write_text("other history\\n")
            self.git(repo, "add", "divergent.txt")
            self.git(repo, "commit", "-m", "divergent master candidate")
            self.git(repo, "merge", "--no-ff", "--no-edit", "feature")
            divergent_candidate = self.git(repo, "rev-parse", "HEAD").strip()
            divergent = self.run_gate(repo, script, "pull_request", divergent_candidate, base, pr_head)
            self.assertNotEqual(0, divergent.returncode)
            self.assertIn("Untrusted PR merge Base", divergent.stdout + divergent.stderr)

            self.git(repo, "checkout", "master")
            self.git(repo, "checkout", "-b", "fresh-candidate")
            self.git(repo, "merge", "--no-ff", "--no-edit", "feature")
            fresh = self.git(repo, "rev-parse", "HEAD").strip()
            success = self.run_gate(repo, script, "pull_request", fresh, base, pr_head)
            self.assertEqual(0, success.returncode, success.stdout + success.stderr)
            queue = self.run_gate(repo, script, "merge_group", fresh, base, pr_head,
                                  merge_head=fresh, merge_base=current_master)
            self.assertEqual(0, queue.returncode, queue.stdout + queue.stderr)
            wrong_head = self.run_gate(repo, script, "merge_group", fresh, base, pr_head,
                                      merge_head=old_candidate, merge_base=current_master)
            self.assertNotEqual(0, wrong_head.returncode)

            self.git(repo, "checkout", "master")
            (repo / "base.txt").write_text("master-3\n")
            self.git(repo, "commit", "-am", "master advanced during merge queue")
            self.git(repo, "push", "origin", "master")
            self.git(repo, "checkout", "fresh-candidate")
            stale_queue = self.run_gate(repo, script, "merge_group", fresh, base, pr_head,
                                        merge_head=fresh, merge_base=current_master)
            self.assertNotEqual(0, stale_queue.returncode)
            self.assertIn("Stale Merge Queue", stale_queue.stdout + stale_queue.stderr)

    @staticmethod
    def git(cwd, *args):
        result = subprocess.run(["git", *args], cwd=cwd, text=True, capture_output=True)
        if result.returncode:
            raise AssertionError(f"git {args!r}: {result.stdout} {result.stderr}")
        return result.stdout

    @staticmethod
    def run_gate(repo, script, event, sha, base, head, merge_head="", merge_base=""):
        env = {**os.environ, "GITHUB_EVENT_NAME": event, "GITHUB_SHA": sha,
               "PR_BASE_SHA": base, "PR_HEAD_SHA": head,
               "MERGE_GROUP_HEAD_SHA": merge_head, "MERGE_GROUP_BASE_SHA": merge_base}
        return subprocess.run(["bash", "-c", script], cwd=repo, env=env,
                              capture_output=True, text=True)


if __name__ == "__main__":
    unittest.main()
