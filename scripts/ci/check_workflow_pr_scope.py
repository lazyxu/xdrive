#!/usr/bin/env python3
"""Prevent standalone GitHub Actions from creating skip-only runs on every PR.

The normal CI workflow intentionally tracks all PRs. Evidence/benchmark
workflows must select related changes at the event level: a jobs.if head_ref
guard is not sufficient to stop a workflow run from being created.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import re
import sys

CORE_CI = {"ci.yml"}
# GitHub accepts both quoted keys and shorthand event lists. Never treat a
# shorthand pull_request event as "no PR trigger": it has no paths filter.
TOP_LEVEL = re.compile(r"^(?:[A-Za-z][\w-]*|\"[^\"]+\"|'[^']+'):\s*")
ON = re.compile(r"^(?:on|\"on\"|'on'):\s*(.*)$")
PR_EVENT = re.compile(r"^  (?:pull_request|\"pull_request\"|'pull_request'):\s*(.*)$")
PR_TOKEN = re.compile(r"(?<![\w-])pull_request(?![\w-])")
PATH = re.compile(r"^      -\s+(.+?)\s*$")
ALLOWED_PREFIXES = (
    "android/", "desktop/", "internal/", "web/", "ui/", "scripts/",
    "deploy/", "packaging/", "docs/", ".github/workflows/",
)
BROAD_PATTERNS = {"*", "**", "**/*", "./**", ".github/**", ".github/workflows/**"}


def pr_paths(contents: str) -> list[str] | None:
    """Return static pull_request.paths, [] if unrestricted, None if no PR event."""
    lines = contents.splitlines()
    on_index = next((i for i, line in enumerate(lines) if ON.match(line)), None)
    if on_index is None:
        return None
    inline = ON.match(lines[on_index]).group(1)
    if inline.lstrip().startswith("#"):
        inline = ""
    start = on_index + 1
    stop = next((i for i in range(start, len(lines)) if TOP_LEVEL.match(lines[i])), len(lines))
    events = lines[start:stop]
    if inline:
        # Shorthand `on:` event arrays/maps (even multiline) cannot contain
        # a verifiable paths scope in this deliberately restricted parser.
        content = "\n".join(line for line in events if not line.lstrip().startswith("#"))
        return [] if PR_TOKEN.search(inline) or PR_TOKEN.search(content) else None
    pr_index = next((i for i, line in enumerate(events) if PR_EVENT.match(line)), None)
    if pr_index is None:
        # Event lists (or unusually indented/quoted PR event keys) are valid
        # YAML but have no verifiable paths scope in this restricted parser.
        return [] if any(re.match(r"^\s+(?:-\s*)?['\"]?pull_request['\"]?\s*(?::|#|$)", line) for line in events) else None
    if PR_EVENT.match(events[pr_index]).group(1) == "{}":
        return []
    event_end = next(
        (i for i in range(pr_index + 1, len(events))
         if re.match(r"^  [a-zA-Z][\w-]*:\s*", events[i])),
        len(events),
    )
    data = events[pr_index + 1:event_end]
    marker = next((i for i, line in enumerate(data) if line.strip() == "paths:" and line.startswith("    ")), None)
    if marker is None:
        return []
    paths = []
    for line in data[marker + 1:]:
        if re.match(r"^    [a-zA-Z][\w-]*:\s*", line):
            break
        m = PATH.match(line)
        if m:
            raw = m.group(1).split(" #", 1)[0].strip()
            if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in ("'", '"'):
                raw = raw[1:-1]
            paths.append(raw.replace("''", "'"))
    return paths


def lint_workflows(directory: Path) -> tuple[int, int, list[str]]:
    total = scoped = 0
    errors = []
    for workflow in sorted((*directory.glob("*.yml"), *directory.glob("*.yaml"))):
        total += 1
        paths = pr_paths(workflow.read_text(encoding="utf-8"))
        if paths is None or workflow.name in CORE_CI:
            continue
        if not paths:
            errors.append(f"{workflow.name}: unrestricted pull_request (jobs.if does not prevent Skipped runs)")
            continue
        if any(p in BROAD_PATTERNS or p.startswith("/") or ".." in Path(p).parts for p in paths):
            errors.append(f"{workflow.name}: unsafe broad/absolute/parent path filter: {paths!r}")
            continue
        if not any(p.startswith(ALLOWED_PREFIXES) and not p.startswith(".github/workflows/") for p in paths):
            errors.append(f"{workflow.name}: path filter contains no feature source/test fixture")
            continue
        scoped += 1
    return total, scoped, errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workflows", type=Path, default=Path(__file__).resolve().parents[2] / ".github" / "workflows")
    args = parser.parse_args()
    if not args.workflows.is_dir():
        print(f"missing GitHub workflows directory: {args.workflows}", file=sys.stderr)
        return 2
    total, scoped, problems = lint_workflows(args.workflows)
    for problem in problems:
        print("WORKFLOW_TRIGGER_ERROR:", problem, file=sys.stderr)
    print(f"GitHub workflow trigger audit: {total} YAML workflows, {scoped} scoped PR workflows, {len(problems)} violations")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
