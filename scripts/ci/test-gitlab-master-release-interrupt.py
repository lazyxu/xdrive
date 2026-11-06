#!/usr/bin/env python3
"""Ensure GitLab publishing cannot be cancelled after its release inputs start.

Master builds and publication are required. All duplicated tests were moved
to GitHub Actions; this check runs from GitHub's exact-HEAD CI.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CI = (ROOT / ".gitlab-ci.yml").read_text(encoding="utf-8")
RELEASE = (ROOT / "infra/ci/gitlab-release.yml").read_text(encoding="utf-8")


def blocks(source):
    matches = list(re.finditer(r"(?m)^([A-Za-z0-9_.-]+):\s*$", source))
    return {
        match.group(1): source[
            match.end():matches[i + 1].start() if i + 1 < len(matches) else len(source)
        ]
        for i, match in enumerate(matches)
    }


jobs = {**blocks(CI), **blocks(RELEASE)}
assert re.search(r"(?m)^  auto_cancel:\n    on_new_commit: interruptible$", CI)
assert re.search(r"(?m)^default:\n  interruptible: true$", CI)


def master_needs(job):
    lines = jobs[job].splitlines()
    for i, line in enumerate(lines):
        if line.startswith("    - if:") and '$CI_COMMIT_BRANCH == "master"' in line:
            rule = []
            for subline in lines[i + 1:]:
                if subline.startswith(("    - if:", "    - when:")):
                    break
                rule.append(subline)
            if "      needs:" in rule:
                return re.findall(r"(?m)^        - job: ([\w-]+)", "\n".join(rule))
    for i, line in enumerate(lines):
        if line == "  needs:":
            nested = []
            for subline in lines[i + 1:]:
                if subline and len(subline) - len(subline.lstrip()) <= 2:
                    break
                nested.append(subline)
            return re.findall(r"(?m)^    - job: ([\w-]+)", "\n".join(nested))
    return []


def is_master_protected(job):
    block = jobs[job]
    if re.search(r"(?m)^  interruptible: false$", block):
        return True
    lines = block.splitlines()
    for i, line in enumerate(lines):
        if line.startswith("    - if:") and '$CI_COMMIT_BRANCH == "master"' in line:
            if i + 1 < len(lines) and lines[i + 1] == "      interruptible: false":
                return True
    return False


visited = set()
stack = ["publish-release"]
while stack:
    name = stack.pop()
    assert name in jobs, f"missing release prerequisite: {name}"
    if name in visited:
        continue
    visited.add(name)
    stack.extend(master_needs(name))

required = {
    "publish-release", "promote-server-images", "publish-server-images",
    "release-assets", "build-source-agent", "server-image", "caddy-image",
    "photo-face-image", "media-worker-image", "web", "package-linux-client",
    "package-windows-client", "desktop-linux", "desktop-windows",
    "build-client-core", "build-synology-ui",
}
assert visited == required, f"review new/missing master prerequisites: {visited ^ required}"
for job in sorted(visited):
    assert is_master_protected(job), f"{job}: running master publisher can be cancelled"
    assert "      allow_failure: true" not in jobs[job], f"{job}: required job cannot allow failure"

assert 'XDRIVE_GITLAB_PACKAGE_ONLY: "1"' in jobs["variables"]
assert "final-gate" not in jobs
assert "master-desktop-tests" not in jobs
assert "master-release-image-smoke" not in jobs
assert "master-release-web-lint" not in jobs
assert re.search(
    r"(?m)^  resource_group: xdrive-gitlab-release-publish$",
    jobs["publish-release"],
)
core = jobs["build-client-core"]
assert re.search(
    r"(?m)^  before_script:\n    - \*ensure_linux_fetch_tools\n    - \*install_node22$",
    core,
), "release package needs XZ/Node even though GitHub owns tests"
assert "bash scripts/ci/install-linux-fetch-tools.sh" in jobs[".ci-linux-helpers"]
fetch_tools = (ROOT / "scripts/ci/install-linux-fetch-tools.sh").read_text()
assert re.search(r"apt-get [^\n]*install[^\n]*\bxz-utils\b", fetch_tools)
assert "  image: $XDRIVE_CI_GO_IMAGE\n" in core
assert "web/dist-synology" in core

print("GitLab master publish dependency closure preserved without duplicate tests")
