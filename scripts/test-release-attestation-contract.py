#!/usr/bin/env python3
"""Statically guard the reusable release signer and both calling permissions."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
release = (root / ".github/workflows/release.yml").read_text()
ci = (root / ".github/workflows/ci.yml").read_text()
host = (root / "scripts/xdrive-server-host.sh").read_text()
bundle = release.split("\n  bundle:", 1)[1]
assert "      id-token: write" in bundle
assert "      attestations: write" in bundle
for fragment in (
    "uses: actions/attest@v4",
    "release/xdrive-server-install.sh",
    "release/SHA256SUMS.txt",
    "release/xdrive-release-attestation.json",
    "gh attestation verify release/xdrive-server-install.sh",
    "gh attestation verify release/SHA256SUMS.txt",
    '--source-ref "$GITHUB_REF"',
    '--signer-workflow "$GITHUB_REPOSITORY/.github/workflows/release.yml"',
):
    assert fragment in bundle, fragment
for label in ("publish-master", "publish-stable"):
    section = ci.split(f"\n  {label}:", 1)[1].split("    uses: ./.github/workflows/release.yml", 1)[0]
    assert "      id-token: write" in section, label
    assert "      attestations: write" in section, label
assert "XD_GITHUB_ATTESTATION_POLICY" in host
assert 'gh attestation verify "$installer"' in host
assert 'gh attestation verify "$manifest"' in host
print("GitHub release provenance contract passed")
