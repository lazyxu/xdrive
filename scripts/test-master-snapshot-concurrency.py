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
assert "Reject stale master snapshot before channel promotion" in bundle
assert "Refusing stale Snapshot promotion before channel update" in bundle
assert bundle.index("- name: Reject stale master snapshot before channel promotion") < (
    bundle.index("- name: Promote successful server images")
), "a stale completed build must not overwrite GHCR edge before being rejected"

print("master snapshot concurrency / early publication contract passed")
