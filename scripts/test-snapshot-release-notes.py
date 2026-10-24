#!/usr/bin/env python3
"""Verify Snapshot Release notes retain the exact commit without Bash substitutions."""
from pathlib import Path
import os
import subprocess

root = Path(__file__).resolve().parents[1]
release = (root / ".github/workflows/release.yml").read_text(encoding="utf-8")
ci = (root / ".github/workflows/ci.yml").read_text(encoding="utf-8")
lines = [line.strip() for line in release.splitlines()
         if line.strip().startswith('--notes "Rolling development snapshot')]
assert len(lines) == 1, "exactly one rolling Snapshot Release notes argument required"
expression = lines[0].removeprefix("--notes ")
expected = "\"Rolling development snapshot from master at \\`${GITHUB_SHA}\\`. Exact CI-produced artifacts are published without rebuilding; full master CI continues independently.\""
assert expression == expected, "release note must escape Bash backticks and expand the commit SHA"
assert "python3 scripts/test-snapshot-release-notes.py" in ci, "CI must run the contract"

commit = "0123456789abcdef0123456789abcdef01234567"
result = subprocess.run(
    ["bash", "-e", "-u", "-o", "pipefail", "-c", "printf '%s\\n' " + expression],
    env={**os.environ, "GITHUB_SHA": commit},
    capture_output=True, text=True, check=True,
)
expected_note = (f"Rolling development snapshot from master at `{commit}`. "
                 "Exact CI-produced artifacts are published without rebuilding; "
                 "full master CI continues independently.\n")
assert result.stdout == expected_note, "release notes must include SHA in Markdown code quotes"
assert not result.stderr, "release notes must not execute the commit SHA"
print("snapshot release notes shell quoting / SHA interpolation contract passed")
