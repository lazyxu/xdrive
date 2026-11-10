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
# Regression: no deleted Source Agent may be redistributed. Current-Commit
# Server publication is independent of optional client builds, but every
# present package must match the exact CI run and retain admission checks.
client_verification = release.split(
    "      - name: Verify every present client artifact without requiring missing platforms\n", 1
)[1].split("\n  server-images:\n", 1)[0]
bundle_verification = release.split(
    "      - name: Verify single-installer distribution contract\n", 1
)[1].split("\n      - name: Generate checksums\n", 1)[0]
checksum_step = release.split(
    "      - name: Generate checksums\n", 1
)[1].split("\n      # Sigstore", 1)[0]
assert release.count("bash scripts/ci/download-optional-client-artifacts.sh exact") == 1
assert release.count("bash scripts/ci/download-optional-client-artifacts.sh release") == 1
for required in (
    '[[ -f "$file" && -s "$file" && ! -L "$file" ]]',
    'unexpected source-run client package',
    'bash scripts/ci/verify-synology-spk-release.sh exact --require-mui',
    'xdrive-linux-amd64.deb', 'xDriveSetup-amd64.exe',
    'xdrive-backup-linux-amd64.tar.gz', 'xdrive-backup-windows-amd64.zip',
    'xdrivenas-armada38x-*.spk',
):
    assert required in client_verification, required
for required in (
    'bash scripts/ci/verify-synology-spk-release.sh release --require-mui',
    'bash scripts/ci/verify-release-archive-allowlist.sh release',
    'standalone Desktop installer must not be published',
):
    assert required in bundle_verification, required
for retired in ('source-agent/', 'xdrive-source-agent-linux-'):
    assert retired not in client_verification
    assert retired not in bundle_verification
    assert retired not in checksum_step
for artifact in (
    'xdrive-linux-amd64.deb',
    'xDriveSetup-amd64.exe',
    'xdrive-backup-linux-amd64.tar.gz',
    'xdrive-backup-windows-amd64.zip',
    'xdrivenas-armada38x-*.spk',
    'xdrivenas-armada38x-*.spk.sha256',
    'xdrive-server-install.sh',
    'xdrive-caddy-image.tar.gz',
    'xdrive-caddy-image.id',
):
    assert artifact in checksum_step, artifact
assert '[[ -s "$file" && ! -L "$file" ]]' in checksum_step
assert 'sha256sum "${optional[@]}"' in checksum_step
assert '> SHA256SUMS.txt' in checksum_step
# A slow/failed client build must never block publishing a healthy Server.
# The Bundle includes only actual same-run packages present at publish time.
master_publish = ci.split("\n  publish-master:\n", 1)[1].split("\n  publish-content-addressed-offline:", 1)[0]
master_needs = master_publish.split("    needs:\n", 1)[1].split("    permissions:\n", 1)[0]
for required in ("server-image", "caddy-image", "photo-face-image", "media-worker-image"):
    assert "      - " + required + "\n" in master_needs, required
for optional in ("build-client-core", "package-linux-client", "package-windows-client"):
    assert "      - " + optional + "\n" not in master_needs, optional
assert "needs.server-image.result == 'success'" in master_publish
assert "needs.caddy-image.result == 'success'" in master_publish
assert "needs.photo-face-image.result == 'success'" in master_publish
assert "needs.media-worker-image.result == 'success'" in master_publish

notify_marker = "      - name: Notify bounded queued-CI prune after verified Snapshot publication\n"
assert release.count(notify_marker) == 1
notify = release.split(notify_marker, 1)[1].split("\n      - name:", 1)[0]
assert "steps.snapshot_eligibility.outputs.publish == 'true'" in notify, (
    "superseded master publishers must not dispatch redundant cleanup runs"
)
assert "-f event_type=xdrive_snapshot_published" in notify
print("snapshot remote-asset verification and tag-last source contract passed")
