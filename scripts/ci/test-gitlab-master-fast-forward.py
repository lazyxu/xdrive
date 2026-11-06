#!/usr/bin/env python3
"""Offline master -> GitLab FF authorization tests; no network or real secrets."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parent / "ff-github-master-to-gitlab.sh"
CANONICAL = "https://github.com/lazyxu/xdrive.git"
MIRROR = "https://gitlab.com/fixture-owner/xdrive.git"


def git(*args, cwd=None, env=None, check=True):
    return subprocess.run(["git", *args], cwd=cwd, env=env, text=True,
                          capture_output=True, check=check)


class MasterGitLabFastForward(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.TemporaryDirectory(prefix="xdrive-master-gitlab-ff-")
        self.addCleanup(self.d.cleanup)
        root = Path(self.d.name)
        self.origin, self.mirror, self.work = (root / name for name in ("origin.git", "mirror.git", "work"))
        self.global_config = root / "gitconfig"
        self.env = os.environ.copy()
        self.env.update(GIT_CONFIG_GLOBAL=str(self.global_config), GIT_CONFIG_NOSYSTEM="1", HOME=str(root),
                        GIT_TERMINAL_PROMPT="0", XDRIVE_GITLAB_MIRROR_URL=MIRROR,
                        XDRIVE_GITLAB_MIRROR_PUSH_TOKEN="synthetic-never-log", XDRIVE_GITLAB_MIRROR_APPLY="false")
        git("init", "--bare", "--initial-branch=master", str(self.origin), env=self.env)
        git("init", "--bare", "--initial-branch=master", str(self.mirror), env=self.env)
        git("init", "--initial-branch=master", str(self.work), env=self.env)
        git("config", "user.email", "fixture@example.invalid", cwd=self.work, env=self.env)
        git("config", "user.name", "xDrive CI Fixture", cwd=self.work, env=self.env)
        git("remote", "add", "origin", self.origin.as_uri(), cwd=self.work, env=self.env)
        (self.work / "fixture.txt").write_text("A\n")
        git("add", "fixture.txt", cwd=self.work, env=self.env)
        git("commit", "-m", "A", cwd=self.work, env=self.env)
        self.A = git("rev-parse", "HEAD", cwd=self.work, env=self.env).stdout.strip()
        git("push", "origin", "master", cwd=self.work, env=self.env)
        git("push", self.mirror.as_uri(), "master:master", cwd=self.work, env=self.env)
        (self.work / "fixture.txt").write_text("B\n")
        git("commit", "-am", "B", cwd=self.work, env=self.env)
        self.B = git("rev-parse", "HEAD", cwd=self.work, env=self.env).stdout.strip()
        git("push", "origin", "master", cwd=self.work, env=self.env)
        # Raw origin URL stays canonical while the test fixture redirects Git's
        # actual fetches to offline bare Git repositories.
        git("remote", "set-url", "origin", CANONICAL, cwd=self.work, env=self.env)
        git("config", "--file", str(self.global_config),
            f"url.{self.origin.as_uri()}.insteadOf", CANONICAL, env=self.env)
        git("config", "--file", str(self.global_config),
            f"url.{self.mirror.as_uri()}.insteadOf", MIRROR, env=self.env)
        self.env.update(GITHUB_SHA=self.B, XDRIVE_EXPECTED_GITHUB_SHA=self.B)

    def run_sync(self, apply=False, **changes):
        env = dict(self.env, XDRIVE_GITLAB_MIRROR_APPLY="true" if apply else "false")
        env.update(changes)
        p = subprocess.run(["bash", str(SCRIPT)], cwd=self.work, env=env,
                           capture_output=True, text=True, timeout=30)
        self.assertNotIn("synthetic-never-log", p.stdout + p.stderr)
        return p

    def remote_sha(self):
        return git("rev-parse", "refs/heads/master", cwd=self.mirror, env=self.env).stdout.strip()

    def test_dry_run_preserves_remote_and_cleans_temp_remote(self):
        p = self.run_sync()
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("DRY RUN", p.stdout)
        self.assertEqual(self.remote_sha(), self.A)
        self.assertNotIn("xdrive-gitlab-mirror", git("remote", cwd=self.work, env=self.env).stdout)

    def test_apply_ff_readback_and_idempotent_replay(self):
        p = self.run_sync(apply=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(self.remote_sha(), self.B)
        p = self.run_sync(apply=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("nothing to push", p.stdout)

    def test_wrong_expected_sha_or_event_is_rejected(self):
        for changes in ({"XDRIVE_EXPECTED_GITHUB_SHA": self.A},
                        {"GITHUB_SHA": self.A},
                        {"XDRIVE_EXPECTED_GITHUB_SHA": "not-a-sha"}):
            with self.subTest(changes=changes):
                p = self.run_sync(apply=True, **changes)
                self.assertNotEqual(p.returncode, 0)
                self.assertEqual(self.remote_sha(), self.A)

    def test_source_moves_after_dispatch(self):
        (self.work / "fixture.txt").write_text("C\n")
        git("commit", "-am", "C", cwd=self.work, env=self.env)
        git("push", "origin", "master", cwd=self.work, env=self.env)
        p = self.run_sync(apply=True)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("checked-out HEAD", p.stderr)
        self.assertEqual(self.remote_sha(), self.A)

    def test_mirror_divergence_is_never_overwritten(self):
        other = Path(self.d.name) / "diverged"
        git("clone", "--branch", "master", self.mirror.as_uri(), str(other), env=self.env)
        git("config", "user.email", "fixture@example.invalid", cwd=other, env=self.env)
        git("config", "user.name", "GitLab Fixture", cwd=other, env=self.env)
        (other / "fixture.txt").write_text("GitLab unique commit\n")
        git("commit", "-am", "GitLab-only commit", cwd=other, env=self.env)
        git("push", "origin", "master", cwd=other, env=self.env)
        c = self.remote_sha()
        p = self.run_sync(apply=True)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("NOT an ancestor", p.stderr)
        self.assertEqual(self.remote_sha(), c)

    def test_unsafe_url_and_malformed_apply_rejected(self):
        for changes in ({"XDRIVE_GITLAB_MIRROR_URL": "https://gitlab.com@evil.example/xdrive"},
                        {"XDRIVE_GITLAB_MIRROR_URL": "https://gitlab.com/fixture-owner/xdrive.git?token=bad"},
                        {"XDRIVE_GITLAB_MIRROR_URL": "http://gitlab.com/fixture-owner/xdrive.git"},
                        {"XDRIVE_GITLAB_MIRROR_APPLY": "yes"}):
            with self.subTest(changes=changes):
                p = self.run_sync(apply=True, **changes)
                self.assertNotEqual(p.returncode, 0)
                self.assertEqual(self.remote_sha(), self.A)

    def test_missing_mirror_master_fails_closed(self):
        empty = Path(self.d.name) / "no-master.git"
        git("init", "--bare", "--initial-branch=master", str(empty), env=self.env)
        git("config", "--file", str(self.global_config),
            f"url.{empty.as_uri()}.insteadOf", "https://gitlab.com/empty/project.git", env=self.env)
        p = self.run_sync(apply=True, XDRIVE_GITLAB_MIRROR_URL="https://gitlab.com/empty/project.git")
        self.assertNotEqual(p.returncode, 0)
        self.assertEqual(self.remote_sha(), self.A)


if __name__ == "__main__":
    unittest.main()
