#!/usr/bin/env python3
"""Mirror exact authenticated GitHub offline releases to a private upload Share.

GitHub publication precedes this opt-in transport. No Owner credential is used;
remote bytes, including prior uploads, must match before delivery.json appears.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from urllib.error import HTTPError, URLError
from urllib.request import Request


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


HERE = Path(__file__).resolve().parent
client = load('server_mirror_client', HERE / 'mirror-clients-to-share.py')
offline = load('server_mirror_offline', HERE.parent / 'offline/xdrive_offline.py')
MirrorError = client.MirrorError
REPOSITORY = 'lazyxu/xdrive'
METADATA_LIMIT = 16 * 1024 * 1024
PACKAGE_LIMIT = 8 * 1024**3


def check_file(path, size, digest):
    if (type(size) is not int or not 0 < size <= PACKAGE_LIMIT or
            not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest) or
            path.is_symlink() or not path.is_file() or path.stat().st_size != size or
            client.sha256_file(path) != digest):
        raise MirrorError('Local artifact is missing or differs from its immutable identity')


def read_json(path):
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= METADATA_LIMIT:
        raise MirrorError('Missing or excessive release metadata')
    return json.loads(path.read_text(encoding='utf-8'))


def manifest_at(directory):
    read_json(directory / 'manifest.json')
    try:
        manifest = offline.parse_manifest(directory, None, require_trust=False)
    except offline.PackageError as error:
        raise MirrorError('Invalid offline manifest') from error
    if manifest['schema'] != 2 or manifest['source'] != 'github' or manifest['channel'] != 'master':
        raise MirrorError('Only content-addressed GitHub master packages may be mirrored')
    return manifest


def fetch_packages(directory):
    manifest = manifest_at(directory)
    for component in offline.COMPONENTS:
        item = manifest['packages'][component]
        path = directory / item['filename']
        if not path.exists() and not path.is_symlink():
            # The validated tag is bound to this component and archive digest.
            # Never use latest, a branch, a registry pull or rebuild missing bytes.
            with tempfile.TemporaryDirectory(prefix='xdrive-package-fetch-', dir=directory) as temp:
                result = subprocess.run(['gh', 'release', 'download', item['release_tag'],
                                         '--repo', REPOSITORY, '--pattern', item['filename'], '--dir', temp],
                                        stdin=subprocess.DEVNULL, capture_output=True, check=False)
                if result.returncode:
                    raise MirrorError('Exact GitHub package download failed')
                staged = Path(temp) / item['filename']
                check_file(staged, item['size'], item['sha256'])
                staged.replace(path)
        check_file(path, item['size'], item['sha256'])
    return manifest


class Share(client.Share):
    def entries(self, parent):
        cursor, found, identities, cursors = 0, {}, set(), set()
        while True:
            if cursor in cursors or len(cursors) >= 1000:
                raise MirrorError('Repeated or excessive Share pagination')
            cursors.add(cursor)
            page = self.request('POST', '/api/v1/public/share/children',
                                dict(parent_id=parent, cursor=cursor, password=self.password))
            if not isinstance(page, dict) or not isinstance(page.get('items'), list):
                raise MirrorError('Malformed Share directory response')
            for entry in page['items']:
                if not isinstance(entry, dict):
                    raise MirrorError('Malformed Share entry')
                name, identifier = entry.get('name'), entry.get('id')
                if (not isinstance(name, str) or len(name) > 255 or '/' in name or '\\' in name or
                        name in ('', '.', '..') or name in found or type(identifier) is not int or
                        identifier <= 0 or identifier in identities or entry.get('type') not in ('file', 'dir')):
                    raise MirrorError('Invalid or duplicate Share path identity')
                found[name] = entry
                identities.add(identifier)
                if len(found) > 100000:
                    raise MirrorError('Excessive Share directory')
            cursor = page.get('next_cursor', 0)
            if cursor is None or cursor == 0:
                return found
            if type(cursor) is not int or cursor <= 0:
                raise MirrorError('Invalid Share pagination cursor')

    def directory(self, parent, name):
        entry = self.entries(parent).get(name)
        if entry is not None:
            if entry['type'] != 'dir':
                raise MirrorError('Immutable directory path conflicts with a file')
            return entry['id']
        identifier = super().directory(parent, name)
        entry = self.entries(parent).get(name)
        if entry is None or entry['type'] != 'dir' or entry['id'] != identifier:
            raise MirrorError('Share directory identity changed during creation')
        return identifier

    def verify_remote(self, entry, size, digest):
        node = entry.get('id')
        if (entry.get('type') != 'file' or type(node) is not int or node <= 0 or
                type(entry.get('size')) is not int or entry['size'] != size):
            raise MirrorError('Existing immutable file identity conflicts; never overwrite')
        ticket = self.request('POST', '/api/v1/public/share/download-ticket',
                              dict(node_id=node, password=self.password))
        url = ticket.get('url')
        if not isinstance(url, str) or not re.fullmatch(
                r'/api/v1/public-share-download/[1-9][0-9]*\?ticket=[A-Za-z0-9_.~%-]+', url):
            raise MirrorError('Invalid or out-of-scope Share download ticket')
        checksum = hashlib.sha256()
        count = 0
        try:
            # A short-lived scoped ticket suffices. Never forward the Share bearer.
            with self.opener.open(Request(self.base + url, headers={'Accept-Encoding': 'identity'}), timeout=120) as stream:
                if stream.status != 200 or stream.headers.get('Content-Encoding', 'identity') != 'identity':
                    raise MirrorError('Unexpected Share download response')
                length = stream.headers.get('Content-Length')
                if length is not None and (not length.isdecimal() or int(length) != size):
                    raise MirrorError('Share download length mismatch')
                while True:
                    chunk = stream.read(min(1024 * 1024, size - count + 1))
                    if not chunk:
                        break
                    count += len(chunk)
                    if count > size:
                        raise MirrorError('Share stream exceeds declared size')
                    checksum.update(chunk)
        except (HTTPError, URLError, OSError, TimeoutError) as error:
            raise MirrorError('Share byte verification failed') from error
        if count != size or checksum.hexdigest() != digest:
            raise MirrorError('Share immutable file SHA256 or length mismatch')

    def upload(self, parent, name, content, digest, platform, commit):
        size = content.stat().st_size
        check_file(content, size, digest)
        entry = self.entries(parent).get(name)
        if entry is not None:
            self.verify_remote(entry, size, digest)
            return 'verified-existing'
        result = super().upload(parent, name, content, digest, platform, commit)
        entry = self.entries(parent).get(name)
        if entry is None:
            raise MirrorError('Finalized upload has no exact immutable path')
        self.verify_remote(entry, size, digest)
        return result


def validate_delivery(directory, manifest):
    descriptor = read_json(directory / 'delivery.json')
    if (not isinstance(descriptor, dict) or set(descriptor) != {
            'schema', 'repository_id', 'channel', 'platform', 'source_commit', 'sequence', 'manifest', 'installer'} or
            type(descriptor.get('schema')) is not int or descriptor['schema'] != 1 or
            type(descriptor.get('repository_id')) is not int or descriptor['repository_id'] != 1382670236 or
            descriptor.get('channel') != 'master' or descriptor.get('platform') != 'linux/amd64' or
            descriptor.get('source_commit') != manifest['source_commit'] or
            type(descriptor.get('sequence')) is not int or descriptor['sequence'] <= 0):
        raise MirrorError('Invalid delivery descriptor identity')
    for key, name in (('manifest', 'manifest.json'), ('installer', 'xdrive-offline.py')):
        item = descriptor.get(key)
        if not isinstance(item, dict) or set(item) != {'name', 'size', 'sha256'} or item['name'] != name:
            raise MirrorError('Invalid delivery artifact binding')
        check_file(directory / name, item['size'], item['sha256'])
    bundle = directory / 'delivery-attestation.jsonl'
    if bundle.is_symlink() or not bundle.is_file() or not 0 < bundle.stat().st_size <= METADATA_LIMIT:
        raise MirrorError('Missing delivery attestation')
    return descriptor


def publish(directory, share):
    manifest = manifest_at(directory)
    descriptor = validate_delivery(directory, manifest)
    for item in manifest['packages'].values():
        check_file(directory / item['filename'], item['size'], item['sha256'])
    share.verify_grant()
    root = share.directory(0, 'xDrive-Server')
    package_root = share.directory(root, 'packages')
    for component in offline.COMPONENTS:
        item = manifest['packages'][component]
        folder = share.directory(package_root, item['sha256'])
        share.upload(folder, item['filename'], directory / item['filename'], item['sha256'],
                     'server-' + component, manifest['source_commit'])
    channel = share.directory(root, 'master')
    folder = share.directory(channel, f"{descriptor['sequence']}-{manifest['source_commit']}")
    # The completion marker must remain last, including on interrupted retries.
    for name in ('manifest.json', 'xdrive-offline.py', 'delivery-attestation.jsonl', 'delivery.json'):
        path = directory / name
        share.upload(folder, name, path, client.sha256_file(path), 'server-delivery', manifest['source_commit'])
    print('Server mirror verified: sequence ' + str(descriptor['sequence']) + ', commit ' + manifest['source_commit'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('fetch', 'publish'))
    parser.add_argument('--directory', type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == 'fetch':
            fetch_packages(args.directory)
        else:
            url = os.environ.get('XDRIVE_CLIENT_MIRROR_SHARE_URL', '')
            if not url:
                raise MirrorError('Missing private publisher Share configuration')
            publish(args.directory, Share(url, os.environ.get('XDRIVE_CLIENT_MIRROR_SHARE_PASSWORD', '')))
        return 0
    except (MirrorError, OSError, ValueError, KeyError, TypeError):
        # Never print raw request errors, capability URLs, passwords or responses.
        print('Server mirror failed verification; no completion may be assumed', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
