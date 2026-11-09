#!/usr/bin/env python3
"""GitLab builds its own release bytes; GitHub only supplies CI/Final Gate."""
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
master_rule = '$CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == "master" && $CI_REGISTRY_IMAGE'
builds = {
    "desktop-linux", "desktop-windows", "build-client-core",
    "package-linux-client", "server-image", "media-worker-image",
    "photo-face-image", "caddy-image", "package-windows-client", "web",
}
publishers = {
    "release-assets", "publish-server-images", "promote-server-images",
    "publish-photo-face-image", "publish-media-worker-image", "publish-release",
}
assert {name for name, block in ci_jobs.items() if "  stage: " in block} == builds
assert {name for name, block in release_jobs.items() if "  stage: " in block} == publishers
stages = re.findall(r"(?m)^  - ([\w-]+)$", ci_jobs["stages"])
assert stages == ["build", "package", "release-build", "promote", "release"], stages
assert "CI_COMMIT_TAG =~ /^v.+/" in ci_jobs["workflow"]
assert master_rule in ci_jobs["workflow"]
assert "merge_request_event" not in ci_jobs["workflow"]
assert "  stage: test" not in RELEASE
assert 'XDRIVE_GITLAB_PACKAGE_ONLY: "1"' in ci_jobs["variables"]

for name, block in all_jobs.items():
    for need in re.findall(r"(?m)^\s+- job: ([\w-]+)$", block):
        assert need in all_jobs, f"{name}: missing needs job: {need}"
for name in builds:
    assert re.search(r"(?m)^  stage: (build|package)$", ci_jobs[name]), name
    assert master_rule in ci_jobs[name] and "CI_COMMIT_TAG =~ /^v.+/" in ci_jobs[name], name

for name, image in (
    ("server-image", "xdrive-server"),
    ("caddy-image", "xdrive-caddy"),
    ("photo-face-image", "xdrive-photo-face"),
    ("media-worker-image", "xdrive-media-worker"),
):
    block = ci_jobs[name]
    assert "XDRIVE_GITLAB_PACKAGE_ONLY=1" in block, name
    assert "XDRIVE_GITLAB_STAGING_ONLY=1" in block, name
    assert f"gitlab-stage-image.sh {image} " in block, name
    assert "image.commit" in block and "image.digest" in block, name
    assert "XDRIVE_CI_GO_IMAGE" in block, name
    assert "*install_docker_cli_only" in block, name
    assert "image.tar.gz" not in block, name

core = ci_jobs["build-client-core"]
assert "test-synology-release.sh" not in core
assert "test-backup-cli-archives.sh" not in core
assert "verify-synology-spk-release.sh release/synology --require-mui" in core
assert "web/dist-synology" in core
assert "npm run lint" not in ci_jobs["web"]
assert "npm run build:synology" in ci_jobs["web"]

for name in publishers:
    block = release_jobs[name]
    assert master_rule in block, name
    assert "CI_COMMIT_TAG =~ /^v.+/" in block, name
assert "release-assets" in release_jobs["promote-server-images"]
assert "publish-server-images" in release_jobs["promote-server-images"]
core_publisher = release_jobs["publish-server-images"]
assert "server-image" in core_publisher and "caddy-image" in core_publisher
assert "photo-face-image" not in core_publisher
assert "media-worker-image" not in core_publisher
assert "image-manifest.tsv" in core_publisher
stable = release_jobs["publish-release"]
assert "publish-photo-face-image" in stable and "publish-media-worker-image" in stable
assert "image-manifest.tsv" in stable
assert "python3 scripts/ci/verify-gitlab-core-manifest.py" in stable
core_manifest_verifier = (ROOT / "scripts/ci/verify-gitlab-core-manifest.py").read_text(encoding="utf-8")
for token in ("CI_COMMIT_SHA", "CI_COMMIT_TAG", "CI_REGISTRY_IMAGE",
              "xdrive-server", "xdrive-caddy", "sha256:"):
    assert token in core_manifest_verifier, token
assert "build-client-core" in stable and "package-linux-client" in stable
assert "package-windows-client" in stable and "release-assets" in stable
assert "promote-server-images" in stable
assert "xdrive-backup-windows-amd64.zip" in stable
assert "verify-synology-spk-release.sh release --require-mui" in stable

p = (ROOT / "scripts/ci/gitlab-publish-release.sh").read_text(encoding="utf-8")
for token in ("read_snapshot || exit 1", "HTTP 404|404 Not Found",
              "HTTP (429|500|502|503|504)", 'glab api --method POST "$project_api/releases"',
              "probe-existing-snapshot", "create-initial-snapshot",
              "stage-verified-links", "commit-verified-marker", "image-manifest.tsv"):
    assert token in p, token
assert "glab release create snapshot --ref" not in p

registry = (ROOT / "scripts/ci/gitlab-registry-utils.sh").read_text(encoding="utf-8")
stage = (ROOT / "scripts/ci/gitlab-stage-image.sh").read_text(encoding="utf-8")
fetch = (ROOT / "scripts/ci/gitlab-fetch-staged-image.sh").read_text(encoding="utf-8")
publish = (ROOT / "scripts/ci/gitlab-server-images.sh").read_text(encoding="utf-8")
promote = (ROOT / "scripts/ci/gitlab-promote-images.sh").read_text(encoding="utf-8")
assert "docker login" in registry
assert "git merge-base --is-ancestor" in registry
assert "xdrive_pull_or_absent" in registry
assert "CI_PIPELINE_ID" in stage and "CI_JOB_ID" in stage
assert "image.digest" in stage and "image.commit" in stage
assert "docker push" in stage
assert "docker pull" in fetch and "$remote_repo@$digest" in fetch
assert "xdrive_assert_image_identity" in fetch
assert "xdrive-fetch-from-github" not in fetch
for script in (publish, promote):
    assert 'if [[ -n "${CI_COMMIT_TAG:-}" ]]; then' in script
    assert "go run scripts/ci/verify-github-stable-final-gate.go" in script
    assert script.index("verify-github-stable-final-gate.go") < script.index("xdrive_registry_login")
assert "xdrive_assert_promotion_ancestry" in promote
stage_gate = (ROOT / "scripts/ci/gitlab-stable-prestage-gate.sh").read_text(encoding="utf-8")
assert "go run scripts/ci/verify-github-stable-final-gate.go" in stage_gate
assert "CI_COMMIT_TAG" in stage_gate and "CI_COMMIT_SHA" in stage_gate
assert "bash scripts/ci/gitlab-stable-prestage-gate.sh" in stage
assert stage.index("bash scripts/ci/gitlab-stable-prestage-gate.sh") < stage.index("xdrive_registry_login")
for name in ("server-image", "caddy-image", "photo-face-image", "media-worker-image"):
    job = ci_jobs[name]
    assert "bash scripts/ci/gitlab-stable-prestage-gate.sh" in job, name
    assert job.index("bash scripts/ci/gitlab-stable-prestage-gate.sh") < job.index("*install_docker_cli_only"), name
photo_build = (ROOT / "scripts/ci/test-photo-face-image.sh").read_text(encoding="utf-8")
assert "bash scripts/ci/gitlab-stable-prestage-gate.sh" in photo_build
assert photo_build.index("bash scripts/ci/gitlab-stable-prestage-gate.sh") < photo_build.index("runtime_registry_tag=\"$CI_REGISTRY_IMAGE"), "photo runtime cache published before gate"
assert "xdrive_assert_image_identity" in promote and "xdrive_assert_image_identity" in publish

gate = (ROOT / "scripts/ci/verify-github-stable-final-gate.go").read_text()
for token in ("stableTagPattern", "fullCommitPattern", 'HeadBranch != tag',
              'run.Conclusion != "success"', '"final-gate"', '"photo-ocr-master-smoke"'):
    assert token in gate, token

print("GitLab source-exact local builds, Registry staging and fail-closed publication contracts passed")
