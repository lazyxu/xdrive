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
        # Recreate an accepted pre-Share App archive and manifest. Its four
        # dependency packages remain reusable when this release rebuilds App.
        old_manifest = json.loads((first / "manifest.json").read_text("utf-8"))
        old_app = old_manifest["packages"]["app"]
        del old_app["members"]["assets/scripts/xdrive-share-update.py"]
        old_path = first / old_app["filename"]
        offline.deterministic_archive(self.prepared / "app", old_path, old_app["members"])
        old_app["sha256"] = sha(old_path)
        old_app["size"] = old_path.stat().st_size
        old_app["filename"] = f"xdrive-app-{old_app['sha256'][:12]}.tar.gz"
        old_app["release_tag"] = f"offline-app-{old_app['sha256'][:12]}"
        old_path.rename(first / old_app["filename"])
        (first / "manifest.json").write_text(json.dumps(old_manifest), encoding="utf-8")
        previous = offline.parse_manifest(first, sha(first / "manifest.json"), require_trust=True)
        self.assertEqual(previous["schema"], 2)
        old_postgres = previous["packages"]["postgres"]
        plan.write_text(json.dumps({"schema": 1, "fingerprints": fingerprint,
                        "changed": [], "contracts": contracts}), encoding="utf-8")
        with self.assertRaisesRegex(offline.PackageError, "rebuild App"):
            offline.build_packages(types.SimpleNamespace(
                prepared=self.prepared, output=self.root / "invalid-reuse", commit=self.commit,
                channel="master", source="github", plan=plan, reuse_manifest=first / "manifest.json"))
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
        self.assertIn("assets/scripts/xdrive-share-update.py", new["packages"]["app"]["members"])
        offline.verify_selection(second, new, ("app",))

    def test_current_build_requires_share_provider_asset(self):
        (self.prepared / "app/assets/scripts/xdrive-share-update.py").unlink()
        with self.assertRaisesRegex(offline.PackageError, "App package missing deployment scripts"):
            offline.build_packages(types.SimpleNamespace(prepared=self.prepared,
                output=self.root / "missing-helper", commit=self.commit, source="github", channel="master"))

    def test_share_install_rejects_legacy_app_before_docker(self):
        manifest = json.loads(json.dumps(self.manifest))
        del manifest["packages"]["app"]["members"]["assets/scripts/xdrive-share-update.py"]
        with mock.patch.object(offline.subprocess, "run") as external:
            with self.assertRaisesRegex(offline.PackageError, "Share provider"):
                offline.offline_install(types.SimpleNamespace(update_source="xdrive"), manifest, offline.COMPONENTS)
        external.assert_not_called()

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

    def check_enabled_profile_preserves_existing(self, existing_profile, enabled_profile,
                                               update_source=None, backup_file_data=False, all_components=False,
                                               delivery_commit=None, no_start=False, default_home=False):
        home = self.root / "default-home/.xd" if default_home else self.root / "existing-profile"
        (home / "config").mkdir(parents=True)
        (home / "state").mkdir()
        image_key = ("XD_MEDIA_WORKER_IMAGE" if existing_profile == "media-worker"
                     else "XD_PHOTO_FACE_IMAGE")
        image_ref = "xdrive/existing-module:verified"
        (home / "config" / ".env").write_text(
            f'COMPOSE_PROFILES="{existing_profile}"\n{image_key}={image_ref}\n',
            encoding="utf-8")
        manifest = dict(self.manifest)
        if delivery_commit:
            manifest["source_commit"] = delivery_commit
        manifest["contracts"] = {"postgres_major": 17, "media_worker_api": 1,
                                 "photo_intelligence_api": 1, "model_runtime_api": 1}
        (home / "state" / "offline-installed.json").write_text(json.dumps({
            "schema": 1, "contracts": manifest["contracts"],
            "active_refs": {existing_profile: image_ref},
        }), encoding="utf-8")
        selection = (("app", "postgres", "ai-runtime", "ai-models")
                     if enabled_profile == "photo-intelligence"
                     else ("app", "postgres", "media-worker"))
        if all_components:
            selection = offline.COMPONENTS
        args = types.SimpleNamespace(directory=self.out, config_dir=None if default_home else home,
                                     workdir=self.root, no_start=no_start,
                                     update_source=update_source, backup_file_data=backup_file_data,
                                     enable_ai=enabled_profile == "photo-intelligence",
                                     enable_media=enabled_profile == "media-worker")
        installer_profiles = []
        inherited_overrides = {
            key: "untrusted/inherited:edge" for key in (
                "XD_SERVER_IMAGE", "XD_CADDY_IMAGE", "XD_POSTGRES_IMAGE",
                "XD_MEDIA_WORKER_IMAGE", "XD_PHOTO_FACE_IMAGE", "XD_CADDY_RESCUE_IMAGE", "XD_WEB_IMAGE",
                "XD_OFFLINE_SERVER_IMAGE", "XD_OFFLINE_CADDY_IMAGE", "XD_OFFLINE_POSTGRES_IMAGE",
                "XD_OFFLINE_MEDIA_IMAGE", "XD_OFFLINE_PHOTO_IMAGE",
                "XD_SOURCE_REF", "XD_IMAGE_TAG", "XD_IMAGE_REGISTRY", "XD_BUILT_CHANNEL",
                "XD_BUILT_COMMIT", "XD_BUILT_SOURCE")}
        inherited_overrides["COMPOSE_PROFILES"] = ""
        inherited_overrides["XD_INSTALL_NO_START"] = "1"
        inherited_overrides["XD_CONFIG_DIR"] = str(self.root / "unrelated-installation")

        def run_process(command, **kwargs):
            if command == ["docker", "info"]:
                return subprocess.CompletedProcess(command, 0)
            if command[0] == "bash":
                environment = kwargs["env"]
                installer_profiles.append(environment.get("COMPOSE_PROFILES", ""))
                for name in ("server", "caddy", "postgres"):
                    self.assertEqual(environment.get("XD_OFFLINE_" + name.upper() + "_IMAGE"),
                                     manifest["images"][name]["ref"])
                self.assertEqual(environment.get("XD_OFFLINE_MEDIA_IMAGE"),
                                 manifest["images"]["media-worker"]["ref"] if "media-worker" in selection else None)
                self.assertEqual(environment.get("XD_OFFLINE_PHOTO_IMAGE"),
                                 "xdrive/offline-photo:verified" if "ai-runtime" in selection else None)
                self.assertEqual(environment.get("XD_POSTGRES_IMAGE"), manifest["images"]["postgres"]["ref"])
                self.assertEqual(environment.get("XD_INSTALL_NO_START"), "1" if no_start else None)
                self.assertEqual(environment.get("XD_CONFIG_DIR"), str(home))
                for name in inherited_overrides:
                    if name not in ("COMPOSE_PROFILES", "XD_POSTGRES_IMAGE", "XD_INSTALL_NO_START", "XD_CONFIG_DIR") and not name.startswith("XD_OFFLINE_"):
                        self.assertNotIn(name, environment, "inherited image/release overrides must not reach activation")
                self.assertEqual(command[2:6], ["--source", "github", "--channel", "master"])
                self.assertEqual(kwargs["env"].get("XD_OFFLINE_UPDATE_SOURCE"), update_source)
                self.assertEqual("--backup-file-data" in command, backup_file_data)
                return subprocess.CompletedProcess(command, 0)
            self.fail(f"unexpected external process: {command}")

        # Verify real package contents and saved compatibility state; replace
        # only Docker mutation and the host activation process boundary.
        with mock.patch.dict(os.environ, inherited_overrides), \
                mock.patch.object(offline.Path, "home", return_value=home.parent), \
                mock.patch.object(offline.shutil, "which", return_value="/fake/bin"), \
                mock.patch.object(offline.subprocess, "run", side_effect=run_process), \
                mock.patch.object(offline, "load_image"), \
                mock.patch.object(offline, "assemble_photo_runtime",
                                  return_value="xdrive/offline-photo:verified"):
            offline.offline_install(args, manifest, selection)
        expected = ",".join(sorted({p for p in (existing_profile, enabled_profile) if p}))
        self.assertEqual(installer_profiles, [expected])
        saved_state = json.loads((home / "state/offline-installed.json").read_text())
        self.assertEqual("source_commit" in saved_state, not no_start)

    def test_enable_ai_preserves_existing_media_worker(self):
        self.check_enabled_profile_preserves_existing("media-worker", "photo-intelligence")

    def test_enable_media_preserves_existing_ai(self):
        self.check_enabled_profile_preserves_existing("photo-intelligence", "media-worker")

    def test_share_transport_keeps_github_provenance_and_forwards_file_backup(self):
        self.check_enabled_profile_preserves_existing("media-worker", "photo-intelligence",
                                                     "xdrive", True)

    def test_share_prefetched_all_five_does_not_activate_disabled_profiles(self):
        self.check_enabled_profile_preserves_existing("", "", "xdrive", all_components=True)

    def test_reused_app_keeps_signed_images_when_delivery_commit_advances(self):
        self.check_enabled_profile_preserves_existing("", "", "xdrive", all_components=True,
                                                     delivery_commit="b" * 40)

    def test_explicit_no_start_does_not_record_successful_activation(self):
        self.check_enabled_profile_preserves_existing("", "", "xdrive", all_components=True, no_start=True)

    def test_default_home_matches_installer_and_receipt_despite_inherited_other_home(self):
        self.check_enabled_profile_preserves_existing("", "", "xdrive", all_components=True, default_home=True)

    def test_share_override_rejects_stable_or_foreign_provenance_before_docker(self):
        args = types.SimpleNamespace(update_source="xdrive")
        for values in ({"source": "gitlab"}, {"channel": "stable"}):
            with self.subTest(values=values):
                with self.assertRaisesRegex(offline.PackageError, "GitHub master"):
                    offline.offline_install(args, dict(self.manifest, **values), ("app", "postgres"))

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


class ImageArchiveIdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="offline-image-identity-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.ref = "example.org/xdrive/server:sha-" + "a" * 12

    def fixture(self, *, oci=True, index=False, platform="amd64", other_ref=None, wrong_diff_id=False):
        def encode(value):
            return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()

        layer = b"fixture layer"
        layer_id = hashlib.sha256(layer).hexdigest()
        config = encode(dict(architecture=platform, os="linux", config={},
                             rootfs=dict(type="layers", diff_ids=["sha256:" + ("0" * 64 if wrong_diff_id else layer_id)])))
        config_id = hashlib.sha256(config).hexdigest()
        config_name = "blobs/sha256/" + config_id if oci else config_id + ".json"
        layer_name = "blobs/sha256/" + layer_id if oci else layer_id + "/layer.tar"
        files = {config_name: config, layer_name: layer,
                 "manifest.json": encode([dict(Config=config_name, RepoTags=[self.ref], Layers=[layer_name])])}
        identity = dict(config="sha256:" + config_id, descriptors=())
        if oci:
            media = "application/vnd.oci.image."
            manifest = encode(dict(schemaVersion=2, mediaType=media + "manifest.v1+json",
                                   config=dict(mediaType=media + "config.v1+json", digest=identity["config"], size=len(config)),
                                   layers=[dict(mediaType=media + "layer.v1.tar", digest="sha256:" + layer_id, size=len(layer))]))
            manifest_id = hashlib.sha256(manifest).hexdigest()
            files["blobs/sha256/" + manifest_id] = manifest
            descriptor = dict(mediaType=media + "manifest.v1+json", digest="sha256:" + manifest_id, size=len(manifest))
            chain = [descriptor["digest"]]
            if index:
                descriptor["platform"] = dict(os="linux", architecture=platform)
                nested = encode(dict(schemaVersion=2, mediaType=media + "index.v1+json", manifests=[descriptor]))
                nested_id = hashlib.sha256(nested).hexdigest()
                files["blobs/sha256/" + nested_id] = nested
                descriptor = dict(mediaType=media + "index.v1+json", digest="sha256:" + nested_id, size=len(nested))
                chain.insert(0, descriptor["digest"])
            descriptor["annotations"] = {"io.containerd.image.name": other_ref or self.ref,
                                         "org.opencontainers.image.ref.name": self.ref.rsplit(":", 1)[1]}
            files["index.json"] = encode(dict(schemaVersion=2, mediaType=media + "index.v1+json", manifests=[descriptor]))
            files["oci-layout"] = b'{"imageLayoutVersion":"1.0.0"}'
            identity["descriptors"] = tuple(chain)
        return files, identity

    def archive(self, files, extra=None):
        path = self.root / "image.tar.gz"
        with tarfile.open(path, "w:gz", format=tarfile.USTAR_FORMAT) as output:
            for name, data in [*files.items(), *(extra or [])]:
                entry = tarfile.TarInfo(name)
                if isinstance(data, bytes):
                    entry.size = len(data)
                    output.addfile(entry, io.BytesIO(data))
                else:
                    entry.type = data[0]
                    entry.linkname = "manifest.json"
                    output.addfile(entry)
        return path

    def parse(self, files, signed=None, extra=None):
        if signed is None:
            manifest = json.loads(files["manifest.json"])[0]
            signed = "sha256:" + hashlib.sha256(files[manifest["Config"]]).hexdigest()
        return offline.archive_image_identity(self.archive(files, extra), dict(ref=self.ref, id=signed))

    def test_classic_config_and_verified_oci_chain_in_both_directions(self):
        for oci, index in ((False, False), (True, False), (True, True)):
            files, identity = self.fixture(oci=oci, index=index)
            for signed in (identity["config"], *identity["descriptors"]):
                with self.subTest(oci=oci, index=index, signed=signed):
                    self.assertEqual(self.parse(files, signed), identity)

    def test_load_checks_relationship_before_docker_and_accepts_only_linked_identity(self):
        files, identity = self.fixture()
        archive = self.archive(files)
        for signed, observed in ((identity["config"], identity["descriptors"][0]),
                                 (identity["descriptors"][0], identity["config"])):
            with mock.patch.object(offline, "docker", side_effect=["", observed]) as docker:
                offline.load_image(archive, dict(ref=self.ref, id=signed))
                self.assertEqual(docker.call_args_list[0].args[:2], ("load", "-i"))
        for observed in ("sha256:" + "0" * 64, "sha256:" + hashlib.sha256(files["index.json"]).hexdigest()):
            with mock.patch.object(offline, "docker", side_effect=["", observed]), self.assertRaises(offline.PackageError):
                offline.load_image(archive, dict(ref=self.ref, id=identity["config"]))
        with mock.patch.object(offline, "docker") as docker, self.assertRaises(offline.PackageError):
            offline.load_image(archive, dict(ref=self.ref, id="sha256:" + "0" * 64))
        docker.assert_not_called()

    def test_wrong_tag_platform_signed_identity_and_wrapper_digest_are_rejected(self):
        for changes in (dict(other_ref="example.org/other:tag"), dict(platform="arm64")):
            files, _ = self.fixture(**changes)
            with self.subTest(changes=changes), self.assertRaises(offline.PackageError):
                self.parse(files)
        files, _ = self.fixture()
        for signed in ("sha256:" + "0" * 64, "sha256:" + hashlib.sha256(files["index.json"]).hexdigest()):
            with self.subTest(signed=signed), self.assertRaises(offline.PackageError):
                self.parse(files, signed)

    def test_duplicate_tar_paths_links_and_json_keys_fail_closed(self):
        files, _ = self.fixture()
        for extra in ([('manifest.json', files['manifest.json'])], [('linked', (tarfile.SYMTYPE,))],
                      [('linked', (tarfile.LNKTYPE,))], [('../outside', b'bad')],
                      [('./manifest.json', b'bad')], [('blobs\\bad', b'bad')],
                      [('pax', (tarfile.XHDTYPE,))]):
            with self.subTest(extra=extra[0][0]), self.assertRaises(offline.PackageError):
                self.parse(files, extra=extra)
        files['index.json'] = b'{"schemaVersion":2,"schemaVersion":2,"manifests":[]}'
        with self.assertRaises(offline.PackageError):
            self.parse(files)

    def test_ambiguous_tag_or_descriptor_and_digest_size_conflicts_fail_closed(self):
        for kind in ('docker-duplicate', 'oci-duplicate', 'descriptor-size', 'descriptor-hash',
                     'descriptor-platform', 'config-conflict', 'missing-layer', 'unknown-media'):
            files, identity = self.fixture()
            value = json.loads(files['index.json'])
            if kind == 'docker-duplicate':
                value = json.loads(files['manifest.json'])
                files['manifest.json'] = json.dumps(value + value).encode()
            elif kind == 'oci-duplicate':
                value['manifests'] *= 2
            elif kind == 'descriptor-size':
                value['manifests'][0]['size'] += 1
            elif kind == 'descriptor-hash':
                files['blobs/sha256/' + identity['descriptors'][0][7:]] += b' '
            elif kind == 'descriptor-platform':
                value['manifests'][0]['platform'] = dict(os='linux', architecture='arm64')
            elif kind == 'config-conflict':
                files['blobs/sha256/' + identity['config'][7:]] += b' '
            elif kind == 'missing-layer':
                del files[json.loads(files['manifest.json'])[0]['Layers'][0]]
            else:
                value['manifests'][0]['mediaType'] = 'application/octet-stream'
            if kind != 'docker-duplicate':
                files['index.json'] = json.dumps(value).encode()
            with self.subTest(kind=kind), self.assertRaises(offline.PackageError):
                self.parse(files, identity['config'])

    def test_parser_enforces_metadata_entry_and_unpacked_bounds(self):
        files, identity = self.fixture()
        for bound, limit in (('IMAGE_METADATA_LIMIT', 16), ('IMAGE_METADATA_TOTAL_LIMIT', 32),
                             ('IMAGE_ARCHIVE_ENTRIES', 2), ('IMAGE_ARCHIVE_BYTES', 16)):
            with self.subTest(bound=bound), mock.patch.object(offline, bound, limit), self.assertRaises(offline.PackageError):
                self.parse(files, identity['config'])

    def test_validly_hashed_but_unlinked_config_or_layer_is_not_equivalent(self):
        for kind in ('config', 'layer'):
            files, identity = self.fixture()
            index = json.loads(files['index.json'])
            descriptor = index['manifests'][0]
            old_path = 'blobs/sha256/' + descriptor['digest'][7:]
            document = json.loads(files[old_path])
            if kind == 'config':
                config = json.loads(files['blobs/sha256/' + identity['config'][7:]])
                config['config'] = {'Env': ['UNRELATED=1']}
                raw = json.dumps(config).encode()
                new_id = hashlib.sha256(raw).hexdigest()
                files['blobs/sha256/' + new_id] = raw
                document['config'].update(digest='sha256:' + new_id, size=len(raw))
            else:
                document['layers'][0].update(digest=identity['config'],
                                             size=len(files['blobs/sha256/' + identity['config'][7:]]))
            raw = json.dumps(document).encode()
            new_id = hashlib.sha256(raw).hexdigest()
            del files[old_path]
            files['blobs/sha256/' + new_id] = raw
            descriptor.update(digest='sha256:' + new_id, size=len(raw))
            files['index.json'] = json.dumps(index).encode()
            with self.subTest(kind=kind), self.assertRaises(offline.PackageError):
                self.parse(files, identity['config'])

    def test_unreferenced_json_and_deep_index_graph_are_not_image_identities(self):
        files, identity = self.fixture()
        unused = b'{"schemaVersion":2,"unrelated":true}'
        unused_id = hashlib.sha256(unused).hexdigest()
        files['blobs/sha256/' + unused_id] = unused
        self.assertEqual(self.parse(files), identity)
        with self.assertRaises(offline.PackageError):
            self.parse(files, 'sha256:' + unused_id)
        root = json.loads(files['index.json'])
        for _ in range(8):
            raw = json.dumps(root).encode()
            digest = hashlib.sha256(raw).hexdigest()
            files['blobs/sha256/' + digest] = raw
            root = dict(schemaVersion=2, mediaType=offline.OCI_INDEX, manifests=[dict(
                mediaType=offline.OCI_INDEX, digest='sha256:' + digest, size=len(raw),
                annotations={'io.containerd.image.name': self.ref})])
        files['index.json'] = json.dumps(root).encode()
        with self.assertRaises(offline.PackageError):
            self.parse(files, identity['config'])

    def test_uncompressed_layer_diff_id_must_match_actual_layer_bytes(self):
        for oci in (False, True):
            files, identity = self.fixture(oci=oci, wrong_diff_id=True)
            with self.subTest(oci=oci), self.assertRaises(offline.PackageError):
                self.parse(files, identity['config'])


if __name__ == "__main__":
    unittest.main()
