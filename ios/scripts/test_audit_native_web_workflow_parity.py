#!/usr/bin/env python3
"""Fail-closed tests for the native/Web performance workflow crosswalk."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
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

    def test_p071_and_full_byte_web_baselines_are_not_silently_omitted(self):
        expected = {
            ".github/workflows/p071-gallery-mobile-mixed-100k.yml": module.GALLERY,
            ".github/workflows/p071-gallery-wide-mixed-100k.yml": module.GALLERY,
            ".github/workflows/p071-gallery-web-h264-posters-100k.yml": module.MEDIA,
            ".github/workflows/real-web-cas-1gib-performance.yml": module.TRANSFER,
            ".github/workflows/pwa-full-opfs-readback.yml": module.TRANSFER,
        }
        actual = {row["web_workflow"]: row for row in self.data["entries"]}
        for name, family in expected.items():
            self.assertIn(name, actual)
            self.assertEqual(actual[name]["native_family"], family)
            self.assertEqual(actual[name]["native_status"], "not_verified")
            self.assertEqual(module.target_family(Path(name).name), family)
        self.assertGreaterEqual(module.audit(self.data)["web_workflows"], 68)

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


class NativeWebMetricEvidenceTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        workflows = self.root / ".github/workflows"
        workflows.mkdir(parents=True)
        names = ["pwa-p4-fixture-%02d.yml" % i for i in range(49)]
        names.append("real-web-cas-1gib-performance.yml")
        for name in names:
            (workflows / name).touch()
        self.catalog = {"schema": 1, "platform": "ios-native",
                        "scope": "page-media-interaction-web-performance-workflows",
                        "entries": [{"web_workflow": ".github/workflows/" + name,
                                     "native_family": module.target_family(name),
                                     "native_status": "not_verified"} for name in names]}
        metric_names = ("upload_mib_s", "download_mib_s", "peak_rss_mib",
                        "sha256_verified", "resumed_verified", "cancellation_ms")
        families = [{"id": fid, "status": "not_measured"} for fid in (
            module.MEDIA, module.FILES, module.GALLERY, module.ROUTES, module.SCALE,
            "p1-notes-clipboard-transfers-settings-children")]
        families.append({"id": module.TRANSFER, "status": "verified",
                         "required_metrics": list(metric_names)})
        seven = self.root / "ios/performance/native-seven-workloads.json"
        seven.parent.mkdir(parents=True)
        seven.write_text(json.dumps({"families": families}), encoding="utf-8")
        self.entry = self.catalog["entries"][-1]
        self.entry.update(native_status="verified", evidence={
            "runtime": "ios-native", "owner_verified": True,
            "source_sha": "a" * 40, "fixture_sha256": "b" * 64,
            "raw_xcresult_url": "https://example.invalid/synthetic-unit-test",
            "device": "fixture", "os_version": "fixture", "network_conditions": "fixture",
            "samples": {name: [True, True, True] if name in
                        ("sha256_verified", "resumed_verified") else [1.0, 2.0, 3.0]
                        for name in metric_names}})

    def test_complete_synthetic_contract_fixture_passes(self):
        self.assertEqual(module.audit(self.catalog, self.root)["native_verified"], 1)

    def test_reject_missing_or_invalid_per_workflow_metric_samples(self):
        cases = [[], [1], [1, 2], "123", [1, 2, float("nan")],
                 [1, 2, float("inf")], [1, 2, -1], [1, 2, True], [1, 2, "3"]]
        for series in cases:
            with self.subTest(series=series):
                self.entry["evidence"]["samples"]["upload_mib_s"] = series
                with self.assertRaises(ValueError):
                    module.audit(self.catalog, self.root)

    def test_reject_unverified_byte_integrity(self):
        for metric in ("sha256_verified", "resumed_verified"):
            for series in ([True, False, True], [True, True, 1], []):
                with self.subTest(metric=metric, series=series):
                    data = copy.deepcopy(self.catalog)
                    data["entries"][-1]["evidence"]["samples"][metric] = series
                    with self.assertRaises(ValueError):
                        module.audit(data, self.root)

    def test_reject_truthy_or_synthetic_owner(self):
        for fields in ({"owner_verified": "yes"}, {"owner_verified": 1},
                       {"owner_verified": True, "synthetic_owner": True}):
            with self.subTest(fields=fields):
                data = copy.deepcopy(self.catalog)
                data["entries"][-1]["evidence"].update(fields)
                with self.assertRaises(ValueError):
                    module.audit(data, self.root)


if __name__ == "__main__":
    unittest.main()
