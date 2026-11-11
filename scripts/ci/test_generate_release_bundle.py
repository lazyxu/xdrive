import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("generator", Path(__file__).with_name("generate-release-bundle.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

SHA = "a" * 40

class GenerateBundleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)
        for name in (
            "xdrive-linux-amd64.deb", "xDriveSetup-amd64.exe",
            "xdrive-backup-linux-amd64.tar.gz", "xdrive-backup-windows-amd64.zip",
            "xdrive-cli-linux-amd64.tar.gz", "xdrive-cli-windows-amd64.zip",
            "xdrivenas-armada38x-0.1.0-1234.spk",
        ):
            (self.directory / name).write_bytes(name.encode())

    def test_missing_optional_platforms_are_not_synthesized(self):
        result = module.build(self.directory, SHA, "master")
        self.assertEqual(len(result["artifacts"]), 7)
        self.assertEqual({x["platform"] for x in result["artifacts"]},
                         {"linux", "windows", "cli", "dsm"})
        self.assertTrue(all(x["build_commit"] == SHA for x in result["artifacts"]))
        self.assertTrue(all("/bundle-" + SHA + "/" in x["sources"]["github"]
                            for x in result["artifacts"]))

    def test_portable_cli_is_distinct_from_backup_only_cli(self):
        result = module.build(self.directory, SHA, "master")
        cli = [entry for entry in result["artifacts"] if entry["platform"] == "cli"]
        self.assertEqual({entry["filename"] for entry in cli}, {
            "xdrive-backup-linux-amd64.tar.gz",
            "xdrive-backup-windows-amd64.zip",
            "xdrive-cli-linux-amd64.tar.gz",
            "xdrive-cli-windows-amd64.zip",
        })
        self.assertTrue(all(entry["build_commit"] == SHA and
                            entry["install_mode"] == "manual" for entry in cli))

    def test_add_optional_only_when_present(self):
        (self.directory / "xDrive-unsigned.ipa").write_bytes(b"ios")
        (self.directory / "xdrive-android-12-0.1.2.apk").write_bytes(b"apk")
        items = module.build(self.directory, SHA, "master")["artifacts"]
        self.assertEqual(len(items), 9)
        android, = [x for x in items if x["platform"] == "android"]
        ios, = [x for x in items if x["platform"] == "ios"]
        self.assertEqual(android["install_mode"], "manual")
        self.assertEqual(ios["install_mode"], "manual_test_only")
        windows, = [x for x in items if x["platform"] == "windows"]
        self.assertEqual(windows["install_mode"], "manual_test_only")
        self.assertTrue(all(item["install_mode"] == "manual"
                            for item in items if item["platform"] not in ("ios", "windows")))
        self.assertEqual(android["sha256"], hashlib.sha256(b"apk").hexdigest())

    def test_unsigned_windows_snapshot_is_downloadable_but_never_installable(self):
        items = module.build(self.directory, SHA, "master")["artifacts"]
        windows, = [x for x in items if x["platform"] == "windows"]
        self.assertEqual(windows["install_mode"], "manual_test_only")
        self.assertEqual(windows["build_commit"], SHA)
        self.assertEqual(windows["sha256"], hashlib.sha256(b"xDriveSetup-amd64.exe").hexdigest())

    def test_exact_run_windows_signing_enables_manual_install(self):
        items = module.build(self.directory, SHA, "master", windows_signed=True)["artifacts"]
        windows, = [x for x in items if x["platform"] == "windows"]
        self.assertEqual(windows["install_mode"], "manual")
        self.assertTrue(all(x["build_commit"] == SHA for x in items))

    def test_unsigned_stable_windows_release_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "stable Windows installer requires"):
            module.build(self.directory, SHA, "stable")
        items = module.build(self.directory, SHA, "stable", windows_signed=True)["artifacts"]
        windows, = [x for x in items if x["platform"] == "windows"]
        self.assertEqual(windows["install_mode"], "manual")

    def test_stable_without_optional_windows_package_remains_valid(self):
        (self.directory / "xDriveSetup-amd64.exe").unlink()
        items = module.build(self.directory, SHA, "stable")["artifacts"]
        self.assertNotIn("windows", {x["platform"] for x in items})

    def test_omit_missing_client_platform_but_keep_other_verified_artifacts(self):
        (self.directory / "xDriveSetup-amd64.exe").unlink()
        result = module.build(self.directory, SHA, "master")
        self.assertEqual(len(result["artifacts"]), 6)
        self.assertNotIn("windows", {a["platform"] for a in result["artifacts"]})
        self.assertTrue(all(a["build_commit"] == SHA for a in result["artifacts"]))

    def test_server_only_release_is_valid_without_any_client_packages(self):
        for item in self.directory.iterdir():
            item.unlink()
        result = module.build(self.directory, SHA, "master")
        self.assertEqual(result["artifacts"], [])
        self.assertEqual(result["commit"], SHA)
        self.assertEqual(result["schema_version"], 1)

    def test_android_build_suffix_source_is_percent_encoded(self):
        name = "xdrive-android-12-0.1.3+build.apk"
        (self.directory / name).write_bytes(b"approved-signed-package-fixture")
        manifest = module.build(self.directory, SHA, "master")
        android, = [item for item in manifest["artifacts"] if item["platform"] == "android"]
        self.assertEqual(android["filename"], name)
        self.assertTrue(android["sources"]["github"].endswith(
            "/xdrive-android-12-0.1.3%2Bbuild.apk"))
        self.assertTrue(android["sources"]["gitlab"].endswith(
            "/xdrive-android-12-0.1.3%2Bbuild.apk"))

    def test_reject_short_sha(self):
        with self.assertRaises(ValueError):
            module.build(self.directory, "a" * 12, "master")

    def test_reject_symlink(self):
        path = self.directory / "xDriveSetup-amd64.exe"
        path.unlink()
        path.symlink_to(self.directory / "xdrive-linux-amd64.deb")
        with self.assertRaises(ValueError):
            module.build(self.directory, SHA, "master")


if __name__ == "__main__":
    unittest.main()
