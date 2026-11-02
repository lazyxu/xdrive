#!/usr/bin/env python3
"""Guard GitLab master snapshot publication against interrupted upstream jobs.

GitLab workflow:auto_cancel:on_new_commit:interruptible only preserves jobs
explicitly marked noninterruptible. Protect the complete release dependency
closure (including Desktop Windows, Web/Caddy and media images), not just the
final publish-release job. MR and unrelated test jobs must remain cancelable.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CI = (ROOT / ".gitlab-ci.yml").read_text()
RELEASE = (ROOT / "infra/ci/gitlab-release.yml").read_text()
CI_BLOCKS = {}
matches = list(re.finditer(r"(?m)^([A-Za-z0-9_.-]+):\s*$", CI))
for i, match in enumerate(matches):
    CI_BLOCKS[match.group(1)] = CI[match.end(): matches[i + 1].start() if i + 1 < len(matches) else len(CI)]
matches = list(re.finditer(r"(?m)^([A-Za-z0-9_.-]+):\s*$", RELEASE))
for i, match in enumerate(matches):
    CI_BLOCKS[match.group(1)] = RELEASE[match.end(): matches[i + 1].start() if i + 1 < len(matches) else len(RELEASE)]

assert re.search(r"(?m)^  auto_cancel:\n    on_new_commit: interruptible$", CI), "keep unrelated work cancelable"
assert re.search(r"(?m)^default:\n  interruptible: true$", CI), "default auto-cancel should stay enabled"

def master_needs(job):
    block = CI_BLOCKS[job]
    lines = block.splitlines()
    # Master-release jobs can override their global needs inside rules.
    for i, line in enumerate(lines):
        if line.startswith("    - if:") and '$CI_COMMIT_BRANCH == "master"' in line:
            rule = []
            for subline in lines[i + 1:]:
                if subline.startswith(("    - if:", "    - when:")):
                    break
                rule.append(subline)
            if any(line == "      needs:" for line in rule):
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
    block = CI_BLOCKS[job]
    if re.search(r"(?m)^  interruptible: false$", block):
        return True
    lines = block.splitlines()
    for i, line in enumerate(lines):
        if line.startswith("    - if:") and '$CI_COMMIT_BRANCH == "master"' in line:
            if i + 1 < len(lines) and lines[i + 1] == "      interruptible: false":
                return True
    return False

def is_cancelable_elsewhere(job):
    block = CI_BLOCKS[job]
    if re.search(r"(?m)^  interruptible: false$", block):
        return False
    return "    - when: on_success" in block and "  rules:\n" in block

visited = set()
stack = ["publish-release"]
edges = {}
while stack:
    name = stack.pop()
    assert name in CI_BLOCKS, f"release prerequisite disappeared: {name}"
    if name in visited:
        continue
    visited.add(name)
    deps = master_needs(name)
    edges[name] = deps
    stack.extend(deps)

required = {
    "publish-release", "promote-server-images", "publish-server-images",
    "release-assets", "build-source-agent", "server-image", "caddy-image",
    "photo-face-image", "media-worker-image", "web", "package-linux-client",
    "package-windows-client", "desktop-linux", "desktop-windows",
    "build-client-core", "build-synology-ui",
}
assert visited == required, f"review new/missing master release prerequisites: {visited ^ required}"
for job in sorted(visited):
    assert is_master_protected(job), f"{job} can be cancelled before GitLab Snapshot is published"

assert is_cancelable_elsewhere("desktop-windows"), "MR Desktop builds should remain cancelable"
assert is_cancelable_elsewhere("server-image"), "MR Server build should remain cancelable"
assert is_cancelable_elsewhere("web"), "MR Web build should remain cancelable"

# Formal tag publishing is still behind the full test gate; rolling master
# excludes it from its own dependency closure.
assert "final-gate" not in visited
assert "final-gate" in CI_BLOCKS["release-assets"]
assert "final-gate" in CI_BLOCKS["publish-server-images"]
assert re.search(r"(?m)^  resource_group: xdrive-gitlab-release-publish$", CI_BLOCKS["publish-release"])

# The Go job image is not the GitHub Ubuntu runner: DSM's XZ payload and
# the shared-MUI verifier need explicit tools before any packaging starts.
core = CI_BLOCKS["build-client-core"]
assert re.search(
    r"(?m)^  before_script:\n    - \*ensure_linux_fetch_tools\n    - \*install_node22$",
    core,
), "build-client-core must install XZ before Node and DSM packaging"
assert "bash scripts/ci/install-linux-fetch-tools.sh" in CI_BLOCKS[".ci-linux-helpers"]
tools = (ROOT / "scripts/ci/install-linux-fetch-tools.sh").read_text()
assert re.search(r"apt-get [^\n]*install[^\n]*\bxz-utils\b", tools)
assert "  image: $XDRIVE_CI_GO_IMAGE\n" in core
assert "bash scripts/ci/test-synology-release.sh" in core
assert "web/dist-synology" in core
print("GitLab master release dependency closure protected; unrelated tests and MR jobs remain interruptible")
