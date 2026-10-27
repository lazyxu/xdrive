#!/usr/bin/env python3
"""Verify the GitHub Release archive allowlist and prepublication guard."""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CHECK = ROOT / "scripts/ci/verify-release-archive-allowlist.sh"
WORKFLOW = (ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")

bundle = WORKFLOW.split("\n  bundle:\n", 1)[1]
call = "bash scripts/ci/verify-release-archive-allowlist.sh release"
assert bundle.count(call) == 2, "both prepublish and postpublish checks must reuse the same allowlist"
pre, post = (bundle.index(call), bundle.rindex(call))
assert bundle.index("      - uses: actions/checkout@v4") < pre, "bundle must checkout exact source before running the checker"
assert bundle.index("- name: Verify single-installer distribution contract") < pre < bundle.index("- name: Generate checksums"), "archives must be checked before signing and publication"
assert bundle.index("- name: Publish rolling snapshot prerelease") < post < bundle.index("- name: Publish GitHub Release"), "postpublish assertion must use the same allowlist"
assert "single-file installers/scripts must be published directly, not archive-wrapped" not in bundle, "obsolete blanket archive rejection must be removed"

with tempfile.TemporaryDirectory(prefix="xdrive-release-archive-") as directory:
    release = Path(directory) / "release"
    release.mkdir()
    linux = release / "xdrive-backup-linux-amd64.tar.gz"
    windows = release / "xdrive-backup-windows-amd64.zip"
    linux.write_bytes(b"fixture-linux-cli")
    windows.write_bytes(b"fixture-windows-cli")
    (release / "xdrive-caddy-image.tar.gz").write_bytes(b"fixture-caddy-archive")
    (release / "xdrive-caddy-image.id").write_bytes(("sha256:" + "0" * 64 + "\n").encode())
    (release / "xdrive-linux-amd64.deb").write_bytes(b"fixture-direct-installer")

    def verify(expected_success: bool, scenario: str) -> None:
        result = subprocess.run(["bash", str(CHECK), str(release)], capture_output=True, text=True, check=False)
        assert (result.returncode == 0) == expected_success, (
            f"{scenario}: expected {'success' if expected_success else 'failure'}; "
            f"exit={result.returncode}, stdout={result.stdout}, stderr={result.stderr}"
        )

    assert "name: xdrive-caddy-image" in bundle
    assert "cp caddy-image/image.tar.gz release/xdrive-caddy-image.tar.gz" in bundle
    assert "xdrive-caddy-image.tar.gz \\" in bundle
    assert "xdrive-caddy-image.id \\" in bundle
    verify(True, "two CLI archives and exact signed Caddy image archive")
    for name in ("other.zip", "other.tar.gz", "other.tgz", ".hidden.zip", "xdrive-desktop-amd64.zip"):
        extra = release / name
        extra.write_bytes(b"unexpected archive")
        verify(False, f"reject extra {name}")
        extra.unlink()
        verify(True, f"restore after {name}")
    linux.unlink()
    verify(False, "reject missing CLI package")
    linux.write_bytes(b"")
    verify(False, "reject empty CLI package")
    linux.write_bytes(b"fixture-linux-cli")
    verify(True, "restore Linux CLI")
    windows.unlink()
    windows.symlink_to(linux)
    verify(False, "reject linked CLI package")
    windows.unlink()
    windows.write_bytes(b"fixture-windows-cli")
    verify(True, "restore Windows CLI")
    caddy = release / "xdrive-caddy-image.tar.gz"
    caddy.unlink()
    verify(False, "reject missing Caddy image archive")
    caddy.write_bytes(b"fixture-caddy-archive")
    verify(True, "restore Caddy image archive")
    image_id = release / "xdrive-caddy-image.id"
    image_id.unlink()
    verify(False, "reject missing Caddy image identity")
    image_id.write_bytes(("sha256:" + "0" * 64 + "\n").encode())
    verify(True, "final valid distribution")

print("GitHub Snapshot exact Backup CLI archive allowlist: passed")
