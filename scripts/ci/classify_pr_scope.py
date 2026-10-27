#!/usr/bin/env python3
"""Conservative PR-only CI scope classifier, executed from trusted base."""
from __future__ import annotations

import subprocess
import sys

DOCS = frozenset({"AGENTS.md", "README.md"})
ANDROID_DOCS = frozenset({
    "docs/android-ios-pwa-ui-parity.md",
    "docs/android-gallery-collections-owner-contract.md",
})
PWA_SOURCE = frozenset({
    "web/src/pwaConnectivity.ts",
    "web/src/pwaInstall.ts",
    "web/src/PwaInstallDialog.tsx",
})
PWA_TESTS = frozenset({
    "desktop/tests/web-pwa-connectivity.cjs",
    "desktop/tests/web-pwa-install.cjs",
    "desktop/tests/pwa-install-dialog-race.cjs",
})


def classify_paths(paths: list[str]) -> str:
    paths = list(paths)
    if not paths or any(not p or p.startswith("/") or ".." in p.split("/") for p in paths):
        return "full"
    if all(p in DOCS or (p.startswith("docs/") and p.endswith(".md")) for p in paths):
        return "docs"
    if all(p.startswith("android/") or p in ANDROID_DOCS for p in paths):
        return "android"
    allow = PWA_SOURCE | PWA_TESTS
    if all(p in allow for p in paths) and any(p in PWA_SOURCE for p in paths):
        return "pwa"
    return "full"


def changed_paths(base: str, head: str) -> list[str]:
    merge_base = subprocess.check_output(
        ["git", "merge-base", base, head], text=True
    ).strip()
    # Report BOTH sides of a rename. A source-to-doc move is not docs-only.
    raw = subprocess.check_output(
        ["git", "diff", "--no-renames", "--name-only", "-z", merge_base, head]
    )
    return [name.decode("utf-8") for name in raw.split(b"\x00") if name]


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: classify_pr_scope.py BASE_SHA PR_HEAD_SHA")
    print(classify_paths(changed_paths(sys.argv[1], sys.argv[2])))
