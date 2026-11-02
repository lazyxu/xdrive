#!/usr/bin/env python3
"""Bind an exact GitHub master release to its monotonic first-parent position."""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path
import re
import subprocess

spec = importlib.util.spec_from_file_location('delivery_offline', Path(__file__).with_name('xdrive_offline.py'))
offline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(offline)
REPOSITORY_ID = 1382670236


def file_record(path: Path) -> dict:
    if path.is_symlink() or not path.is_file() or path.stat().st_size <= 0:
        raise ValueError('Missing or unsafe delivery artifact')
    return dict(name=path.name, size=path.stat().st_size, sha256=offline.hash_file(path))


def generate(directory: Path, commit: str, repository: Path) -> dict:
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise ValueError('Full target commit required')
    manifest = offline.parse_manifest(directory, None, require_trust=False)
    if (manifest['schema'] != 2 or manifest['source'] != 'github' or
            manifest['channel'] != 'master' or manifest['source_commit'] != commit):
        raise ValueError('Delivery requires the exact GitHub master manifest')
    history = subprocess.run(['git', '-C', str(repository), 'rev-list', '--first-parent',
                              'refs/remotes/origin/master'], capture_output=True, text=True, check=True).stdout.splitlines()
    if commit not in history:
        raise ValueError('Target is not on master first-parent history')
    sequence = int(subprocess.run(['git', '-C', str(repository), 'rev-list', '--first-parent',
                                   '--count', commit], capture_output=True, text=True, check=True).stdout)
    if sequence <= 0:
        raise ValueError('Invalid first-parent sequence')
    return dict(schema=1, repository_id=REPOSITORY_ID, channel='master', platform='linux/amd64',
                source_commit=commit, sequence=sequence, manifest=file_record(directory / 'manifest.json'),
                installer=file_record(directory / 'xdrive-offline.py'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--repository', type=Path, default=Path('.'))
    args = parser.parse_args()
    descriptor = generate(args.directory, args.commit, args.repository)
    (args.directory / 'delivery.json').write_text(json.dumps(descriptor, sort_keys=True, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
