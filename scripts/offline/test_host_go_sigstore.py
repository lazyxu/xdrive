"""Host bootstrap Sigstore policy: no imported Go executable verifies itself."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest


REPO = Path(__file__).resolve().parents[2]
HOST = REPO / "scripts/xdrive-server-host.sh"
ID = "a" * 32
COMMIT = "0123456789abcdef0123456789abcdef01234567"


class TestOfflineGoHostSigstore(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.config = self.root / "config"
        self.trust_dir = self.config / "offline-trust"
        self.trust_dir.mkdir(parents=True)
        self.trust_dir.chmod(0o700)
        self.trust_root = self.trust_dir / "trusted-root.jsonl"
        self.trust_root.write_text("out-of-band trusted root\n")
        self.trust_root.chmod(0o600)
        self.import_dir = self.root / "state" / "update-imports" / ID
        self.import_dir.mkdir(parents=True)
        (self.import_dir / "manifest.json").write_text('{"schema":2}\n')
        (self.import_dir / "delivery.json").write_text('{"schema":1}\n')
        (self.import_dir / "delivery-attestation.jsonl").write_text("bundle\n")
        self.tool = self.import_dir / "xdrive-offline-linux-amd64"
        self.tool.write_text(
            '#!/usr/bin/env bash\n'
            'printf "%s\\n" "$*" >> "$TEST_INSTALL_LOG"\n'
        )
        self.tool.chmod(0o700)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        gh = self.bin / "gh"
        gh.write_text(r"""#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == attestation && "$2" == verify ]] || exit 40
artifact="$3"
shift 3
[[ "$artifact" == */manifest.json || "$artifact" == */delivery.json ||
   "$artifact" == */xdrive-offline-linux-amd64 ]] || exit 41
repo="" workflow="" ref="" bundle="" trusted="" output="" query="" deny=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) repo="$2"; shift 2 ;;
    --bundle) bundle="$2"; shift 2 ;;
    --custom-trusted-root) trusted="$2"; shift 2 ;;
    --signer-workflow) workflow="$2"; shift 2 ;;
    --source-ref) ref="$2"; shift 2 ;;
    --deny-self-hosted-runners) deny=1; shift ;;
    --format) output="$2"; shift 2 ;;
    --jq) query="$2"; shift 2 ;;
    *) echo "unexpected flag $1" >&2; exit 42 ;;
  esac
done
[[ "$repo" == lazyxu/xdrive &&
   "$workflow" == lazyxu/xdrive/.github/workflows/offline-packages.yml &&
   "$ref" == refs/heads/master && "$deny" == 1 && "$output" == json ]] || exit 43
[[ "$query" == *sourceRepositoryIdentifier* && "$query" == *sourceRepositoryDigest* ]] || exit 44
[[ -s "$bundle" && -s "$trusted" ]] || exit 45
basename "$artifact" >> "$TEST_GH_LOG"
[[ "$TEST_GH_FAIL" != 1 && ( -z "${TEST_GH_FAIL_SUBJECT:-}" || "$(basename "$artifact")" != "$TEST_GH_FAIL_SUBJECT" ) ]] || exit 46
commit="$TEST_SIGNER_COMMIT"
if [[ "$TEST_SPLIT_COMMIT" == 1 && "$artifact" == */delivery.json ]]; then
  commit=ffffffffffffffffffffffffffffffffffffffff
fi
printf '%s\t%s\n' "$TEST_SIGNER_REPO_ID" "$commit"
""")
        gh.chmod(0o700)
        self.installed = self.root / "install.log"
        self.gh_log = self.root / "gh.log"
        self.env = {
            **os.environ,
            "PATH": str(self.bin) + os.pathsep + os.environ.get("PATH", ""),
            "TEST_INSTALL_LOG": str(self.installed),
            "TEST_GH_LOG": str(self.gh_log),
            "TEST_GH_FAIL": "0",
            "TEST_GH_FAIL_SUBJECT": "",
            "TEST_SIGNER_REPO_ID": "1382670236",
            "TEST_SIGNER_COMMIT": COMMIT,
            "TEST_SPLIT_COMMIT": "0",
        }
        code = HOST.read_text()
        begin = code.index("offline_go_verify_sigstore() (")
        end = code.index("\nupdate_cmd() (", begin)
        self.functions = code[begin:end]

    def run_update(self, manual=False, env=None, wrong_hash=False):
        args = ["--source offline", "--channel master", "--offline-id " + ID]
        if manual:
            for name, target in (
                ("manifest", self.import_dir / "manifest.json"),
                ("installer", self.tool),
            ):
                digest = hashlib.sha256(target.read_bytes()).hexdigest()
                if wrong_hash and name == "installer":
                    digest = "0" * 64
                args.append("--trusted-" + name + "-sha256 " + digest)
        script = "\n".join([
            "#!/usr/bin/env bash",
            "set -euo pipefail",
            "CONFIG_DIR=" + shlex.quote(str(self.config)),
            "STATE_DIR=" + shlex.quote(str(self.root / "state")),
            "XDRIVE_HOME=" + shlex.quote(str(self.root)),
            self.functions,
            "offline_go_update " + " ".join(args),
        ])
        return subprocess.run(
            ["bash", "-c", script], text=True, capture_output=True,
            env=env or self.env, check=False,
        )

    def test_verified_local_bundle_does_not_require_manual_sha(self):
        result = self.run_update()
        self.assertEqual(result.returncode, 0, result.stderr)
        logs = self.installed.read_text().splitlines()
        self.assertEqual([line.split()[0] for line in logs], ["verify", "install"])
        signed_delivery_sha = hashlib.sha256(
            (self.import_dir / "delivery.json").read_bytes()
        ).hexdigest()
        self.assertTrue(all(
            "--trusted-delivery-sha256 " + signed_delivery_sha in line for line in logs
        ), logs)
        self.assertEqual(self.gh_log.read_text().splitlines(), [
            "manifest.json", "delivery.json", "xdrive-offline-linux-amd64"
        ])

    def test_unconfigured_root_requires_both_independent_hashes(self):
        self.trust_root.unlink()
        self.assertNotEqual(self.run_update().returncode, 0)
        result = self.run_update(manual=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.gh_log.exists())
        logs = self.installed.read_text().splitlines()
        self.assertEqual([line.split()[0] for line in logs], ["verify", "install"])
        self.assertTrue(all("--trusted-delivery-sha256" not in line for line in logs))

    def test_bad_signature_never_falls_back_to_manual_hashes(self):
        env = {**self.env, "TEST_GH_FAIL": "1"}
        result = self.run_update(manual=True, env=env)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.installed.exists())

    def test_later_signed_subject_failure_rejects_before_execution(self):
        # A signed Manifest cannot authorize an unverified delivery or Go ELF.
        for failed_name in ("delivery.json", "xdrive-offline-linux-amd64"):
            with self.subTest(subject=failed_name):
                env = {**self.env, "TEST_GH_FAIL_SUBJECT": failed_name}
                result = self.run_update(manual=True, env=env)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(self.installed.exists())
                self.gh_log.unlink(missing_ok=True)

    def test_wrong_repository_id_rejected(self):
        env = {**self.env, "TEST_SIGNER_REPO_ID": "99999"}
        self.assertNotEqual(self.run_update(env=env).returncode, 0)
        self.assertFalse(self.installed.exists())

    def test_mixed_signed_source_commits_rejected(self):
        env = {**self.env, "TEST_SPLIT_COMMIT": "1"}
        self.assertNotEqual(self.run_update(env=env).returncode, 0)
        self.assertFalse(self.installed.exists())

    def test_missing_attestation_rejected_even_with_manual_hashes(self):
        (self.import_dir / "delivery-attestation.jsonl").unlink()
        self.assertNotEqual(self.run_update(manual=True).returncode, 0)
        self.assertFalse(self.installed.exists())

    def test_untrusted_root_permissions_rejected(self):
        self.trust_root.chmod(0o666)
        self.assertNotEqual(self.run_update().returncode, 0)
        self.assertFalse(self.installed.exists())

    def test_manual_hash_must_match_verified_subject(self):
        self.assertNotEqual(self.run_update(manual=True, wrong_hash=True).returncode, 0)
        self.assertFalse(self.installed.exists())


if __name__ == "__main__":
    unittest.main()
