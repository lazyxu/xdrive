#!/usr/bin/env python3
"""Content-addressed offline release planning regressions."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("component_plan", HERE / "component_plan.py")
component_plan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(component_plan)
ROOT = HERE.parents[1]
POSTGRES_ID = "sha256:" + "a" * 64


class ComponentPlanTests(unittest.TestCase):
    def test_provider_and_offline_policy_changes_rebuild_app_only(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = [component_plan.CONTRACT_FILE, "Dockerfile", *component_plan.RUNTIME_FILES,
                     component_plan.MODEL_FILE, "scripts/xdrive-share-update.py",
                     "scripts/offline/xdrive_offline.py", "scripts/offline/test_offline.py"]
            for path in paths:
                target = root / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("initial", encoding="utf-8")
            (root / component_plan.CONTRACT_FILE).write_bytes((ROOT / component_plan.CONTRACT_FILE).read_bytes())
            (root / component_plan.MODEL_FILE).write_bytes((ROOT / component_plan.MODEL_FILE).read_bytes())
            with mock.patch.object(component_plan, "files_at", return_value=paths):
                initial = component_plan.analyze(root, POSTGRES_ID, None)
                previous = {"schema": 2, "fingerprints": initial["fingerprints"]}
                for path in ("scripts/xdrive-share-update.py", "scripts/offline/xdrive_offline.py"):
                    with self.subTest(path=path):
                        target = root / path
                        target.write_text("changed", encoding="utf-8")
                        self.assertEqual(component_plan.analyze(root, POSTGRES_ID, previous)["changed"], ["app"])
                        target.write_text("initial", encoding="utf-8")
                (root / "scripts/offline/test_offline.py").write_text("changed test", encoding="utf-8")
                self.assertEqual(component_plan.analyze(root, POSTGRES_ID, previous)["changed"], [])

    def test_initial_bootstrap_produces_five_changed_components(self):
        plan = component_plan.analyze(ROOT, POSTGRES_ID, None)
        self.assertEqual(set(plan["changed"]), set(component_plan.COMPONENTS))
        self.assertEqual(plan["reused"], [])
        self.assertEqual(plan["contracts"]["postgres_major"], 17)
        for value in plan["fingerprints"].values():
            self.assertEqual(len(value), 64)

    def test_equal_inputs_reuse_all_five(self):
        first = component_plan.analyze(ROOT, POSTGRES_ID, None)
        previous = {"schema": 2, "fingerprints": first["fingerprints"]}
        subsequent = component_plan.analyze(ROOT, POSTGRES_ID, previous)
        self.assertEqual(subsequent["changed"], [])
        self.assertEqual(set(subsequent["reused"]), set(component_plan.COMPONENTS))

    def test_registry_postgres_image_change_repackages_only_postgres(self):
        first = component_plan.analyze(ROOT, POSTGRES_ID, None)
        previous = {"schema": 2, "fingerprints": first["fingerprints"]}
        change = component_plan.analyze(ROOT, "sha256:" + "b" * 64, previous)
        self.assertEqual(change["changed"], ["postgres"])
        self.assertEqual(len(change["reused"]), 4)

    def test_requires_digest_pinned_postgres_identity(self):
        with self.assertRaisesRegex(ValueError, "exact sha256"):
            component_plan.analyze(ROOT, "postgres:17-alpine", None)

    def test_source_models_metadata_includes_all_weight_hashes(self):
        source = (ROOT / "services/photo-face-analyzer/fetch_models.py").read_text("utf-8")
        self.assertIn('"siglip2_vision_int8.onnx"', source)
        self.assertIn('"text_recognition_CRNN_CN_2021nov.onnx"', source)
        self.assertEqual(len(component_plan.analyze(ROOT, POSTGRES_ID, None)["fingerprints"]["ai-models"]), 64)


if __name__ == "__main__":
    unittest.main()
