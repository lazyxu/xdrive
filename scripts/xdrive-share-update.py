#!/usr/bin/env python3
"""Authenticated Share transport for the existing five-component offline installer.

The Share is a byte transport, never an executable-content trust authority.
Provision the verifier, Sigstore root and initial rollback floor independently.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import ssl
import stat
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

REPOSITORY = 'lazyxu/xdrive'
REPOSITORY_ID = 1382670236
WORKFLOW = REPOSITORY + '/.github/workflows/offline-packages.yml'
COMPONENTS = ('app', 'postgres', 'media-worker', 'ai-runtime', 'ai-models')
HEX64 = re.compile(r'[a-f0-9]{64}\Z')
COMMIT = re.compile(r'[a-f0-9]{40}\Z')
RELEASE = re.compile(r'([1-9][0-9]{0,15})-([a-f0-9]{40})\Z')
MAX_METADATA = 8 * 1024 * 1024
MAX_DESCRIPTOR = 64 * 1024
MAX_PACKAGE = 8 * 1024**3
BLOCK = 1024 * 1024


class UpdateError(Exception):
    """A deliberately sanitized error safe for terminal and host-control logs."""


def require(condition, message):
    if not condition:
        raise UpdateError(message)


def decode_json(data):
    def pairs(items):
        value = {}
        for key, item in items:
            require(key not in value, 'Duplicate JSON key')
            value[key] = item
        return value
    try:
        return json.loads(data, object_pairs_hook=pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(UpdateError('Invalid JSON number')))
    except (ValueError, UnicodeError, RecursionError):
        raise UpdateError('Invalid JSON document') from None


def safe_path(path, *, regular=False):
    path = Path(path).absolute()
    require('..' not in path.parts, 'Unsafe local path')
    for part in (path, *path.parents):
        try:
            info = part.lstat()
        except FileNotFoundError:
            continue
        require(not stat.S_ISLNK(info.st_mode) and
                not (getattr(info, 'st_file_attributes', 0) & 0x400), 'Symlink or reparse path rejected')
    if regular:
        require(path.is_file(), 'Required local file is unavailable')
    return path


def private_directory(path):
    path = safe_path(path)
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    require(path.is_dir(), 'Private directory is unavailable')
    if os.name != 'nt':
        info = path.stat()
        require(info.st_uid == os.getuid() and info.st_mode & 0o077 == 0,
                'Update directory must be private and owned by the current user')
    return path


def hash_file(path):
    digest = hashlib.sha256()
    with safe_path(path, regular=True).open('rb') as stream:
        for block in iter(lambda: stream.read(BLOCK), b''):
            digest.update(block)
    return digest.hexdigest()


def pinned_file(path, expected):
    path = safe_path(path, regular=True)
    require(isinstance(expected, str) and HEX64.fullmatch(expected), 'Missing pinned verifier or trust-root SHA-256')
    if os.name != 'nt':
        info = path.stat()
        require(info.st_uid in (0, os.getuid()) and info.st_mode & 0o022 == 0,
                'Verifier and trust root must not be writable by another user')
    require(hash_file(path) == expected, 'Pinned verifier or trust-root SHA-256 mismatch')
    return path


def read_config(path):
    path = safe_path(path, regular=True)
    if os.name != 'nt':
        info = path.stat()
        require(info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o600,
                'Share configuration must have mode 0600 and belong to the current user')
    require(path.stat().st_size <= MAX_DESCRIPTOR, 'Share configuration is too large')
    config = decode_json(path.read_bytes())
    require(isinstance(config, dict) and type(config.get('schema')) is int and config['schema'] == 1,
            'Unsupported Share configuration')
    require(isinstance(config.get('share_url'), str) and isinstance(config.get('share_password', ''), str),
            'Invalid Share configuration')
    Share(config['share_url'], config.get('share_password', ''))
    for key in ('verifier_path', 'trust_root_path'):
        require(isinstance(config.get(key), str) and Path(config[key]).is_absolute(),
                'Verifier and trust-root paths must be absolute')
    pinned_file(config['verifier_path'], config.get('verifier_sha256'))
    pinned_file(config['trust_root_path'], config.get('trust_root_sha256'))
    require(type(config.get('initial_sequence')) is int and 0 < config['initial_sequence'] < 10**16,
            'A trusted initial sequence floor is required')
    commit, digest = config.get('initial_source_commit'), config.get('initial_descriptor_sha256')
    require((commit is None and digest is None) or
            (isinstance(commit, str) and COMMIT.fullmatch(commit) and isinstance(digest, str) and HEX64.fullmatch(digest)),
            'Initial release identity must include both commit and descriptor SHA-256')
    return config


class RejectRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise UpdateError('Share redirect rejected')


class Share:
    def __init__(self, url, password=''):
        try:
            parsed = urlsplit(url)
            port = parsed.port
        except (TypeError, ValueError):
            raise UpdateError('Invalid HTTPS Share URL') from None
        token = re.fullmatch(r'/s/([A-Za-z0-9_-]{32,128})', parsed.fragment)
        require(parsed.scheme == 'https' and parsed.hostname and not parsed.username and
                not parsed.password and parsed.path in ('', '/') and not parsed.query and
                token and not any(c.isspace() or ord(c) < 32 for c in url) and
                (port is None or 0 < port < 65536), 'Invalid HTTPS Share URL')
        require(isinstance(password, str) and len(password) <= 4096, 'Invalid Share password')
        self.base = 'https://' + parsed.netloc
        self.token = token.group(1)
        self.password = password
        self.opener = build_opener(RejectRedirects(), HTTPSHandler(context=ssl.create_default_context()))

    def request(self, method, path, body=None):
        require(path in ('/api/v1/public/share', '/api/v1/public/share/children',
                         '/api/v1/public/share/download-ticket'), 'Out-of-scope Share request')
        data = None if body is None else json.dumps(body, separators=(',', ':')).encode()
        request = Request(self.base + path, data=data, method=method,
                          headers={'X-XDrive-Share-Token': self.token,
                                   'Content-Type': 'application/json', 'Accept': 'application/json'})
        for attempt in range(3):
            try:
                with self.opener.open(request, timeout=30) as response:
                    require(response.status == 200, 'Unexpected Share metadata status')
                    payload = response.read(MAX_METADATA + 1)
                    require(len(payload) <= MAX_METADATA, 'Share metadata exceeds limit')
                    value = decode_json(payload)
                    require(isinstance(value, dict), 'Invalid Share metadata response')
                    return value
            except HTTPError as error:
                status = error.code
                error.close()
                if status not in (408, 429, 500, 502, 503, 504):
                    raise UpdateError(f'Share metadata request failed (HTTP {status})') from None
            except (URLError, OSError, TimeoutError):
                pass
            if attempt < 2:
                time.sleep(attempt + 1)
        raise UpdateError('Share metadata request failed after bounded retries')

    def children(self, parent):
        require(type(parent) is int and parent >= 0, 'Invalid Share parent')
        cursor, found, cursors = 0, {}, set()
        for _ in range(100):
            require(cursor not in cursors, 'Repeated Share pagination cursor')
            cursors.add(cursor)
            page = self.request('POST', '/api/v1/public/share/children',
                                {'parent_id': parent, 'cursor': cursor, 'password': self.password})
            items = page.get('items')
            require(isinstance(items, list) and len(items) <= 100, 'Invalid Share page')
            for entry in items:
                require(isinstance(entry, dict) and type(entry.get('id')) is int and entry['id'] > 0 and
                        isinstance(entry.get('name'), str) and 0 < len(entry['name']) <= 255 and
                        entry.get('type') in ('file', 'dir') and type(entry.get('size')) is int and
                        0 <= entry['size'] <= MAX_PACKAGE, 'Invalid Share entry')
                name = entry['name']
                require(name not in found, 'Duplicate Share entry name')
                found[name] = entry
            following = page.get('next_cursor', 0)
            require(type(following) is int and following >= 0, 'Invalid Share cursor')
            if following == 0:
                return found
            require(following > cursor, 'Non-increasing Share cursor')
            cursor = following
        raise UpdateError('Share directory pagination exceeds limit')

    def download(self, node_id, destination, limit):
        require(type(node_id) is int and node_id > 0 and type(limit) is int and 0 < limit <= MAX_PACKAGE,
                'Invalid Share download')
        destination = safe_path(destination)
        require(not destination.exists(), 'Download destination already exists')
        for attempt in range(3):
            ticket = self.request('POST', '/api/v1/public/share/download-ticket',
                                  {'node_id': node_id, 'password': self.password})
            raw = ticket.get('url')
            require(isinstance(raw, str) and len(raw) <= 16384, 'Invalid download ticket URL')
            parsed = urlsplit(raw)
            query = parse_qsl(parsed.query, keep_blank_values=True)
            require(not parsed.scheme and not parsed.netloc and not parsed.fragment and
                    re.fullmatch(r'/api/v1/public-share-download/[1-9][0-9]*', parsed.path) and
                    len(query) == 1 and query[0][0] == 'ticket' and
                    re.fullmatch(r'[A-Za-z0-9_.-]+', query[0][1]), 'Out-of-scope download ticket URL')
            request = Request(self.base + raw, headers={'Accept': 'application/octet-stream'})
            try:
                with self.opener.open(request, timeout=60) as response:
                    require(response.status == 200, 'Unexpected Share download status')
                    length = response.headers.get('Content-Length')
                    if length is not None:
                        require(length.isdigit() and int(length) <= limit, 'Share download exceeds expected size')
                    total = 0
                    with destination.open('xb') as output:
                        os.chmod(destination, 0o600)
                        while True:
                            chunk = response.read(min(BLOCK, limit - total + 1))
                            if not chunk:
                                break
                            total += len(chunk)
                            require(total <= limit, 'Share download exceeds expected size')
                            output.write(chunk)
                        output.flush()
                        os.fsync(output.fileno())
                    require(length is None or total == int(length), 'Truncated Share download')
                return destination
            except HTTPError as error:
                status = error.code
                error.close()
                if status not in (401, 403, 408, 429, 500, 502, 503, 504):
                    raise UpdateError(f'Share download failed (HTTP {status})') from None
            except (URLError, OSError, TimeoutError):
                pass
            except BaseException:
                if destination.exists():
                    destination.unlink()
                raise
            if destination.exists():
                destination.unlink()
            if attempt < 2:
                time.sleep(attempt + 1)
        raise UpdateError('Share download failed after bounded retries')


def verify_publisher(file, bundle, trust_root, *, verifier_path, verifier_sha256, trust_root_sha256):
    executable = pinned_file(verifier_path, verifier_sha256)
    root = pinned_file(trust_root, trust_root_sha256)
    artifact, bundle = safe_path(file, regular=True), safe_path(bundle, regular=True)
    require(bundle.stat().st_size <= MAX_METADATA, 'Attestation bundle exceeds limit')
    command = [str(executable), 'attestation', 'verify', str(artifact), '--bundle', str(bundle),
               '--custom-trusted-root', str(root), '--repo', REPOSITORY,
               '--signer-workflow', WORKFLOW, '--source-ref', 'refs/heads/master',
               '--deny-self-hosted-runners', '--format', 'json']
    # No GitHub authentication or Share credentials are needed for local verification.
    environment = dict(os.environ)
    for key in list(environment):
        if key.upper() in ('GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN'):
            del environment[key]
    environment['GH_PROMPT_DISABLED'] = '1'
    environment['GH_NO_UPDATE_NOTIFIER'] = '1'
    for key in ('TEMP', 'TMP', 'TMPDIR'):
        environment[key] = str(artifact.parent)
    try:
        result = subprocess.run(command, stdin=subprocess.DEVNULL, capture_output=True, text=True,
                                env=environment, check=False, timeout=90)
    except (OSError, subprocess.TimeoutExpired):
        raise UpdateError('Local publisher verification failed') from None
    require(result.returncode == 0 and len(result.stdout) <= MAX_METADATA, 'Publisher signature verification failed')
    verified = decode_json(result.stdout)
    require(isinstance(verified, list) and 0 < len(verified) <= 100, 'Missing verified publisher identity')
    for item in verified:
        try:
            identity = item['verificationResult']['signature']['certificate']['sourceRepositoryIdentifier']
        except (KeyError, TypeError):
            raise UpdateError('Missing verified numeric repository identity') from None
        require(type(identity) in (int, str) and str(identity) == str(REPOSITORY_ID),
                'Verified repository identity mismatch')
    return verified


def validate_descriptor(value):
    require(isinstance(value, dict) and type(value.get('schema')) is int and value['schema'] == 1 and
            type(value.get('repository_id')) is int and value['repository_id'] == REPOSITORY_ID and
            value.get('channel') == 'master' and value.get('platform') == 'linux/amd64', 'Invalid delivery identity')
    require(isinstance(value.get('source_commit'), str) and COMMIT.fullmatch(value['source_commit']) and
            type(value.get('sequence')) is int and 0 < value['sequence'] < 10**16, 'Invalid delivery sequence or commit')
    for key, name in (('manifest', 'manifest.json'), ('installer', 'xdrive-offline.py')):
        item = value.get(key)
        require(isinstance(item, dict) and item.get('name') == name and
                isinstance(item.get('sha256'), str) and HEX64.fullmatch(item['sha256']) and
                type(item.get('size')) is int and 0 < item['size'] <= MAX_METADATA, 'Invalid delivery artifact')
    return value


def check_floor(candidate, floor):
    require(type(candidate.get('sequence')) is int and type(floor.get('sequence')) is int,
            'Invalid rollback state')
    require(candidate['sequence'] >= floor['sequence'], 'Older mirrored release rejected')
    if candidate['sequence'] == floor['sequence']:
        require(all(candidate.get(key) and candidate.get(key) == floor.get(key)
                    for key in ('source_commit', 'descriptor_sha256')), 'Conflicting or unpinned release generation')


def download_verified_file(share, node_id, destination, expected_size, expected_sha256):
    require(type(expected_size) is int and 0 < expected_size <= MAX_PACKAGE and
            isinstance(expected_sha256, str) and HEX64.fullmatch(expected_sha256), 'Invalid expected artifact identity')
    destination = safe_path(destination)
    if destination.exists():
        require(destination.is_file(), 'Artifact cache is not a regular file')
        if destination.stat().st_size == expected_size and hash_file(destination) == expected_sha256:
            return destination
        destination.unlink()
    require(shutil.disk_usage(destination.parent).free >= expected_size + 64 * BLOCK, 'Insufficient staging disk space')
    handle, temporary = tempfile.mkstemp(prefix='.download-', dir=destination.parent)
    os.close(handle)
    temporary = Path(temporary)
    temporary.unlink()  # Share.download requires exclusive creation.
    try:
        share.download(node_id, temporary, expected_size)
        require(temporary.stat().st_size == expected_size and hash_file(temporary) == expected_sha256,
                'Downloaded artifact SHA-256 or size mismatch')
        temporary.replace(destination)
    finally:
        if temporary.exists():
            temporary.unlink()
    return destination


def child(entries, name, kind):
    entry = entries.get(name)
    require(isinstance(entry, dict) and entry.get('type') == kind and
            type(entry.get('id')) is int and entry['id'] > 0, 'Required Share artifact is unavailable')
    return entry


def download_metadata(share, entry, path, limit):
    require(type(entry.get('size')) is int and 0 < entry['size'] <= limit, 'Invalid metadata size')
    share.download(entry['id'], path, entry['size'])
    require(safe_path(path, regular=True).stat().st_size == entry['size'], 'Truncated Share metadata')


def publisher_arguments(config):
    return dict(verifier_path=config['verifier_path'], verifier_sha256=config['verifier_sha256'],
                trust_root_sha256=config['trust_root_sha256'])


def discover_release(share, floor, *, staging, config):
    require(share.request('GET', '/api/v1/public/share').get('type') == 'dir', 'Update source is not a folder Share')
    server = child(share.children(0), 'xDrive-Server', 'dir')
    roots = share.children(server['id'])
    master = child(roots, 'master', 'dir')
    package_root = child(roots, 'packages', 'dir')
    candidates = []
    for name, entry in share.children(master['id']).items():
        match = RELEASE.fullmatch(name)
        if entry.get('type') == 'dir' and match:
            candidates.append((int(match.group(1)), match.group(2), entry))
    require(candidates and len(candidates) <= 1000, 'No bounded mirrored master history is available')
    # An unfinished folder has no descriptor. Never fall back after finding a
    # completed candidate whose signature, identity or bytes fail verification.
    for sequence, commit, folder in sorted(candidates, key=lambda c: (c[0], c[1]), reverse=True):
        require(sequence >= floor['sequence'], 'No mirrored release satisfies the trusted rollback floor')
        entries = share.children(folder['id'])
        if 'delivery.json' not in entries:
            continue
        descriptor_path = staging / 'delivery.json'
        bundle_path = staging / 'delivery-attestation.jsonl'
        download_metadata(share, child(entries, 'delivery.json', 'file'), descriptor_path, MAX_DESCRIPTOR)
        download_metadata(share, child(entries, 'delivery-attestation.jsonl', 'file'), bundle_path, MAX_METADATA)
        verify_publisher(descriptor_path, bundle_path, config['trust_root_path'], **publisher_arguments(config))
        descriptor = validate_descriptor(decode_json(descriptor_path.read_bytes()))
        require(descriptor['sequence'] == sequence and descriptor['source_commit'] == commit,
                'Signed release differs from its Share directory identity')
        identity = dict(sequence=sequence, source_commit=commit, descriptor_sha256=hash_file(descriptor_path))
        check_floor(identity, floor)
        return dict(descriptor=descriptor, identity=identity, entries=entries, staging=staging,
                    package_root=package_root['id'])
    raise UpdateError('No complete mirrored master release is available')


def atomic_json(path, value):
    path = safe_path(path)
    handle, temporary = tempfile.mkstemp(prefix='.state-', dir=path.parent)
    temporary = Path(temporary)
    try:
        with os.fdopen(handle, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, sort_keys=True)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        temporary.chmod(0o600)
        temporary.replace(path)
        if os.name != 'nt':
            descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
    finally:
        if temporary.exists():
            temporary.unlink()


def read_floor(state, config):
    initial = {'sequence': config['initial_sequence']}
    if config.get('initial_source_commit'):
        initial.update(source_commit=config['initial_source_commit'],
                       descriptor_sha256=config['initial_descriptor_sha256'])
    path = safe_path(state / 'high-water.json')
    if not path.exists():
        return initial
    require(path.is_file() and path.stat().st_size <= MAX_DESCRIPTOR, 'Invalid local rollback state')
    if os.name != 'nt':
        require(path.stat().st_uid == os.getuid() and path.stat().st_mode & 0o077 == 0,
                'Rollback state is not private')
    value = decode_json(path.read_bytes())
    require(isinstance(value, dict) and type(value.get('sequence')) is int and
            0 < value['sequence'] < 10**16 and isinstance(value.get('source_commit'), str) and
            COMMIT.fullmatch(value['source_commit']) and isinstance(value.get('descriptor_sha256'), str) and
            HEX64.fullmatch(value['descriptor_sha256']), 'Invalid local rollback state')
    check_floor(value, initial)
    return value


@contextmanager
def update_lock(state):
    path = safe_path(state / 'update.lock')
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    stream = os.fdopen(descriptor, 'r+b')
    locked = False
    try:
        try:
            if os.name == 'nt':
                import msvcrt
                if path.stat().st_size == 0:
                    stream.write(b'0')
                    stream.flush()
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            locked = True
        except OSError:
            raise UpdateError('Another Share update is already running') from None
        yield
    finally:
        if locked:
            if os.name == 'nt':
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream, fcntl.LOCK_UN)
        stream.close()


def validate_manifest(manifest, descriptor):
    require(isinstance(manifest, dict) and type(manifest.get('schema')) is int and manifest['schema'] == 2 and
            manifest.get('source') == 'github' and manifest.get('channel') == 'master' and
            manifest.get('platform') == 'linux/amd64' and manifest.get('source_commit') == descriptor['source_commit'],
            'Manifest provenance does not match the authenticated delivery')
    packages = manifest.get('packages')
    require(isinstance(packages, dict) and set(packages) == set(COMPONENTS), 'Manifest must declare all five components')
    unpacked = 0
    for name in COMPONENTS:
        item = packages[name]
        require(isinstance(item, dict) and isinstance(item.get('sha256'), str) and HEX64.fullmatch(item['sha256']) and
                type(item.get('size')) is int and 0 < item['size'] <= MAX_PACKAGE and
                item.get('filename') == f"xdrive-{name}-{item['sha256'][:12]}.tar.gz", 'Invalid package identity')
        members = item.get('members')
        require(isinstance(members, dict) and 0 < len(members) <= 2000, 'Invalid package members')
        for member in members.values():
            require(isinstance(member, dict) and type(member.get('size')) is int and
                    0 <= member['size'] <= MAX_PACKAGE, 'Invalid unpacked member size')
            unpacked += member['size']
    require(unpacked <= 64 * 1024**3, 'Unpacked release exceeds supported limit')
    return unpacked


def prepare_release(share, release, state, config):
    descriptor = release['descriptor']
    directory = private_directory(state / 'releases' / f"{descriptor['sequence']}-{descriptor['source_commit']}")
    release['directory'] = directory
    for kind in ('manifest', 'installer'):
        item = descriptor[kind]
        entry = child(release['entries'], item['name'], 'file')
        require(entry.get('size') == item['size'], 'Share metadata differs from signed artifact size')
        download_verified_file(share, entry['id'], directory / item['name'], item['size'], item['sha256'])
    verify_publisher(directory / 'xdrive-offline.py', release['staging'] / 'delivery-attestation.jsonl',
                     config['trust_root_path'], **publisher_arguments(config))
    manifest = decode_json((directory / 'manifest.json').read_bytes())
    unpacked = validate_manifest(manifest, descriptor)
    # Account for verified archive cache, extracted members and working space.
    # Docker's own filesystem still performs its independent capacity checks.
    missing_bytes = 0
    for item in manifest['packages'].values():
        cached = safe_path(state / 'packages' / item['sha256'] / item['filename'])
        if not cached.is_file() or cached.stat().st_size != item['size'] or hash_file(cached) != item['sha256']:
            missing_bytes += item['size']
    require(shutil.disk_usage(state).free >= missing_bytes + unpacked + 1024 * BLOCK,
            'Insufficient free space to stage and extract this release')
    package_folders = share.children(release['package_root'])
    for name in COMPONENTS:
        item = manifest['packages'][name]
        folder = child(package_folders, item['sha256'], 'dir')
        entry = child(share.children(folder['id']), item['filename'], 'file')
        require(entry.get('size') == item['size'], 'Package listing differs from signed size')
        cache = private_directory(state / 'packages' / item['sha256']) / item['filename']
        download_verified_file(share, entry['id'], cache, item['size'], item['sha256'])
        target = safe_path(directory / item['filename'])
        if target.exists():
            require(target.is_file(), 'Invalid staged package path')
            if target.stat().st_size != item['size'] or hash_file(target) != item['sha256']:
                target.unlink()
        if not target.exists():
            # Prefer a local hard link; filesystems/sandboxes without that
            # capability use a bounded copy and verify it before activation.
            try:
                os.link(cache, target)
            except OSError:
                require(shutil.disk_usage(directory).free >= item['size'] + unpacked + 1024 * BLOCK,
                        'Insufficient disk space for package staging copy')
                try:
                    with cache.open('rb') as source, target.open('xb') as destination:
                        shutil.copyfileobj(source, destination, BLOCK)
                    target.chmod(0o600)
                    require(hash_file(target) == item['sha256'], 'Staged package changed during copy')
                except BaseException:
                    if target.exists():
                        target.unlink()
                    raise
        print(f'[xDrive Share] verified {name} ({item["size"]} bytes)', flush=True)
    release['manifest'] = manifest
    return release


def run_offline_install(release, home, workdir, *, backup_file_data=False):
    directory = safe_path(release['directory'])
    installer = safe_path(directory / 'xdrive-offline.py', regular=True)
    require(hash_file(installer) == release['descriptor']['installer']['sha256'], 'Installer changed after verification')
    environment = dict(os.environ)
    environment['XD_OFFLINE_NO_PULL'] = '1'
    for key in ('TEMP', 'TMP', 'TMPDIR'):
        environment[key] = str(workdir)
    for key in list(environment):
        if key.startswith('XDRIVE_') and ('SHARE_URL' in key or 'SHARE_PASSWORD' in key):
            del environment[key]
    command = [sys.executable, '-B', str(installer), 'install', '--dir', str(directory),
               '--components', ','.join(COMPONENTS), '--trusted-manifest-sha256',
               release['descriptor']['manifest']['sha256'], '--config-dir', str(home),
               '--workdir', str(workdir), '--update-source', 'xdrive']
    if backup_file_data:
        command.append('--backup-file-data')
    result = subprocess.run(command, env=environment, check=False)
    require(result.returncode == 0, 'Offline installation failed; inspect the existing installer rollback/status output')


def update(config, home, *, prefetch_only=False, backup_file_data=False, share=None):
    home = safe_path(home)
    require(home.is_dir(), 'Existing xDrive home is unavailable')
    state = private_directory(home / 'state' / 'xdrive-share-update')
    work = private_directory(state / 'work')
    with update_lock(state), tempfile.TemporaryDirectory(prefix='fetch-', dir=work) as temporary:
        staging = Path(temporary)
        share = share or Share(config['share_url'], config.get('share_password', ''))
        release = discover_release(share, read_floor(state, config), staging=staging, config=config)
        # Remember a valid newest identity even if subsequent transport fails.
        # Exact retry remains allowed; failed activation retains normal local rollback.
        atomic_json(state / 'high-water.json', release['identity'])
        prepare_release(share, release, state, config)
        if prefetch_only:
            print('[xDrive Share] prefetch complete; no installer executed.', flush=True)
        else:
            run_offline_install(release, home, staging, backup_file_data=backup_file_data)
            atomic_json(state / 'installed.json', release['identity'])
            print('[xDrive Share] offline installer completed successfully.', flush=True)
        return release['identity']


def main():
    parser = argparse.ArgumentParser(description='Verify and install master releases from an xDrive folder Share')
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--home', required=True, type=Path)
    parser.add_argument('--channel', choices=('master',), default='master')
    parser.add_argument('--prefetch-only', action='store_true')
    parser.add_argument('--backup-file-data', action='store_true')
    args = parser.parse_args()
    try:
        update(read_config(args.config), args.home, prefetch_only=args.prefetch_only,
               backup_file_data=args.backup_file_data)
        return 0
    except UpdateError as error:
        print(f'xDrive Share update: {error}', file=sys.stderr)
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        # Network/provider errors may contain capability URLs; never emit their
        # default exception text, traceback, HTTP body or verifier diagnostics.
        print('xDrive Share update: local I/O or invalid provider data; update stopped.', file=sys.stderr)
    except KeyboardInterrupt:
        print('xDrive Share update: cancelled.', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
