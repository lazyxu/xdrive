#!/usr/bin/env python3
"""Offline five-package integrity, determinism and fail-closed regression tests."""
import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("xdrive_offline", HERE / "xdrive_offline.py")
offline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(offline)

REPO = HERE.parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class OfflinePackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="xdrive-offline-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.prepared = self.root / "prepared"
        self.out = self.root / "out"
        self.commit = "a" * 40
        for component in offline.COMPONENTS:
            (self.prepared / component).mkdir(parents=True)
        for key, (component, name) in offline.IMAGE_MEMBERS.items():
            path = self.prepared / component / name
            path.parent.mkdir(parents=True, exist_ok=True)
            with gzip.open(path, "wb") as handle:
                handle.write(("fake image " + key).encode("ascii"))
        for asset in offline.REQUIRED_ASSETS:
            path = self.prepared / "app" / asset
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("#!/usr/bin/env bash\nexit 0\n", encoding="utf-8")
        models = self.prepared / "ai-models" / "models"
        licenses = self.prepared / "ai-models" / "licenses"
        models.mkdir()
        licenses.mkdir()
        (models / "model.onnx").write_bytes(b"model fixture")
        (licenses / "LICENSE").write_text("license", encoding="utf-8")
        metadata = {
            name: {"ref": f"example.org/xdrive/{name}:" + ("sha-" + self.commit[:12] if name in ("server", "caddy") else "v1"),
                   "id": "sha256:" + f"{index:064x}"}
            for index, name in enumerate(offline.IMAGE_MEMBERS, start=1)
        }
        (self.prepared / "images.json").write_text(json.dumps(metadata), encoding="utf-8")
        self.build()

    def build(self):
        args = type("Args", (), {"prepared": self.prepared, "output": self.out,
                                 "commit": self.commit, "source": "github",
                                 "channel": "master"})()
        offline.build_packages(args)
        self.digest = sha(self.out / "manifest.json")
        self.manifest = offline.parse_manifest(self.out, self.digest, require_trust=True)

    def test_all_five_packages_are_deterministic_and_verified(self):
        files_before = {p.name: sha(p) for p in self.out.iterdir() if p.is_file()}
        self.build()
        self.assertEqual(files_before, {p.name: sha(p) for p in self.out.iterdir() if p.is_file()})
        self.assertEqual(set(self.manifest["packages"]), set(offline.COMPONENTS))
        offline.verify_selection(self.out, self.manifest, offline.COMPONENTS)

    def test_select_app_only_for_existing_dependency_environment(self):
        chosen = offline.selected_components(self.out, self.manifest, "app")
        self.assertEqual(chosen, ("app",))
        offline.verify_selection(self.out, self.manifest, chosen)

    def test_refuse_untrusted_manifest_before_install(self):
        with self.assertRaisesRegex(offline.PackageError, "independent trusted channel"):
            offline.parse_manifest(self.out, None, require_trust=True)
        with self.assertRaisesRegex(offline.PackageError, "digest mismatch"):
            offline.parse_manifest(self.out, "f" * 64, require_trust=True)

    def test_refuse_tampered_bundle(self):
        item = self.manifest["packages"]["app"]
        path = self.out / item["filename"]
        with path.open("ab") as handle:
            handle.write(b"attack")
        with self.assertRaisesRegex(offline.PackageError, "length mismatch"):
            offline.verify_selection(self.out, self.manifest, ("app",))

    def test_refuse_missing_and_symlink_package(self):
        path = self.out / self.manifest["packages"]["postgres"]["filename"]
        path.unlink()
        with self.assertRaisesRegex(offline.PackageError, "missing"):
            offline.verify_selection(self.out, self.manifest, ("postgres",))
        path.symlink_to(self.out / self.manifest["packages"]["app"]["filename"])
        with self.assertRaisesRegex(offline.PackageError, "unsafe"):
            offline.verify_selection(self.out, self.manifest, ("postgres",))

    def test_refuse_symlink_input_in_build(self):
        alias = self.prepared / "ai-models" / "models" / "link.onnx"
        alias.symlink_to(self.prepared / "ai-models" / "models" / "model.onnx")
        with self.assertRaisesRegex(offline.PackageError, "unsafe"):
            self.build()

    def test_refuse_extra_tar_member_even_with_matching_outer_digest(self):
        path = self.out / self.manifest["packages"]["app"]["filename"]
        with tempfile.NamedTemporaryFile(dir=self.root, suffix=".tar.gz", delete=False) as handle:
            newpath = Path(handle.name)
        with tarfile.open(path, "r:gz") as source:
            members = [(member, source.extractfile(member).read()) for member in source]
        with tarfile.open(newpath, "w:gz") as target:
            for member, contents in members:
                target.addfile(member, io.BytesIO(contents))
            extra = tarfile.TarInfo("../outside")
            extra.size = 6
            target.addfile(extra, io.BytesIO(b"attack"))
        path.write_bytes(newpath.read_bytes())
        newpath.unlink()
        self.manifest["packages"]["app"]["size"] = path.stat().st_size
        self.manifest["packages"]["app"]["sha256"] = sha(path)
        with self.assertRaisesRegex(offline.PackageError, "unsafe tar entry"):
            offline.verify_archive(path, self.manifest["packages"]["app"], None)

    def test_refuse_duplicate_or_malformed_manifest_metadata(self):
        data = json.loads((self.out / "manifest.json").read_text())
        data["packages"]["postgres"]["filename"] = data["packages"]["app"]["filename"]
        (self.out / "manifest.json").write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaisesRegex(offline.PackageError, "duplicate package"):
            offline.parse_manifest(self.out, None, require_trust=False)

    def test_install_requires_ai_runtime_and_models_together(self):
        args = type("Args", (), {"directory": self.out})()
        with self.assertRaisesRegex(offline.PackageError, "must be installed together"):
            offline.offline_install(args, self.manifest, ("app", "ai-runtime"))

    def test_shell_and_workflow_enforce_no_pull_and_exact_assets(self):
        installer = (REPO / "deploy" / "install-server.sh").read_text()
        self.assertIn('OFFLINE_ASSET_DIR="${XD_OFFLINE_ASSET_DIR:-}"', installer)
        self.assertIn('compose up -d --pull never', installer)
        self.assertIn("verify_embedded_deploy_assets", installer)
        self.assertIn("offline_copy_asset", installer)
        subprocess.run(["bash", "-n", str(REPO / "deploy" / "install-server.sh")], check=True)
        subprocess.run(["bash", "-n", str(HERE / "build-five-packages.sh")], check=True)


if __name__ == "__main__":
    unittest.main()
