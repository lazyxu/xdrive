#!/usr/bin/env python3
"""Fail-closed tests for the native/Web performance workflow crosswalk."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "native_web_perf_parity", HERE / "audit_native_web_workflow_parity.py")
assert SPEC and SPEC.loader
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)
CATALOG = HERE.parent / "performance/native-web-workflow-parity.json"


class NativeWebPerformanceParityTests(unittest.TestCase):
    def setUp(self):
        self.data = json.loads(CATALOG.read_text(encoding="utf-8"))

    def test_existing_web_ui_benchmarks_are_all_explicitly_unverified(self):
        result = module.audit(self.data)
        self.assertGreaterEqual(result["web_workflows"], 50)
        self.assertEqual(result["native_verified"], 0)
        self.assertEqual(result["native_unverified"], result["web_workflows"])
        self.assertEqual(result["families_with_web_benchmarks"], 6)

    def test_missing_web_workflow_fails(self):
        self.data["entries"].pop()
        with self.assertRaisesRegex(ValueError, "Missing or obsolete"):
            module.audit(self.data)

    def test_duplicate_web_workflow_fails(self):
        self.data["entries"].append(copy.deepcopy(self.data["entries"][0]))
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            module.audit(self.data)

    def test_wrong_native_family_fails(self):
        self.data["entries"][0]["native_family"] = "p1-notes-clipboard-transfers-settings-children"
        with self.assertRaisesRegex(ValueError, "Incorrect native"):
            module.audit(self.data)

    def test_no_false_success_or_chromium_metrics(self):
        first = self.data["entries"][0]
        first["verified"] = True
        with self.assertRaisesRegex(ValueError, "Unverified"):
            module.audit(self.data)
        first.pop("verified")
        first["native_status"] = "verified"
        first["evidence"] = {"runtime": "chromium"}
        with self.assertRaisesRegex(ValueError, "Native family"):
            module.audit(self.data)

    def test_workflow_provenance_file_is_present(self):
        for item in self.data["entries"]:
            self.assertTrue((module.ROOT / item["web_workflow"]).is_file())


if __name__ == "__main__":
    unittest.main()
