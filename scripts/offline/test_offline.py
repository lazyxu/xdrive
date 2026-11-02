#!/usr/bin/env python3
"""Offline five-package integrity, determinism and fail-closed regression tests."""
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import types
import unittest
from unittest import mock

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

    def test_incremental_manifest_reuses_four_immutable_components(self):
        import types
        fingerprint = {name: format(i + 1, "064x")
                       for i, name in enumerate(offline.COMPONENTS)}
        contracts = {"postgres_major": 17, "media_worker_api": 1,
                     "photo_intelligence_api": 1, "model_runtime_api": 1}
        plan = self.root / "plan.json"
        first = self.root / "first"
        plan.write_text(json.dumps({"schema": 1, "fingerprints": fingerprint,
                        "changed": list(offline.COMPONENTS), "contracts": contracts}),
                        encoding="utf-8")
        offline.build_packages(types.SimpleNamespace(
            prepared=self.prepared, output=first, commit=self.commit,
            channel="master", source="github", plan=plan, reuse_manifest=None))
        previous = offline.parse_manifest(first, sha(first / "manifest.json"), require_trust=True)
        self.assertEqual(previous["schema"], 2)
        old_postgres = previous["packages"]["postgres"]
        # New Commit changes the App but leaves the independent dependency
        # fingerprints untouched: the reused Postgres bytes must not be copied.
        commit2 = "b" * 40
        fingerprint["app"] = "f" * 64
        plan.write_text(json.dumps({"schema": 1, "fingerprints": fingerprint,
                        "changed": ["app"], "contracts": contracts}), encoding="utf-8")
        images_path = self.prepared / "images.json"
        images = json.loads(images_path.read_text())
        for name in ("server", "caddy"):
            images[name]["ref"] = images[name]["ref"].replace("sha-" + self.commit[:12],
                                                                "sha-" + commit2[:12])
        images_path.write_text(json.dumps(images), encoding="utf-8")
        second = self.root / "second"
        offline.build_packages(types.SimpleNamespace(
            prepared=self.prepared, output=second, commit=commit2,
            channel="master", source="github", plan=plan,
            reuse_manifest=first / "manifest.json"))
        new = offline.parse_manifest(second, sha(second / "manifest.json"), require_trust=True)
        self.assertEqual(new["packages"]["postgres"], old_postgres)
        self.assertEqual(new["packages"]["postgres"]["built_from_commit"], self.commit)
        self.assertEqual(new["packages"]["app"]["built_from_commit"], commit2)
        self.assertFalse((second / old_postgres["filename"]).exists())
        offline.verify_selection(second, new, ("app",))

    def test_rejects_fingerprint_reuse_for_changed_component(self):
        import types
        plan = self.root / "plan.json"
        fingerprints = {c: format(i + 1, "064x")
                        for i, c in enumerate(offline.COMPONENTS)}
        base = {"schema": 1, "fingerprints": fingerprints,
                "changed": list(offline.COMPONENTS),
                "contracts": {"postgres_major": 17, "media_worker_api": 1,
                              "photo_intelligence_api": 1, "model_runtime_api": 1}}
        plan.write_text(json.dumps(base), encoding="utf-8")
        old = self.root / "old"
        offline.build_packages(types.SimpleNamespace(
            prepared=self.prepared, output=old, commit=self.commit,
            channel="master", source="github", plan=plan, reuse_manifest=None))
        base["changed"] = ["app"]
        plan.write_text(json.dumps(base), encoding="utf-8")
        with self.assertRaisesRegex(offline.PackageError, "unchanged component marked"):
            offline.build_packages(types.SimpleNamespace(
                prepared=self.prepared, output=self.root / "new", commit=self.commit,
                channel="master", source="github", plan=plan,
                reuse_manifest=old / "manifest.json"))

    def test_enabled_optional_module_must_have_verified_prior_contract(self):
        home = self.root / "existing"
        (home / "config").mkdir(parents=True)
        (home / "config" / ".env").write_text(
            "COMPOSE_PROFILES=media-worker\nXD_MEDIA_WORKER_IMAGE=xdrive/media-worker:old\n",
            encoding="utf-8")
        current = dict(self.manifest)
        current["contracts"] = {"postgres_major": 17, "media_worker_api": 1,
                                "photo_intelligence_api": 1, "model_runtime_api": 1}
        with self.assertRaisesRegex(offline.PackageError, "unverified"):
            offline.validate_active_contracts(home, current, ("app",), set())
        (home / "state").mkdir()
        saved = {"schema": 1, "contracts": current["contracts"],
                 "active_refs": {"media-worker": "xdrive/media-worker:old"}}
        (home / "state" / "offline-installed.json").write_text(json.dumps(saved), encoding="utf-8")
        self.assertEqual(offline.validate_active_contracts(home, current, ("app",), set()), saved)
        (home / "config" / ".env").write_text(
            "COMPOSE_PROFILES=media-worker\nXD_MEDIA_WORKER_IMAGE=xdrive/media-worker:unknown\n",
            encoding="utf-8")
        with self.assertRaisesRegex(offline.PackageError, "unverified"):
            offline.validate_active_contracts(home, current, ("app",), set())
        (home / "config" / ".env").write_text(
            "COMPOSE_PROFILES=media-worker\nXD_MEDIA_WORKER_IMAGE=xdrive/media-worker:old\n",
            encoding="utf-8")
        changed = dict(current)
        changed["contracts"] = dict(current["contracts"], media_worker_api=2)
        with self.assertRaisesRegex(offline.PackageError, "unverified"):
            offline.validate_active_contracts(home, changed, ("app",), set())

    def check_enabled_profile_preserves_existing(self, existing_profile, enabled_profile):
        home = self.root / "existing-profile"
        (home / "config").mkdir(parents=True)
        (home / "state").mkdir()
        image_key = ("XD_MEDIA_WORKER_IMAGE" if existing_profile == "media-worker"
                     else "XD_PHOTO_FACE_IMAGE")
        image_ref = "xdrive/existing-module:verified"
        (home / "config" / ".env").write_text(
            f'COMPOSE_PROFILES="{existing_profile}"\n{image_key}={image_ref}\n',
            encoding="utf-8")
        manifest = dict(self.manifest)
        manifest["contracts"] = {"postgres_major": 17, "media_worker_api": 1,
                                 "photo_intelligence_api": 1, "model_runtime_api": 1}
        (home / "state" / "offline-installed.json").write_text(json.dumps({
            "schema": 1, "contracts": manifest["contracts"],
            "active_refs": {existing_profile: image_ref},
        }), encoding="utf-8")
        selection = (("app", "postgres", "ai-runtime", "ai-models")
                     if enabled_profile == "photo-intelligence"
                     else ("app", "postgres", "media-worker"))
        args = types.SimpleNamespace(directory=self.out, config_dir=home,
                                     workdir=self.root, no_start=False,
                                     enable_ai=enabled_profile == "photo-intelligence",
                                     enable_media=enabled_profile == "media-worker")
        installer_profiles = []

        def run_process(command, **kwargs):
            if command == ["docker", "info"]:
                return subprocess.CompletedProcess(command, 0)
            if command[0] == "bash":
                installer_profiles.append(kwargs["env"]["COMPOSE_PROFILES"])
                return subprocess.CompletedProcess(command, 0)
            self.fail(f"unexpected external process: {command}")

        # Verify real package contents and saved compatibility state; replace
        # only Docker mutation and the host activation process boundary.
        with mock.patch.dict(os.environ, {"COMPOSE_PROFILES": ""}), \
                mock.patch.object(offline.shutil, "which", return_value="/fake/bin"), \
                mock.patch.object(offline.subprocess, "run", side_effect=run_process), \
                mock.patch.object(offline, "load_image"), \
                mock.patch.object(offline, "assemble_photo_runtime",
                                  return_value="xdrive/offline-photo:verified"):
            offline.offline_install(args, manifest, selection)
        self.assertEqual(installer_profiles, ["media-worker,photo-intelligence"])

    def test_enable_ai_preserves_existing_media_worker(self):
        self.check_enabled_profile_preserves_existing("media-worker", "photo-intelligence")

    def test_enable_media_preserves_existing_ai(self):
        self.check_enabled_profile_preserves_existing("photo-intelligence", "media-worker")

    def test_rejects_unsupported_profiles_without_evaluating_env_text(self):
        home = self.root / "invalid-profile"
        (home / "config").mkdir(parents=True)
        for value in ("unrecognized", "$(touch marker)", "media-worker;echo injected"):
            with self.subTest(value=value, source="saved config"):
                (home / "config" / ".env").write_text(
                    f"COMPOSE_PROFILES={value}\n", encoding="utf-8")
                with self.assertRaisesRegex(offline.PackageError, "unsupported Compose profile"):
                    offline.validate_active_contracts(home, self.manifest, ("app",), set())
            with self.subTest(value=value, source="process environment"):
                (home / "config" / ".env").write_text("", encoding="utf-8")
                with self.assertRaisesRegex(offline.PackageError, "unsupported Compose profile"):
                    offline.validate_active_contracts(home, self.manifest, ("app",), {value})

    def test_installed_offline_state_record_is_atomic_and_private(self):
        home = self.root / "record"
        (home / "config").mkdir(parents=True)
        (home / "config" / ".env").write_text(
            "XD_MEDIA_WORKER_IMAGE=xdrive/media-worker:fixed\n",
            encoding="utf-8")
        offline.record_successful_offline_install(home, {}, self.manifest, ("app",))
        path = home / "state" / "offline-installed.json"
        state = json.loads(path.read_text())
        self.assertEqual(state["schema"], 1)
        self.assertEqual(state["source_commit"], self.commit)
        self.assertIn("app", state["installed"])
        self.assertEqual(state["active_refs"]["media-worker"], "xdrive/media-worker:fixed")
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)

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
