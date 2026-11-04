"""Host Control signed offline request protocol: independently reject and forward."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
HOST = ROOT / "scripts/server-control.sh"
ID = "a" * 32
MANIFEST = "b" * 64
BINARY = "c" * 64


class TestHostSignedUpdateRequests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = Path(self.temp.name)
        self.log_dir = self.state / "logs"
        self.log_dir.mkdir()
        self.manager = self.state / "host-manager"
        self.manager.write_text(
            '#!/usr/bin/env bash\n'
            'printf "%s\\n" "$*" > "$TEST_ARGS"\n'
        )
        self.manager.chmod(0o700)
        source = HOST.read_text()
        start = source.index("process_request() {")
        end = source.index("\n}\n", start) + len("\n}")
        function = source[start:end]
        self.script = (
            "set -euo pipefail\n"
            'prepare_dir(){ printf "%s\\n" "$TEST_STATE"; }\n'
            "json_value(){ python3 -c 'import json,sys;"
            "print(json.load(open(sys.argv[1])).get(sys.argv[2],\"\"))' \"$1\" \"$2\"; }\n"
            "json_bool_value(){ python3 -c 'import json,sys;"
            "print(\"true\" if json.load(open(sys.argv[1])).get(sys.argv[2]) else \"false\")' \"$1\" \"$2\"; }\n"
            'request_time_is_fresh(){ [[ "$1" == "current" ]]; }\n'
            'now_utc(){ printf "%s\\n" "2026-11-04T00:00:00Z"; }\n'
            'write_status(){ printf "%s\\n" "$1" >> "$TEST_STATE/status.log"; }\n'
            'touch_heartbeat(){ :; }\n'
            'sync_progress(){ :; }\n'
            "MANAGER=" + json.dumps(str(self.manager)) + "\n"
            "LOG_DIR=" + json.dumps(str(self.log_dir)) + "\n"
            "XDRIVE_HOME=" + json.dumps(str(self.state)) + "\n"
            + function + "\n"
            "process_request\n"
        )

    def run_request(self, *, mode=None, manifest=None, binary=None, source="offline"):
        data = {
            "request_id": "offline-test-id",
            "created_at": "current",
            "source": source,
            "channel": "master",
            "offline_id": ID if source == "offline" else "",
            "backup_file_data": False,
        }
        if mode is not None:
            data["offline_trust_mode"] = mode
        if manifest is not None:
            data["trusted_manifest_sha256"] = manifest
        if binary is not None:
            data["trusted_installer_sha256"] = binary
        (self.state / "request.json").write_text(json.dumps(data))
        status_log = self.state / "status.log"
        status_log.unlink(missing_ok=True)
        args_file = self.state / "args.log"
        args_file.unlink(missing_ok=True)
        env = {
            **os.environ,
            "TEST_STATE": str(self.state),
            "TEST_ARGS": str(args_file),
        }
        result = subprocess.run(["bash", "-c", self.script], env=env,
                                text=True, capture_output=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        return (status_log.read_text().splitlines(),
                args_file.read_text() if args_file.exists() else "")

    def test_signed_request_never_forwards_untrusted_hashes(self):
        statuses, args = self.run_request(mode="sigstore")
        self.assertIn("success", statuses)
        self.assertIn("--offline-id " + ID, args)
        self.assertNotIn("--trusted-manifest-sha256", args)
        self.assertNotIn("--trusted-installer-sha256", args)

    def test_explicit_sha256_requires_and_forwards_both_digests(self):
        statuses, args = self.run_request(mode="sha256", manifest=MANIFEST, binary=BINARY)
        self.assertIn("success", statuses)
        self.assertIn("--trusted-manifest-sha256 " + MANIFEST, args)
        self.assertIn("--trusted-installer-sha256 " + BINARY, args)

    def test_legacy_dual_sha_remains_compatible(self):
        statuses, args = self.run_request(manifest=MANIFEST, binary=BINARY)
        self.assertIn("success", statuses)
        self.assertIn("--trusted-manifest-sha256", args)

    def test_signed_request_cannot_contain_manual_hashes(self):
        statuses, args = self.run_request(mode="sigstore", manifest=MANIFEST)
        self.assertIn("failed", statuses)
        self.assertFalse(args)

    def test_unknown_mode_is_not_an_execution_path(self):
        statuses, args = self.run_request(mode="shell")
        self.assertIn("failed", statuses)
        self.assertFalse(args)

    def test_manual_request_cannot_have_one_sha(self):
        statuses, args = self.run_request(mode="sha256", manifest=MANIFEST)
        self.assertIn("failed", statuses)
        self.assertFalse(args)

    def test_online_sources_cannot_take_offline_trust_mode(self):
        statuses, args = self.run_request(mode="sigstore", source="github")
        self.assertIn("failed", statuses)
        self.assertFalse(args)


if __name__ == "__main__":
    unittest.main()
