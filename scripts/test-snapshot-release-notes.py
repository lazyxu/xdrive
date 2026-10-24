#!/usr/bin/env python3
"""Contract: Snapshot notes carry the exact SHA without shell backtick execution."""
from pathlib import Path
import os
import subprocess

root = Path(__file__).resolve().parents[1]
release = (root / ".github/workflows/release.yml").read_text(encoding="utf-8")
ci = (root / ".github/workflows/ci.yml").read_text(encoding="utf-8")
lines = [line.strip() for line in release.splitlines()
         if line.strip().startswith('notes="$(printf')]
assert len(lines) == 1, "exactly one rolling Snapshot notes expression required"
expression = lines[0]
expected = r'''notes="$(printf 'Rolling development snapshot from master at \x60%s\x60. Exact CI-produced artifacts are published without rebuilding; full master CI continues independently.' "$GITHUB_SHA")"'''
assert expression == expected, "notes must expand the SHA with literal Markdown backticks"
assert '--notes "$notes"' in release
assert "python3 scripts/test-snapshot-release-notes.py" in ci
commit = "0123456789abcdef0123456789abcdef01234567"
script = expression + "\nprintf '%s\\n' \"$notes\""
result = subprocess.run(
    ["bash", "-e", "-u", "-o", "pipefail", "-c", script],
    env={**os.environ, "GITHUB_SHA": commit},
    capture_output=True, text=True, check=True,
)
expected_note = (f"Rolling development snapshot from master at {chr(96)}{commit}{chr(96)}. "
                 "Exact CI-produced artifacts are published without rebuilding; "
                 "full master CI continues independently.\n")
assert result.stdout == expected_note
assert not result.stderr, "must never attempt to execute the release SHA"
print("snapshot release notes shell quoting / SHA interpolation contract passed")
