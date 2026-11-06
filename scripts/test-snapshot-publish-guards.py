#!/usr/bin/env python3
"""No whole-Release delete; verify remotely published assets before tag flip."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
release = (root / ".github/workflows/release.yml").read_text()
ci = (root / ".github/workflows/ci.yml").read_text()
marker = "      - name: Publish rolling snapshot prerelease\n"
assert release.count(marker) == 1
body = release.split(marker, 1)[1].split("        run: |\n", 1)[1].split("\n      - name:", 1)[0]
assert 'gh release delete snapshot --repo "$repo"' not in body
assert 'gh release upload snapshot release/* --repo "$repo" --clobber' in body
assert 'gh release create snapshot release/* --repo "$repo" --prerelease' in body
assert '--target "$GITHUB_SHA"' in body
assert 'gh api "repos/$repo/compare/$previous_snapshot...$GITHUB_SHA"' in body
assert '"$actual_names" == "$expected_names"' in body
assert '[.assets[] | select(.name == $n) | .digest]' in body
assert 'expected_digest="sha256:' in body
assert 'remote_complete=1' in body
assert 'Snapshot asset verification incomplete; preserving previous tag.' in body
assert 'gh release edit snapshot --repo "$repo" --prerelease' in body
upload = body.index('gh release upload snapshot')
verified = body.index('echo "[xDrive] all published Snapshot asset SHA-256 digests verified."')
promote = body.index('gh api --method PATCH "repos/$repo/git/refs/tags/snapshot"')
assert upload < verified < promote, "tag must only change after remote digest proof"
assert '[[' + ' "$current_tag" == "$previous_snapshot" ]]' in body
assert "python3 scripts/test-snapshot-publish-guards.py" in ci
# Regression: DSM ARMv7 Source Agent became a third real CI artifact.
# The publisher must not reject that valid binary or omit it from release
# checksum coverage. These checks retain the exact-file and no-symlink gates.
client_verification = release.split(
    "      - name: Verify exact client artifact contract\n", 1
)[1].split("\n  server-images:\n", 1)[0]
bundle_verification = release.split(
    "      - name: Verify single-installer distribution contract\n", 1
)[1].split("\n      - name: Generate checksums\n", 1)[0]
checksum_step = release.split(
    "      - name: Generate checksums\n", 1
)[1].split("\n      # Sigstore", 1)[0]

assert client_verification.count("for arch in amd64 arm64 armv7; do") == 1
assert 'binary="source-agent/xdrive-source-agent-linux-$arch"' in client_verification
assert '[[ -f "$binary" && -s "$binary" && ! -L "$binary" ]]' in client_verification
assert 'find source-agent -mindepth 1 -maxdepth 1' in client_verification
assert '[[' + ' "$source_count" == "3" ]]' in client_verification
assert bundle_verification.count("for arch in amd64 arm64 armv7; do") == 1
assert 'binary="release/xdrive-source-agent-linux-$arch"' in bundle_verification
assert '[[ -f "$binary" && -s "$binary" && ! -L "$binary" ]]' in bundle_verification
for arch in ("amd64", "arm64", "armv7"):
    assert f"xdrive-source-agent-linux-{arch} \\" in checksum_step
notify_marker = "      - name: Notify bounded queued-CI prune after verified Snapshot publication\n"
assert release.count(notify_marker) == 1
notify = release.split(notify_marker, 1)[1].split("\n      - name:", 1)[0]
assert "steps.snapshot_eligibility.outputs.publish == 'true'" in notify, (
    "superseded master publishers must not dispatch redundant cleanup runs"
)
assert "-f event_type=xdrive_snapshot_published" in notify
print("snapshot remote-asset verification and tag-last source contract passed")
