#!/usr/bin/env python3
"""GitLab master snapshots must publish exact packages without gating on GitLab tests.

No external dependencies: validate source CI structure and exact build-only
branches. Stable v* and merge requests must keep the original full tests.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CI = (ROOT / ".gitlab-ci.yml").read_text()
RELEASE = (ROOT / "infra/ci/gitlab-release.yml").read_text()

def blocks(source):
    entries = list(re.finditer(r"(?m)^([A-Za-z0-9_.-]+):\s*$", source))
    return {
        entry.group(1): source[entry.end():entries[i + 1].start() if i + 1 < len(entries) else len(source)]
        for i, entry in enumerate(entries)
    }

jobs = {**blocks(CI), **blocks(RELEASE)}
release_only = '$CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == "master" && $CI_REGISTRY_IMAGE'
master_only = '$CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == "master"'
required_images = {"server-image", "caddy-image", "media-worker-image", "photo-face-image"}
master_builds = required_images | {"web"}
nonblocking_tests = {
    "desktop-tests", "go-linux", "go-linux-api", "server-validation",
    "server-backup", "go-windows", "test-linux-artifact",
    "test-source-agent-artifact", "test-windows-rollback-artifact",
    "test-windows-upgrade-artifact", "test-windows-smoke-artifact",
}

assert "  - post-release-test\n" in CI
assert CI.index("  - release\n") < CI.index("  - post-release-test\n")
assert "on_new_commit: interruptible" in CI
assert re.search(r"(?m)^default:\n  interruptible: true$", CI)

for name in sorted(master_builds):
    block = jobs[name]
    match = re.search(
        r'(?m)^    - if: [^\n]*' + re.escape(release_only) + r"[^\n]*\n"
        r"      interruptible: false\n"
        r"      variables:\n"
        r'        XDRIVE_GITLAB_PACKAGE_ONLY: "1"\n'
        r"    - when: on_success$",
        block,
    )
    assert match, f"{name}: master must export real artifacts without GitLab runtime smoke; stable/MR run full tests"
    assert "      allow_failure: true\n" not in block, f"{name} image/package build must NEVER be allowed to fail"

for name in sorted(nonblocking_tests):
    block = jobs[name]
    assert "  stage: test\n" in block
    assert "  rules:\n" in block
    assert re.search(
        r'(?m)^    - if: [^\n]*' + re.escape(master_only) + r"[^\n]*\n"
        r"      allow_failure: true\n"
        r"    - when: on_success$",
        block,
    ), f"{name} is incorrectly gating GitLab master, or hiding stable failures"

gate = jobs["final-gate"]
assert re.search(
    r'(?m)^    - if: [^\n]*' + re.escape(master_only) + r'[^\n]*\n'
    r"      when: never\n"
    r"    - when: on_success$",
    gate,
), "master must skip only GitLab's full final-gate"
for name in ("release-assets", "publish-server-images"):
    block = jobs[name]
    assert "final-gate" in block, f"stable {name} must still require full final-gate"
    assert release_only in block and "      when: on_success\n" in block

for name in ("promote-server-images", "publish-release"):
    block = jobs[name]
    assert "      when: on_success\n" in block and release_only in block
    assert 'CI_COMMIT_TAG =~ /^v.+/' in block, f"{name}: stable publishing must remain guarded"

# A master publisher must NEVER run after a failed hard prerequisite.
# GitLab's when:always ignores failures; allow_failure master diagnostics are
# already considered successful by when:on_success, and needs retain the DAG.
for name in ("release-assets", "publish-server-images", "promote-server-images", "publish-release"):
    block = jobs[name]
    # Select the unique master publication rule, not just any matching text.
    # A duplicated earlier when:always rule must not bypass this contract.
    master_rules = list(re.finditer(
        r'(?m)^    - if: [^\n]*' + re.escape(release_only) + r'[^\n]*\n',
        block,
    ))
    assert len(master_rules) == 1, f"{name}: expected exactly one master publisher rule"
    rule_body = block[master_rules[0].end():]
    assert rule_body.startswith("      when: on_success\n"), (
        f"{name}: failed image/asset builds must prevent master Snapshot publication"
    )
    assert "      allow_failure: true\n" not in block, (
        f"{name}: image/asset publication must fail closed even after a dependency error"
    )

# The complete verified image/desktop package DAG is still required. A build
# failure must leave the old Snapshot untouched, not publish missing images.
publisher = jobs["publish-release"]
assert "package-linux-client" in publisher
assert "package-windows-client" in publisher
assert "build-client-core" in publisher, "exact CLI-only archives must be a release input"
assert "xdrive-backup-windows-amd64.zip" in publisher, "Windows CLI-only release artifact missing"
assert "rm -rf release/core release/backup-cli" in publisher, "stable GitLab release must not upload binary build directories"
assert "release-assets" in publisher
assert "promote-server-images" in publisher
image_publisher = jobs["publish-server-images"]
for name in required_images:
    assert name in image_publisher, f"missing exact published image {name}"
assert "web" in jobs["caddy-image"]
assert "build-source-agent" in jobs["release-assets"]
assert "final-gate" not in re.findall(
    r'(?m)^        - job: ([\w-]+)$',
    jobs["release-assets"].split("    - if: '"+release_only, 1)[-1]
        .split("    - when: never", 1)[0],
), "master release must not depend on GitLab final-gate"

for name in ("master-release-image-smoke", "master-release-web-lint"):
    block = jobs[name]
    assert "  stage: post-release-test\n" in block
    assert "  needs:\n    - job: publish-release\n      artifacts: false\n" in block
    assert release_only in block
    assert "      allow_failure: true\n" in block
    assert "    - when: never\n" in block

script_flags = {
    "scripts/ci/gitlab-server-image.sh",
    "scripts/ci/gitlab-caddy-image.sh",
    "scripts/ci/test-media-worker-image.sh",
    "scripts/ci/test-photo-face-image.sh",
}
for filename in sorted(script_flags):
    script = (ROOT / filename).read_text()
    assert 'XDRIVE_GITLAB_PACKAGE_ONLY:-0' in script, f"missing master build-only branch in {filename}"
    assert "export-docker-image.sh" in script, f"{filename} must actually export an image"
assert "npm run lint" in jobs["web"]
assert 'XDRIVE_GITLAB_PACKAGE_ONLY:-0' in jobs["web"]
assert (ROOT / "scripts/ci/gitlab-post-release-smoke.sh").exists()

print(
    "GitLab master build/package -> SHA-verified publish -> optional smoke: passed; "
    "11 diagnostic tests nonblocking, 5 exact builders required, stable/MR strict"
)
