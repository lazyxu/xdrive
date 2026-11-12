"""Source-exact independent xd/Agent archives; no binary stubs in releases."""
import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import tarfile
import tempfile
import unittest
import zipfile

SPEC = importlib.util.spec_from_file_location(
    "package_standalone_cli", Path(__file__).with_name("package-standalone-cli.py"))
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)
SHA = "a" * 40


class PortableStandaloneCLITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.core = self.root / "core"
        self.dest = self.root / "output"
        for relative in module.LINUX + module.WINDOWS:
            file = self.core / relative
            file.parent.mkdir(parents=True, exist_ok=True)
            if relative in module.LINUX:
                file.write_text("#!/usr/bin/env python3\nimport json\n"
                                "print(json.dumps({'commit':'" + SHA + "'}))\n")
                file.chmod(file.stat().st_mode | stat.S_IXUSR)
            else:
                file.write_bytes(("ORIGINAL:" + relative).encode())
        self.doc = self.root / "README.md"
        self.doc.write_text("Manual CLI only. No Desktop.\n")

    def build(self, sha=SHA):
        return module.build(self.core, self.dest, sha, readme=self.doc)

    def test_binary_identity_and_exact_member_allowlist(self):
        linux, windows = self.build()
        with tarfile.open(linux, "r:gz") as archive:
            self.assertEqual(set(archive.getnames()), {
                "xdrive-cli", "xdrive-cli/README.md",
                "xdrive-cli/xd", "xdrive-cli/xdrive-agent",
            })
            self.assertTrue(archive.getmember("xdrive-cli").isdir(),
                            "archive root must be an actual directory entry")
            self.assertEqual(archive.extractfile("xdrive-cli/xd").read(),
                             (self.core / "linux-amd64/xd").read_bytes())
            self.assertIn(SHA.encode(), archive.extractfile("xdrive-cli/README.md").read())
        with zipfile.ZipFile(windows) as archive:
            self.assertEqual(set(archive.namelist()), {
                "xdrive-cli/README.md", "xdrive-cli/xd.exe",
                "xdrive-cli/xdrive-agent.exe",
            })
            self.assertEqual(archive.read("xdrive-cli/xd.exe"),
                             (self.core / "windows-amd64/xd.exe").read_bytes())
        with self.assertRaisesRegex(ValueError, "empty directory"):
            self.build()

    def test_reject_missing_symlink_wrong_commit_and_short_commit(self):
        with self.assertRaisesRegex(ValueError, "40-character"):
            self.build("a" * 12)
        (self.core / "linux-amd64/xd").unlink()
        (self.core / "linux-amd64/xd").symlink_to(self.core / "linux-amd64/xdrive-agent")
        with self.assertRaisesRegex(ValueError, "symlinked"):
            self.build()
        (self.core / "linux-amd64/xd").unlink()
        (self.core / "linux-amd64/xd").write_text(
            "#!/usr/bin/env python3\nimport json\nprint(json.dumps({'commit':'" +
            "b" * 40 + "'}))\n")
        (self.core / "linux-amd64/xd").chmod(0o755)
        with self.assertRaisesRegex(ValueError, "source Commit mismatch"):
            self.build()

    def test_reproducible_bytes_from_the_same_verified_core(self):
        linux, windows = self.build()
        before = (hashlib.sha256(linux.read_bytes()).hexdigest(),
                  hashlib.sha256(windows.read_bytes()).hexdigest())
        linux.unlink()
        windows.unlink()
        linux, windows = self.build()
        self.assertEqual(before, (hashlib.sha256(linux.read_bytes()).hexdigest(),
                                  hashlib.sha256(windows.read_bytes()).hexdigest()))


if __name__ == "__main__":
    unittest.main()
