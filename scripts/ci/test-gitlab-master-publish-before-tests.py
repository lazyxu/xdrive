#!/usr/bin/env python3
"""GitLab is a release-only publisher; GitHub owns tests and Final Gate.

Keep the exact artifact dependency DAG and fail-closed publication while
preventing GitLab from consuming runners for duplicate test suites.
This source-only contract runs on GitHub Actions, not in GitLab CI.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CI = (ROOT / ".gitlab-ci.yml").read_text(encoding="utf-8")
RELEASE = (ROOT / "infra/ci/gitlab-release.yml").read_text(encoding="utf-8")


def blocks(source):
    entries = list(re.finditer(r"(?m)^([A-Za-z0-9_.-]+):\s*$", source))
    return {
        entry.group(1): source[
            entry.end():entries[i + 1].start() if i + 1 < len(entries) else len(source)
        ]
        for i, entry in enumerate(entries)
    }


ci_jobs = blocks(CI)
release_jobs = blocks(RELEASE)
all_jobs = {**ci_jobs, **release_jobs}
release_only = '$CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == "master" && $CI_REGISTRY_IMAGE'

required_builds = {
    "desktop-linux", "desktop-windows", "build-synology-ui", "build-client-core",
    "build-source-agent", "package-linux-client", "server-image",
    "media-worker-image", "photo-face-image", "caddy-image",
    "package-windows-client", "web",
}
required_publishers = {
    "release-assets", "publish-server-images", "promote-server-images", "publish-release",
}
assert {name for name, block in ci_jobs.items() if "  stage: " in block} == required_builds
assert {name for name, block in release_jobs.items() if "  stage: " in block} == required_publishers

stages = re.findall(r"(?m)^  - ([\w-]+)$", ci_jobs["stages"])
assert stages == ["build", "package", "release-build", "promote", "release"], stages
workflow = ci_jobs["workflow"]
assert 'CI_COMMIT_TAG =~ /^v.+/' in workflow
assert release_only in workflow
assert 'merge_request_event' not in workflow
assert 'CI_PIPELINE_SOURCE == "web"' not in workflow
assert "    - when: never" in workflow
assert 'XDRIVE_GITLAB_PACKAGE_ONLY: "1"' in ci_jobs["variables"]

for name, block in all_jobs.items():
    if name in required_builds | required_publishers:
        assert "      allow_failure: true" not in block, f"{name}: mandatory release step became optional"
        assert "  stage: test" not in block and "  stage: verify" not in block
        assert "post-release-test" not in block and "final-gate" not in block
    for need in re.findall(r"(?m)^\s+- job: ([\w-]+)$", block):
        assert need in all_jobs, f"{name}: missing job in needs: {need}"

for name in required_builds:
    block = ci_jobs[name]
    assert re.search(r"(?m)^  stage: (build|package)$", block), name
    assert "    - when: on_success" in block, name

for name in ("server-image", "media-worker-image", "photo-face-image", "caddy-image"):
    block = ci_jobs[name]
    assert "XDRIVE_GITLAB_PACKAGE_ONLY=1" in block, name
    assert "XDRIVE_CI_GO_IMAGE" in block, name
    assert "*install_docker_cli_only" in block, name

assert "npm run lint" not in ci_jobs["web"]
core = ci_jobs["build-client-core"]
assert "test-synology-spk.py" not in core
assert "test-synology-spk-ui.py" not in core
assert "test-synology-release.sh" not in core
assert "test-backup-cli-archives.sh" not in core
assert "verify-synology-spk-release.sh release/synology --require-mui" in core
assert "web/dist-synology" in core

for name in required_publishers:
    block = release_jobs[name]
    assert release_only in block, name
    assert "CI_COMMIT_TAG =~ /^v.+/'" in block, name
    assert "      when: on_success" in block, name

assert "build-source-agent" in release_jobs["release-assets"]
for name in ("server-image", "caddy-image", "photo-face-image", "media-worker-image"):
    assert name in release_jobs["publish-server-images"], name
assert "release-assets" in release_jobs["promote-server-images"]
assert "publish-server-images" in release_jobs["promote-server-images"]
snapshot_publisher = (ROOT / "scripts/ci/gitlab-publish-release.sh").read_text(encoding="utf-8")
assert 'read_snapshot || exit 1' in snapshot_publisher
assert "HTTP 404|404 Not Found" in snapshot_publisher
assert "HTTP (429|500|502|503|504)" in snapshot_publisher
assert 'glab api --method POST "$project_api/releases"' in snapshot_publisher
assert "glab release create snapshot --ref" not in snapshot_publisher
for phase in ("probe-existing-snapshot", "create-initial-snapshot",
              "stage-verified-links", "commit-verified-marker"):
    assert "release phase=" + phase in snapshot_publisher

publisher = release_jobs["publish-release"]
for name in ("build-client-core", "package-linux-client", "package-windows-client",
             "release-assets", "promote-server-images"):
    assert name in publisher, name
assert "xdrive-backup-windows-amd64.zip" in publisher
assert "verify-synology-spk-release.sh release --require-mui" in publisher
assert "rm -rf release/core release/backup-cli release/synology" in publisher
assert "docker info >/dev/null" in release_jobs[".release-linux-docker"]
# Both public v* tag upload and mutable latest promotion need the gate:
# checking only at promotion would publish an untested stable image first.
for script in ("gitlab-server-images.sh", "gitlab-promote-images.sh"):
    publisher_script = (ROOT / "scripts/ci" / script).read_text(encoding="utf-8")
    assert 'if [[ -n "${CI_COMMIT_TAG:-}" ]]; then' in publisher_script, script
    assert "go run scripts/ci/verify-github-stable-final-gate.go" in publisher_script, script
    assert publisher_script.index("verify-github-stable-final-gate.go") < publisher_script.index("docker login"), script
gate = (ROOT / "scripts/ci/verify-github-stable-final-gate.go").read_text(encoding="utf-8")
for token in ("stableTagPattern", "fullCommitPattern", 'HeadBranch != tag',
              'run.Conclusion != "success"', '"final-gate"', '"photo-ocr-master-smoke"'):
    assert token in gate, "GitHub exact-SHA stable gate regressed: " + token

print("GitLab release-only job graph, exact-image package mode, and artifact guards: passed")
