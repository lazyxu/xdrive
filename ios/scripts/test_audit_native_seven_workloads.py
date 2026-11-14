#!/usr/bin/env python3
import copy
import importlib.util
import json
from pathlib import Path
import unittest

PATH = Path(__file__).with_name("audit_native_seven_workloads.py")
SPEC = importlib.util.spec_from_file_location("seven_workloads", PATH)
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)
CATALOG = Path(__file__).resolve().parents[1] / "performance/native-seven-workloads.json"

class NativeSevenWorkloadAuditTests(unittest.TestCase):
    def setUp(self):
        self.original = json.loads(CATALOG.read_text(encoding="utf-8"))
        self.data = copy.deepcopy(self.original)

    def test_all_seven_are_present_without_false_green(self):
        report = audit.audit(self.data)
        self.assertEqual(report, {"families":7, "verified":0, "not_verified":7})

    def test_cannot_remove_or_duplicate_a_workload(self):
        self.data["families"].pop()
        with self.assertRaisesRegex(ValueError, "Missing required"):
            audit.audit(self.data)
        self.data = copy.deepcopy(self.original)
        self.data["families"][0] = self.data["families"][1].copy()
        with self.assertRaisesRegex(ValueError, "duplicate"):
            audit.audit(self.data)

    def test_pending_cannot_claim_success_or_hide_blockers(self):
        self.data["families"][0]["verified"] = True
        with self.assertRaisesRegex(ValueError, "Unverified"):
            audit.audit(self.data)
        self.data = copy.deepcopy(self.original)
        self.data["families"][0]["outstanding"] = []
        with self.assertRaisesRegex(ValueError, "blockers"):
            audit.audit(self.data)

    def test_web_is_not_native_evidence(self):
        target = self.data["families"][0]
        target["status"] = "verified"
        target["evidence"] = {"runtime":"chromium", "synthetic_owner":False}
        with self.assertRaisesRegex(ValueError, "Chromium"):
            audit.audit(self.data)

    def test_prohibits_missing_raw_source_fixture_or_three_trials(self):
        target = self.data["families"][0]
        target["status"] = "verified"
        target["evidence"] = {"runtime":"ios-native","synthetic_owner":False}
        with self.assertRaisesRegex(ValueError, "source SHA"):
            audit.audit(self.data)
        target["evidence"].update({
          "source_sha":"a"*40, "fixture_sha256":"b"*64,
          "raw_xcresult_url":"https://github.com/test/run",
          "device":"iPhone 16", "os_version":"18.5",
          "network_conditions":"offline",
          "samples":{key:[0,1] for key in target["required_metrics"]},
        })
        with self.assertRaisesRegex(ValueError, ">=3"):
            audit.audit(self.data)
        target["evidence"]["samples"] = {key:[1,2,3] for key in target["required_metrics"]}
        self.assertEqual(audit.audit(self.data)["verified"], 1)

    def test_rejects_nan_cpu_and_false_resume(self):
        target = self.data["families"][0]
        target["status"] = "verified"
        target["evidence"] = {
          "runtime":"ios-native", "synthetic_owner":False,
          "source_sha":"a"*40, "fixture_sha256":"b"*64,
          "raw_xcresult_url":"https://github.com/test/run", "device":"iPhone 16",
          "os_version":"18.5", "network_conditions":"offline",
          "samples":{key:[1,2,3] for key in target["required_metrics"]},
        }
        target["evidence"]["samples"]["app_cpu_s"] = [1.0,float("nan"),3.0]
        with self.assertRaisesRegex(ValueError, "numeric"):
            audit.audit(self.data)
        transferred = self.data["families"][-1]
        transferred["status"] = "verified"
        transferred["evidence"] = copy.deepcopy(target["evidence"])
        transferred["evidence"]["samples"] = {key:([True]*3 if key in audit.BOOLEAN_METRICS else [1,2,3])
                                             for key in transferred["required_metrics"]}
        target["evidence"]["samples"]["app_cpu_s"] = [1,2,3]
        self.assertEqual(audit.audit(self.data)["verified"], 2)
        transferred["evidence"]["samples"]["resumed_verified"] = [True,False,True]
        with self.assertRaisesRegex(ValueError, "integrity"):
            audit.audit(self.data)

if __name__ == "__main__":
    unittest.main()
