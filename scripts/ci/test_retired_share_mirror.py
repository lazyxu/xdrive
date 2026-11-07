"""The optional GitHub-to-Share mirror is retired, not merely paused."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class RetiredShareMirrorContract(unittest.TestCase):
    def test_no_client_mirror_workflow_or_upload_entry_points(self):
        for name in (
            ".github/workflows/client-artifact-share-mirror.yml",
            "scripts/ci/collect-client-share-mirror.sh",
            "scripts/ci/mirror-clients-to-share.py",
            "scripts/ci/test-mirror-clients-to-share.py",
            "docs/client-artifact-share-mirror.md",
        ):
            self.assertFalse((ROOT / name).exists(), name + " must remain retired")

    def test_signed_github_publishing_remains_and_no_share_secret_or_upload(self):
        offline = (ROOT / ".github/workflows/offline-packages.yml").read_text()
        ci = (ROOT / ".github/workflows/ci.yml").read_text()
        publisher = (ROOT / "scripts/ci/mirror-server-to-share.py").read_text()
        self.assertIn("uses: ./.github/workflows/offline-packages.yml", ci)
        self.assertIn("  publish-master:\n", ci)
        self.assertIn("  publish-content-addressed-offline:\n", ci)
        offline_call = ci.split("  publish-content-addressed-offline:\n", 1)[1].split("\n  publish-stable:", 1)[0]
        self.assertNotIn("secrets: inherit", offline_call)
        for required in ("publish-packages --directory", "publish-github --directory",
                         "gh attestation verify", "actions/attest@v4"):
            self.assertIn(required, offline)
        for retired in ("XDRIVE_CLIENT_MIRROR_ENABLED", "XDRIVE_CLIENT_MIRROR_SHARE_URL",
                        "XDRIVE_CLIENT_MIRROR_SHARE_PASSWORD",
                        "Mirror exact published server packages into Share",
                        "mirror-server-to-share.py publish --directory"):
            self.assertNotIn(retired, offline)
            self.assertNotIn(retired, ci)
            self.assertNotIn(retired, publisher)
        self.assertNotIn("def publish(directory, share):", publisher)
        self.assertNotIn("class Share(", publisher)
        self.assertIn("def publish_github(directory, commit, github):", publisher)
        self.assertIn("def publish_packages(directory, commit, github):", publisher)


if __name__ == "__main__":
    unittest.main()
