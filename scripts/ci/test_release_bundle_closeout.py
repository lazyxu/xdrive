#!/usr/bin/env python3
"""Regression tests for the read-only single-PR release closeout matrix."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("release_bundle_closeout.py")
spec = importlib.util.spec_from_file_location("release_bundle_closeout", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
SHA = "a" * 40


class CloseoutTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.log = self.root / "trace.log"
        self.log.write_bytes(b"real-witness-test-fixture\n")

    def live(self, **overrides):
        report = {
            "commit": SHA, "release": "verified", "host": "verified",
            "server_download": "verified", "guest_denial": "verified",
            "host_packages": 1, "api_packages": 7, "range_verified_packages": 1,
            "sigstore": "verified",
        }
        report.update(overrides)
        path = self.root / "live.json"
        path.write_text(json.dumps(report), encoding="utf-8")
        return path

    def receipt(self, row="R04", **overrides):
        priority, env, booleans, observed = module.ROWS[row]
        del priority
        data = {
            "schema_version": 1,
            "row": row,
            "environment": env,
            "commit": SHA,
            "result": "passed",
            "operator": "device witness",
            "executed_at": "2026-11-13T01:00:00Z",
            "checks": {name: True for name in booleans},
            "observed_commits": {name: SHA for name in observed},
            "artifacts": [{
                "path": self.log.name,
                "sha256": hashlib.sha256(self.log.read_bytes()).hexdigest(),
            }],
        }
        data.update(overrides)
        path = self.root / (row + ".json")
        path.write_text(json.dumps(data), encoding="utf-8")
        return path

    def test_no_simulation_is_called_real_evidence(self):
        result = module.build_matrix(SHA, self.root)
        self.assertEqual(result["summary"],
                         {"verified": 0, "unverified": 11, "rejected": 0})
        self.assertFalse(result["complete"])

    def test_real_live_report_is_only_r03_witness(self):
        result = module.build_matrix(SHA, self.root, self.live())
        self.assertEqual(result["checks"]["R03"]["status"], "verified")
        self.assertEqual(result["checks"]["R09"]["status"], "unverified")
        self.assertFalse(result["complete"])

    def test_empty_host_cache_cannot_pass_r03(self):
        result = module.build_matrix(SHA, self.root, self.live(host_packages=0))
        self.assertEqual(result["checks"]["R03"]["status"], "rejected")

    def test_public_only_sigstore_cannot_pass_r03(self):
        result = module.build_matrix(
            SHA, self.root, self.live(host="not_checked", server_download="not_checked"))
        self.assertEqual(result["checks"]["R03"]["status"], "rejected")

    def test_live_report_wrong_source_commit(self):
        result = module.build_matrix(SHA, self.root, self.live(commit="b" * 40))
        self.assertEqual(result["checks"]["R03"]["status"], "rejected")

    def test_real_receipt_digest_and_commit_components(self):
        self.receipt("R04")
        result = module.build_matrix(SHA, self.root)
        self.assertEqual(result["checks"]["R04"]["status"], "verified")
        self.assertEqual(result["summary"]["verified"], 1)

    def test_receipt_missing_rollback_rejected(self):
        _, _, flags, observed = module.ROWS["R04"]
        data = {x: True for x in flags}
        data["rollback_to_last_known_good"] = False
        self.receipt("R04", checks=data)
        self.assertEqual(module.build_matrix(SHA, self.root)["checks"]["R04"]["status"],
                         "rejected")

    def test_ci_cannot_impersonate_physical_device(self):
        self.receipt("R05", environment="ci-linux-simulator")
        self.assertEqual(module.build_matrix(SHA, self.root)["checks"]["R05"]["status"],
                         "rejected")

    def test_missing_or_wrong_device_commit_rejected(self):
        self.receipt("R08", observed_commits={"agent": "b" * 40})
        self.assertEqual(module.build_matrix(SHA, self.root)["checks"]["R08"]["status"],
                         "rejected")

    def test_tampered_attachment_cannot_pass(self):
        self.receipt("R07")
        self.log.write_bytes(b"tampered")
        self.assertEqual(module.build_matrix(SHA, self.root)["checks"]["R07"]["status"],
                         "rejected")

    def test_symlink_attachment_cannot_pass(self):
        self.receipt("R06")
        original = self.root / "original"
        self.log.rename(original)
        self.log.symlink_to(original)
        self.assertEqual(module.build_matrix(SHA, self.root)["checks"]["R06"]["status"],
                         "rejected")

    def test_attachment_path_traversal_forbidden(self):
        self.receipt("R10", artifacts=[{"path": "../trace.log", "sha256": "a" * 64}])
        self.assertEqual(module.build_matrix(SHA, self.root)["checks"]["R10"]["status"],
                         "rejected")

    def test_r09_needs_host_failure_receipt_and_live_sigstore(self):
        self.receipt("R09")
        self.assertEqual(module.build_matrix(SHA, self.root)["checks"]["R09"]["status"],
                         "rejected")
        self.assertEqual(module.build_matrix(SHA, self.root, self.live())["checks"]["R09"]["status"],
                         "verified")
        self.assertEqual(module.build_matrix(
            SHA, self.root, self.live(sigstore="not_checked"))["checks"]["R09"]["status"],
            "rejected")

    def test_r13_atomic_install_and_rollback_are_not_assumed(self):
        _, _, checks, observed = module.ROWS["R13"]
        incomplete = {key: True for key in checks}
        incomplete["cli_only_atomic_install_verified"] = False
        self.receipt("R13", checks=incomplete)
        self.assertEqual(module.build_matrix(SHA, self.root)["checks"]["R13"]["status"],
                         "rejected")
        self.receipt("R13")
        self.assertEqual(module.build_matrix(SHA, self.root)["checks"]["R13"]["status"],
                         "verified")

    def test_bad_sha_rejected_before_any_evidence(self):
        with self.assertRaises(module.EvidenceError):
            module.build_matrix("abc123", self.root)

    def test_cli_strict_fails_without_witnesses(self):
        outcome = subprocess.run(
            [sys.executable, str(SCRIPT), "--commit", SHA,
             "--evidence-dir", str(self.root), "--strict"],
            capture_output=True, text=True, check=False,
        )
        self.assertEqual(outcome.returncode, 1)
        self.assertEqual(json.loads(outcome.stdout)["summary"]["unverified"], 11)
        self.assertNotIn("Bearer", outcome.stdout)

    def test_cli_is_read_only_except_explicit_report_output(self):
        report = self.root / "report.json"
        outcome = subprocess.run(
            [sys.executable, str(SCRIPT), "--commit", SHA,
             "--evidence-dir", str(self.root), "--output", str(report)],
            capture_output=True, text=True, check=False,
        )
        self.assertEqual(outcome.returncode, 0, outcome.stderr)
        self.assertEqual(json.loads(report.read_text())["commit"], SHA)
        self.assertFalse((self.root / "R04.json").exists())

    def test_non_strict_does_not_hide_bad_evidence(self):
        self.receipt("R11", result="not-tested")
        outcome = subprocess.run(
            [sys.executable, str(SCRIPT), "--commit", SHA, "--evidence-dir", str(self.root)],
            capture_output=True, text=True, check=False,
        )
        self.assertEqual(outcome.returncode, 1)
        self.assertEqual(json.loads(outcome.stdout)["checks"]["R11"]["status"], "rejected")


if __name__ == "__main__":
    unittest.main()
