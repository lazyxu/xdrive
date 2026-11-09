#!/usr/bin/env python3
"""Exact GitLab release DAG and cancellation contract; GitHub CI owns tests."""
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


def needs(job, channel):
    lines = jobs[job].splitlines()
    cond = '$CI_COMMIT_TAG =~ /^v.+/' if channel == "stable" else '$CI_COMMIT_BRANCH == "master"'
    for i, line in enumerate(lines):
        if line.startswith("    - if:") and cond in line:
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


def closure(channel):
    visited = set()
    stack = ["publish-release"]
    while stack:
        name = stack.pop()
        assert name in jobs, f"missing release prerequisite: {name}"
        if name in visited:
            continue
        visited.add(name)
        stack.extend(needs(name, channel))
    return visited


core = {
    "publish-release", "promote-server-images", "publish-server-images",
    "release-assets", "server-image", "caddy-image", "web",
    "package-linux-client", "package-windows-client",
    "desktop-linux", "desktop-windows", "build-client-core",
}
optional = {
    "photo-face-image", "media-worker-image",
    "publish-photo-face-image", "publish-media-worker-image",
}
assert closure("master") == core, closure("master") ^ core
assert closure("stable") == core | optional, closure("stable") ^ (core | optional)
assert "build-synology-ui" not in jobs
assert re.search(r"(?m)^  needs: \[\]", jobs["release-assets"]), "source-only release-assets must bypass optional image stage barrier"
assert "npm run build:synology" in jobs["web"]
assert "node scripts/verify-synology-ui.mjs" in jobs["web"]
assert "web/dist-synology/" in jobs["web"]

# Only the non-mutating master build/packaging phases can be cancelled when
# superseded. A running publisher/promotion must finish and guard monotonicity.
for name in core - {"publish-release", "promote-server-images", "publish-server-images"}:
    lines = jobs[name].splitlines()
    master_rule = next(i for i, line in enumerate(lines)
                       if line.startswith("    - if:") and '$CI_COMMIT_BRANCH == "master"' in line)
    assert "      interruptible: true" in lines[master_rule + 1:master_rule + 4], name
for name in ("publish-release", "promote-server-images", "publish-server-images"):
    assert re.search(r"(?m)^  interruptible: false$", jobs[name]), name
for name in core - {"publish-release", "promote-server-images", "publish-server-images"}:
    assert "      allow_failure: true" not in jobs[name], name

for name in optional:
    assert "      allow_failure: true" in jobs[name], name
    assert "      changes:" in jobs[name], name
    assert '$CI_COMMIT_TAG =~ /^v.+/' in jobs[name], name
    assert "      allow_failure: true" not in jobs[name].split("    - if: '$CI_PIPELINE_SOURCE == \"push\" && $CI_COMMIT_TAG")[1].split("    - if:")[0]
assert "resource_group: xdrive-gitlab-release-publish" in jobs["publish-release"]
assert "resource_group: xdrive-gitlab-server-images" in jobs["promote-server-images"]
assert "resource_group:" not in jobs["photo-face-image"]
assert "resource_group:" not in jobs["media-worker-image"]
assert "resource_group:" not in jobs["server-image"]
assert "resource_group:" not in jobs["caddy-image"]
assert "GOCACHE:" in jobs[".go-linux-cache"]
assert ".cache/go-build/" in jobs[".go-linux-cache"]
assert "XDRIVE_GITLAB_PACKAGE_ONLY: \"1\"" in jobs["variables"]
assert "final-gate" not in jobs
print("GitLab master core-only and stable complete-image DAG / cancellation contracts passed")
