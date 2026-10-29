#!/usr/bin/env python3
"""Source contract for uninterrupted master snapshot publishing.

GitHub Actions cancellation is evaluated at the workflow level, including the
publish-master job. Do not make rolling releases dependent on a quiet master.
"""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
ci = (root / ".github/workflows/ci.yml").read_text(encoding="utf-8")
workflow_header, sep, jobs = ci.partition("\njobs:\n")
assert sep, "CI workflow jobs section missing"
concurrency = re.search(
    r"(?ms)^concurrency:\s*\n((?:[ \t]+[^\n]*\n)+)",
    workflow_header,
)
assert concurrency is not None, "workflow-level concurrency required"
section = concurrency.group(1)
# Duplicate YAML keys could silently override the intended group. Guard the
# single evaluated key as well as its exact PR-number/run-ID fallback.
assert re.findall(r"(?m)^  group: (.+)$", section) == [
    "ci-${{ github.event.pull_request.number || github.run_id }}"
], "workflow must have one unique-per-run master concurrency group"
assert re.search(
    r"(?m)^  group: ci-\$\{\{ github\.event\.pull_request\.number \|\| github\.run_id \}\}$",
    section,
), "PRs must share a cancellation group, but each master push must get a unique pending slot"
assert re.search(
    r"(?m)^  cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}$",
    section,
), "Only superseded PR runs may be cancelled; master publication must survive"
assert "github.ref" not in section, "reference-based master groups cancel older pending snapshots"

final_gate = re.search(
    r"(?ms)^  final-gate:\n(.*?)(?=^  [a-zA-Z0-9_-]+:\s*$|\Z)",
    jobs,
)
assert final_gate is not None, "final-gate job missing"
assert "    if: ${{ !cancelled() }}" in final_gate.group(1), (
    "final-gate must aggregate failures, but cancel when the workflow is cancelled"
)
assert "    if: always()" not in final_gate.group(1), (
    "always() leaves cancelled CI with a queued final-gate"
)

publish_master = re.search(
    r"(?ms)^  publish-master:\s*\n(.*?)(?=^  [a-zA-Z0-9_-]+:\s*$|\Z)",
    jobs,
)
assert publish_master is not None, "early master publication job missing"
body = publish_master.group(1)
assert "github.event_name == 'push'" in body
assert "github.ref == 'refs/heads/master'" in body
assert "needs:" in body
needed = set(re.findall(r"(?m)^      - ([a-zA-Z0-9_-]+)$", body))
required_builds = {
    "build-source-agent",
    "package-linux-client",
    "package-windows-client",
    "server-image",
    "caddy-image",
    "photo-face-image",
    "media-worker-image",
}
assert required_builds <= needed, f"required publishable artifacts missing: {required_builds - needed}"
assert "final-gate" not in needed, "snapshot must not wait for full race/E2E Final Gate"
assert "photo-ocr-master-smoke" not in needed, "snapshot must not wait for OCR model acceptance"

publish_stable = re.search(
    r"(?ms)^  publish-stable:\s*\n(.*?)(?=^  [a-zA-Z0-9_-]+:\s*$|\Z)",
    jobs,
)
assert publish_stable is not None
stable_needs_match = re.search(r"(?m)^    needs: \[([^\]]+)\]$", publish_stable.group(1))
assert stable_needs_match is not None, "stable tags must name explicit dependencies"
stable_needs = {name.strip() for name in stable_needs_match.group(1).split(",")}
assert {"final-gate", "photo-ocr-master-smoke"} <= stable_needs, (
    "stable tags require complete Final Gate and real-model OCR acceptance"
)

# Builds from different master commits can now complete out of order. The
# floating release/edge promotion must be a FIFO queue with an ancestry
# barrier before any channel tag is updated.
release = (root / ".github/workflows/release.yml").read_text(encoding="utf-8")
idx = release.find("  bundle:")
assert idx >= 0, "missing exact release bundle job"
bundle = release[idx:]
assert """    concurrency:
      group: xdrive-release-promote-${{ github.ref }}
      queue: max
      cancel-in-progress: false
""" in bundle, "release bundle must queue without discarding pending publishers"
assert "Classify stale master Snapshot eligibility before channel promotion" in bundle
assert 'echo "publish=false" >> "$GITHUB_OUTPUT"' in bundle
assert "::notice title=Superseded Snapshot" in bundle
assert "Diverged Snapshot ancestry" in bundle
assert bundle.index("- name: Classify stale master Snapshot eligibility before channel promotion") < (
    bundle.index("- name: Promote successful server images")
), "a stale completed build must not overwrite GHCR edge before being rejected"


# The standalone APK is disposable and has no Snapshot publish dependency.
# Keep only the newest automatic master push APK; preserve each manual build.
apk = (root / ".github/workflows/android-master-apk.yml").read_text(encoding="utf-8")
header, marker, apk_jobs = apk.partition("\njobs:\n")
assert marker, "Android Master APK jobs are missing"
assert "push:\n    branches: [master]" in header
assert "  workflow_dispatch:" in header
assert header.count("\nconcurrency:\n") == 1
apk_group = re.findall(r"(?m)^  group: (.+)$", header)
assert apk_group == [
    "xdrive-android-master-apk-${{ github.event_name == 'push' && github.ref == 'refs/heads/master' && 'latest-master' || github.run_id }}"
], "Android automatic APK must share the master slot while manual runs stay unique"
apk_cancel = re.findall(r"(?m)^  cancel-in-progress: (.+)$", header)
assert apk_cancel == [
    "${{ github.event_name == 'push' && github.ref == 'refs/heads/master' }}"
], "only outdated automatic master APKs may be cancelled"
assert "  build-master-apk:" in apk_jobs and "    if: github.ref == 'refs/heads/master'" in apk_jobs
assert "    needs:" not in apk_jobs, "Android debug Artifact must remain independent of Snapshot and required CI"
assert 'ref: ${{ github.sha }}' in apk_jobs
assert 'test "$(git rev-parse HEAD)" = "$GITHUB_SHA"' in apk_jobs
assert "Upload exact-master Android APK" in apk_jobs
assert "retention-days: 30" in apk_jobs

# Snapshot App auth must use a numeric JWT issuer; an Iv1. Client ID creates
# repeated 401 failures on the live GitHub endpoint.
smoke = (root / ".github/workflows/snapshot-publisher-auth-smoke.yml").read_text(encoding="utf-8")
auth_script = (root / "scripts/ci/mint-snapshot-publisher-token.sh").read_text(encoding="utf-8")
assert "SNAPSHOT_APP_ID: ${{ vars.XD_SNAPSHOT_APP_ID || secrets.XD_SNAPSHOT_APP_ID }}" in release
assert "XD_SNAPSHOT_APP_ID: ${{ env.SNAPSHOT_APP_ID }}" in release
assert "run: bash scripts/ci/mint-snapshot-publisher-token.sh" in release
assert "XD_SNAPSHOT_APP_ID: ${{ vars.XD_SNAPSHOT_APP_ID || secrets.XD_SNAPSHOT_APP_ID }}" in smoke
assert "run: bash scripts/ci/mint-snapshot-publisher-token.sh" in smoke
assert '--argjson iss "$XD_SNAPSHOT_APP_ID"' in auth_script
assert 'select([.repositories[]?.full_name] == [$repo])' in auth_script
assert 'client-id:' not in release
assert 'client-id:' not in smoke

print("master Snapshot and disposable Android APK concurrency contract passed")
