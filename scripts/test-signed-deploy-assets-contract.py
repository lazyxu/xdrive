#!/usr/bin/env python3
"""Keep the release-time source inventory aligned with the signed installer."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
installer = (root / "deploy/install-server.sh").read_text()
release = (root / ".github/workflows/release.yml").read_text()
assets = [
    "deploy/docker-compose.yml",
    "scripts/server-backup.sh",
    "scripts/server-backup-scheduled.sh",
    "scripts/server-restore.sh",
    "scripts/server-verify.sh",
    "scripts/server-doctor.sh",
    "scripts/server-migrate-user.sh",
    "scripts/server-control.sh",
    "scripts/caddy-env-config.py",
    "scripts/caddy-admission.py",
    "scripts/xdrive-server-host.sh",
]
assert len(assets) == len(set(assets)) == 11
for asset in assets:
    assert asset in installer, f"installer missing {asset}"
    assert asset in release, f"release manifest missing {asset}"
assert 'EMBEDDED_DEPLOY_ASSET_MANIFEST_B64="@DEPLOY_ASSET_MANIFEST_B64@"' in installer
assert 'verify_embedded_deploy_assets' in installer
assert 'deploy_hash_manifest_b64="$(base64 -w0 "$deploy_hash_manifest")"' in release
assert '-e "s|@DEPLOY_ASSET_MANIFEST_B64@|$deploy_hash_manifest_b64|g"' in release
assert "all ${#sources[@]} signed release deployment asset SHA-256 checks passed." in installer
print("Signed deployment asset manifest source contract passed")
