#!/usr/bin/env python3
"""Exercise smoke scripts with a streaming producer and genuine pipeline exits."""

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = (
    "gitlab-post-release-smoke.sh",
    "gitlab-release-version.sh",
    "gitlab-caddy-image.sh",
    "client-artifact-version.sh",
    "export-docker-image.sh",
)
DOCKER = r'''
import os
import sys

args = sys.argv[1:]
if args[0] == "login":
    sys.stdin.read()
elif args[0] in ("pull", "info", "build"):
    pass
elif args[:2] == ["image", "inspect"]:
    print("snapshot" if any("image.version" in arg for arg in args)
          else "sha256:" + "1" * 64)
elif args[0] == "save":
    print("synthetic archive for the export command boundary")
elif args[0] == "run":
    if "list-modules" in args:
        probe, line = "caddy-modules", "dns.providers.alidns"
    elif "validate" in args:
        probe, line = "caddy-config", None
    elif "/usr/bin/ffmpeg" in args:
        probe, line = "ffmpeg", "ffmpeg version 7.1"
    elif "/usr/bin/ffprobe" in args:
        probe, line = "ffprobe", "ffprobe version 7.1"
    elif "--self-test" in args:
        probe, line = "face", None
    elif "version" in args:
        probe, line = "server-version", "server version: snapshot"
    elif args[-3:] == ["test", "-f", "/srv/index.html"]:
        sys.exit(0)
    else:
        raise SystemExit("unexpected docker run arguments: " + repr(args))
    selected = os.environ.get("SMOKE_PROBE") == probe
    if line is not None:
        if selected and os.environ.get("SMOKE_MODE") == "malformed":
            line = "unexpected output"
        try:
            os.write(1, (line + "\n").encode())
            # Far larger than a pipe buffer: an early successful grep must not
            # close the stream while Docker is still forwarding later output.
            for _ in range(128):
                os.write(1, b"x" * 8191 + b"\n")
        except BrokenPipeError:
            print("docker producer: stdout closed before EOF", file=sys.stderr)
            sys.exit(86)
    if selected and os.environ.get("SMOKE_MODE") == "failure":
        sys.exit(23)
else:
    raise SystemExit("unexpected docker arguments: " + repr(args))
'''


class ImageSmokePipelines(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="gitlab-image-smoke-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        scripts = self.root / "scripts" / "ci"
        scripts.mkdir(parents=True)
        for name in SCRIPTS:
            shutil.copyfile(ROOT / "scripts" / "ci" / name, scripts / name)
        web = self.root / "web" / "dist"
        web.mkdir(parents=True)
        (web / "index.html").write_text("test", encoding="utf-8")
        fake_bin = self.root / "fake-bin"
        fake_bin.mkdir()
        (fake_bin / "docker.py").write_text(DOCKER, encoding="utf-8")
        wrapper = fake_bin / "docker"
        wrapper.write_text(
            '#!/usr/bin/env bash\nexec "$SMOKE_PYTHON" "$SMOKE_DOCKER" "$@"\n',
            encoding="utf-8",
        )
        wrapper.chmod(0o755)
        self.env = os.environ.copy()
        for key in ("GITHUB_SHA", "GITHUB_REF", "GITHUB_REF_TYPE", "GITHUB_REF_NAME"):
            self.env.pop(key, None)
        self.env.update(
            PATH=str(fake_bin) + os.pathsep + self.env["PATH"],
            SMOKE_PYTHON=Path(sys.executable).as_posix(),
            SMOKE_DOCKER=(fake_bin / "docker.py").as_posix(),
            MSYS_NO_PATHCONV="1",
            CI_COMMIT_SHA="0123456789abcdef0123456789abcdef01234567",
            CI_COMMIT_BRANCH="master",
            CI_COMMIT_TAG="",
            CI_REGISTRY="registry.example.invalid",
            CI_REGISTRY_IMAGE="registry.example.invalid/xdrive",
            CI_REGISTRY_USER="test-user",
            CI_REGISTRY_PASSWORD="synthetic-test-value",
            XDRIVE_GITLAB_PACKAGE_ONLY="0",
        )

    def run_smoke(self, script, probe="", mode=""):
        return subprocess.run(
            [os.environ.get("XDRIVE_TEST_BASH") or shutil.which("bash"),
             str(self.root / "scripts" / "ci" / script)],
            cwd=self.root,
            env=dict(self.env, SMOKE_PROBE=probe, SMOKE_MODE=mode),
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
        )

    def assert_exit(self, result, code):
        self.assertEqual(result.returncode, code, result.stdout[-1000:] + result.stderr[-2000:])

    def test_successful_streams_are_drained_to_eof(self):
        for script in ("gitlab-post-release-smoke.sh", "gitlab-caddy-image.sh"):
            with self.subTest(script=script):
                self.assert_exit(self.run_smoke(script), 0)

    def test_valid_banner_does_not_hide_upstream_failure(self):
        for probe in ("server-version", "caddy-modules", "ffmpeg", "ffprobe", "caddy-config", "face"):
            with self.subTest(probe=probe):
                self.assert_exit(self.run_smoke("gitlab-post-release-smoke.sh", probe, "failure"), 23)
        self.assert_exit(self.run_smoke("gitlab-caddy-image.sh", "caddy-modules", "failure"), 23)

    def test_missing_expected_output_remains_a_failure(self):
        for probe in ("server-version", "caddy-modules", "ffmpeg", "ffprobe"):
            with self.subTest(probe=probe):
                self.assert_exit(self.run_smoke("gitlab-post-release-smoke.sh", probe, "malformed"), 1)
        self.assert_exit(self.run_smoke("gitlab-caddy-image.sh", "caddy-modules", "malformed"), 1)


if __name__ == "__main__":
    unittest.main()
