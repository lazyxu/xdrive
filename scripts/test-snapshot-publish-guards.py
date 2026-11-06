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
# The standalone DSM Photos Push Agent is retired from new builds, while
# Snapshot may still carry legacy binaries from its previous release.
# Only the three exact historical names may be deleted after remote digest
# verification; no new Source Agent build/download/checksum can reappear.
assert "build-source-agent:" not in ci
assert "test-source-agent-artifact:" not in ci
assert "name: xdrive-source-agent-linux" not in release
assert "xdrive-source-agent-linux-" in body
assert '[[ "$old_asset_name" =~ ^xdrive-source-agent-linux-(amd64|arm64|armv7)$ ]]' in body
assert body.index('if [[ "$digest_mismatch" == 0 ]]') < body.index('Removing superseded Snapshot asset:')
assert "xdrive-source-agent-linux-" not in release.split(
    "      - name: Generate checksums\n", 1
)[1].split("\n      # Sigstore", 1)[0]
notify_marker = "      - name: Notify bounded queued-CI prune after verified Snapshot publication\n"
assert release.count(notify_marker) == 1
notify = release.split(notify_marker, 1)[1].split("\n      - name:", 1)[0]
assert "steps.snapshot_eligibility.outputs.publish == 'true'" in notify, (
    "superseded master publishers must not dispatch redundant cleanup runs"
)
assert "-f event_type=xdrive_snapshot_published" in notify
print("snapshot remote-asset verification and tag-last source contract passed")
