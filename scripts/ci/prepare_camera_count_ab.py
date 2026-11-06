"""Reproduce #2973's before query inside the current, otherwise identical tree."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

BASE = "928f60c24bb2f966b70125c273315642c954516e"
ACCEPTED = "fc670ad38e3e18eaae2bf26b02b9635b5592ed1e"
PATTERN = re.compile(r"^func \(s \*Server\) queryMediaItemRange\([\s\S]*?^}", re.M)


def function(source):
    matches = list(PATTERN.finditer(source))
    if len(matches) != 1:
        raise ValueError("expected one complete range query")
    return matches[0]


def prepare(candidate, original, accepted):
    current = function(candidate)
    before = function(original).group()
    after = function(accepted).group()
    if current.group() != after or before == after:
        raise ValueError("range query changed; review a new source-exact benchmark")
    return candidate[:current.start()] + before + candidate[current.end():]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--evidence", required=True, type=Path)
    args = parser.parse_args()
    for sha in (BASE, ACCEPTED):
        subprocess.run(["git", "merge-base", "--is-ancestor", sha, "HEAD"], check=True)
    get = lambda sha: subprocess.check_output(["git", "show", sha + ":internal/api/media.go"], text=True)
    candidate = Path("internal/api/media.go").read_text()
    before = prepare(candidate, get(BASE), get(ACCEPTED))
    args.output.write_text(before, newline="\n")
    digest = lambda source: hashlib.sha256(source.encode()).hexdigest()
    args.evidence.write_text(json.dumps({
        "before_query_source_sha": BASE, "accepted_query_source_sha": ACCEPTED,
        "before_query_sha256": digest(function(before).group()),
        "after_query_sha256": digest(function(candidate).group()),
        "before_media_file_sha256": digest(before), "after_media_file_sha256": digest(candidate),
        "other_code": "identical candidate tree in both arms",
    }, indent=2) + "\n")


if __name__ == "__main__":
    main()
