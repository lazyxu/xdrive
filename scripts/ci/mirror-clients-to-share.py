#!/usr/bin/env python3
"""Mirror verified client installers into an existing xDrive view+upload share.

No Owner session, private API, overwrite, or raw share capability in source/logs.
The share URL and optional password come only from runner secrets.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import ssl
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener, HTTPSHandler
import zipfile

CHUNK_SIZE = 8 * 1024 * 1024
MAX_FILE_SIZE = 256 * 1024 * 1024
PLATFORMS = {"windows": ".exe", "linux": ".deb", "dsm": ".spk", "android": ".apk", "ios": ".ipa"}
SHA_RE = re.compile(r"^[a-f0-9]{40}$")
DIGEST_RE = re.compile(r"^[a-f0-9]{64}$")
TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{32,128}$")


class MirrorError(Exception):
    pass


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as fp:
        for chunk in iter(lambda: fp.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def validate_source(path: Path, platform: str) -> None:
    if not path.is_file() or path.is_symlink():
        raise MirrorError(f"Missing or symlinked {platform} installer")
    if not 0 < path.stat().st_size <= MAX_FILE_SIZE:
        raise MirrorError(f"Invalid {platform} installer size (limit 256 MiB)")
    with path.open('rb') as fp:
        signature = fp.read(8)
    if platform == 'windows' and signature[:2] != b'MZ':
        raise MirrorError('Windows installer lacks PE envelope')
    if platform == 'linux' and signature != b'!<arch>\n':
        raise MirrorError('Linux installer lacks Debian archive envelope')
    if platform in ('android', 'ios'):
        if signature[:2] != b'PK':
            raise MirrorError(f'{platform} installer is not a ZIP')
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
            if platform == 'android' and 'AndroidManifest.xml' not in names:
                raise MirrorError('Android APK has no manifest')
            if platform == 'ios' and not any(re.fullmatch(r'Payload/[^/]+\.app/Info\.plist', n) for n in names):
                raise MirrorError('iOS IPA has no app Info.plist')
    # DSM's signed checksum and real XZ/GUI envelope are validated before
    # plan creation by scripts/ci/verify-synology-spk-release.sh.


def find_one(folder: Path, pattern: str) -> Path:
    found = list(folder.glob(pattern))
    if len(found) != 1:
        raise MirrorError(f'Expected one {pattern} in {folder.name}, got {len(found)}')
    return found[0]


def build_manifest(staging: Path, with_dsm: bool) -> dict:
    meta = staging / 'meta'
    source = {
        'windows': (staging / 'snapshot' / 'xDriveSetup-amd64.exe', meta / 'snapshot.sha'),
        'linux': (staging / 'snapshot' / 'xdrive-linux-amd64.deb', meta / 'snapshot.sha'),
        'android': (find_one(staging / 'android', '*.apk'), meta / 'android.sha'),
        'ios': (find_one(staging / 'ios', '*.ipa'), meta / 'ios.sha'),
    }
    if with_dsm:
        source['dsm'] = (find_one(staging / 'snapshot', 'xdrivenas-armada38x-*.spk'), meta / 'snapshot.sha')
    items = []
    for platform, (path, sha_path) in source.items():
        commit = sha_path.read_text(encoding='ascii').strip()
        if not SHA_RE.fullmatch(commit):
            raise MirrorError(f'Invalid {platform} source commit')
        if path.suffix != PLATFORMS[platform]:
            raise MirrorError(f'Unexpected {platform} installer suffix')
        validate_source(path, platform)
        items.append({
            'platform': platform,
            'commit': commit,
            'path': str(path.resolve()),
            'name': path.name,
            'size': path.stat().st_size,
            'sha256': sha256_file(path),
        })
    return {'schema': 1, 'items': items}


def validate_manifest(manifest: dict) -> list[dict]:
    if manifest.get('schema') != 1 or not isinstance(manifest.get('items'), list):
        raise MirrorError('Unsupported manifest')
    if not 1 <= len(manifest['items']) <= len(PLATFORMS):
        raise MirrorError('Unexpected installer count')
    found = set()
    for item in manifest['items']:
        platform = item.get('platform')
        if platform not in PLATFORMS or platform in found:
            raise MirrorError('Invalid or duplicate platform')
        found.add(platform)
        name, commit, digest, size = (item.get(k) for k in ('name', 'commit', 'sha256', 'size'))
        if (not isinstance(name, str) or len(name) > 160 or
            '/' in name or '\\' in name or name != Path(name).name or
            not name.endswith(PLATFORMS[platform]) or
            not isinstance(commit, str) or not SHA_RE.fullmatch(commit) or
            not isinstance(digest, str) or not DIGEST_RE.fullmatch(digest) or
            type(size) is not int or not 0 < size <= MAX_FILE_SIZE):
            raise MirrorError(f'Invalid manifest entry for {platform}')
        path = Path(item.get('path', ''))
        validate_source(path, platform)
        if path.name != name or path.stat().st_size != size or sha256_file(path) != digest:
            raise MirrorError(f'{platform} artifact changed after source verification')
    return manifest['items']


class RejectRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward a Share bearer to another host/path via redirect.
        raise MirrorError('Share endpoint redirected (refusing to forward capability)')


class Share:
    def __init__(self, url: str, password: str = '', *, sleeper=time.sleep):
        parsed = urlsplit(url)
        match = re.fullmatch(r'/s/([A-Za-z0-9_-]{32,128})', parsed.fragment.lstrip('#'))
        if (parsed.scheme != 'https' or parsed.username or parsed.password or
            parsed.query or parsed.path not in ('', '/') or not match or
            not TOKEN_RE.fullmatch(match.group(1)) or not parsed.hostname):
            raise MirrorError('Share secret must be the complete HTTPS #/s/<token> folder link')
        self.base = f'{parsed.scheme}://{parsed.netloc}'
        self.token = match.group(1)
        self.password = password
        self.sleeper = sleeper
        self.opener = build_opener(RejectRedirects(), HTTPSHandler(context=ssl.create_default_context()))

    def request(self, method: str, path: str, body: object = None, *, binary: bool = False) -> dict:
        if not path.startswith('/api/v1/public/share') or '?' in path or '#' in path:
            raise MirrorError('Refusing unscoped API route')
        data = body if binary else (None if body is None else json.dumps(body, separators=(',', ':')).encode())
        headers = {
            'X-XDrive-Share-Token': self.token,
            'X-XDrive-Share-Password': self.password,
            'Accept': 'application/json',
        }
        if data is not None:
            headers['Content-Type'] = 'application/octet-stream' if binary else 'application/json'
        # Chunks carry their own SHA256 header from the caller, not a user cookie.
        if binary:
            raise MirrorError('Binary upload must use upload_chunk')
        return self._send(method, path, data, headers)

    def _send(self, method: str, path: str, data: bytes | None, headers: dict) -> dict:
        request = Request(self.base + path, data=data, headers=headers, method=method)
        for attempt in range(5):
            try:
                with self.opener.open(request, timeout=180) as response:
                    payload = response.read(2 * 1024 * 1024)
                    return json.loads(payload) if payload else {}
            except HTTPError as error:
                if error.code not in (408, 429, 500, 502, 503, 504):
                    raise MirrorError(f'Share API {method} failed with HTTP {error.code}') from None
                last_error = f'HTTP {error.code}'
            except (OSError, URLError, TimeoutError) as error:
                last_error = error.__class__.__name__
            if attempt < 4:
                self.sleeper(min(20, 2 ** attempt + secrets.randbelow(1000) / 1000))
        raise MirrorError(f'Share API {method} failed after bounded retries ({last_error})')

    def upload_chunk(self, session_id: str, index: int, data: bytes, checksum: str) -> None:
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', session_id):
            raise MirrorError('Invalid server upload session identifier')
        path = f'/api/v1/public/share/uploads/{session_id}/chunks/{index}'
        headers = {
            'X-XDrive-Share-Token': self.token,
            'X-XDrive-Share-Password': self.password,
            'X-Chunk-SHA256': checksum,
            'Content-Type': 'application/octet-stream',
        }
        self._send('PUT', path, data, headers)

    def verify_grant(self) -> None:
        info = self.request('GET', '/api/v1/public/share')
        if (info.get('type') != 'dir' or
            info.get('capabilities', {}).get('upload') is not True):
            raise MirrorError('Target is not a writable folder share (enable view_upload)')
        if info.get('requires_password') and not self.password:
            raise MirrorError('Share password is required; configure the secret')

    def directory(self, parent: int, name: str) -> int:
        response = self.request('POST', '/api/v1/public/share/directories', {'parent_id': parent, 'name': name})
        value = response.get('id')
        if type(value) is not int or value <= 0:
            raise MirrorError('Share directory creation returned invalid ID')
        return value

    def entries(self, parent: int) -> dict[str, dict]:
        cursor = 0
        seen_cursors: set[int] = set()
        found: dict[str, dict] = {}
        while True:
            if cursor in seen_cursors:
                raise MirrorError('Share listing cursor repeated')
            seen_cursors.add(cursor)
            response = self.request('POST', '/api/v1/public/share/children',
                                    {'parent_id': parent, 'cursor': cursor, 'password': self.password})
            for entry in response.get('items', []):
                if entry['name'] in found:
                    raise MirrorError('Share listing contained duplicate names')
                found[entry['name']] = entry
            next_cursor = response.get('next_cursor') or 0
            if not next_cursor:
                return found
            if type(next_cursor) is not int or next_cursor <= 0 or len(seen_cursors) > 1000:
                raise MirrorError('Invalid or excessive Share pagination')
            cursor = next_cursor

    def upload(self, parent: int, name: str, content: Path, digest: str, platform: str, commit: str) -> str:
        expected_size = content.stat().st_size
        previous = self.entries(parent).get(name)
        if previous is not None:
            if previous.get('type') != 'file' or previous.get('size') != expected_size:
                raise MirrorError(f'Existing {platform}/{commit[:12]} file conflicts; never overwrite')
            return 'skipped'
        # HMAC gives a stable unguessable session intent across GitHub retries.
        # Unlike random per-attempt keys, this cannot multiply finalized files.
        identity = f'xdrive-client-mirror-v1\n{platform}\n{commit}\n{name}\n{digest}'
        resume_key = 'ps1_' + hmac.new(self.token.encode(), identity.encode(), hashlib.sha256).hexdigest()
        session = self.request('POST', '/api/v1/public/share/uploads', {
            'parent_id': parent, 'name': name, 'size': expected_size,
            'chunk_size': CHUNK_SIZE, 'resume_key': resume_key,
            'sha256': digest, 'conflict_policy': 'keep_both',
        })
        if session.get('status') == 'finalized':
            return 'resumed'
        if session.get('status') != 'active':
            raise MirrorError('Share upload session was not accepted')
        session_id = session.get('id')
        if not isinstance(session_id, str):
            raise MirrorError('Share upload session has no ID')
        if session.get('chunk_size') != CHUNK_SIZE:
            raise MirrorError('Share server changed requested chunk size')
        count = (expected_size + CHUNK_SIZE - 1) // CHUNK_SIZE
        if session.get('chunk_count') != count:
            raise MirrorError('Share server chunk count differs from local file')
        received = {x['index']: x for x in session.get('received_chunks', [])}
        with content.open('rb') as fd:
            for index in range(count):
                data = fd.read(CHUNK_SIZE)
                checksum = hashlib.sha256(data).hexdigest()
                known = received.get(index)
                if known is not None and known.get('sha256') == checksum and known.get('size') == len(data):
                    continue
                self.upload_chunk(session_id, index, data, checksum)
        final = self.request('POST', f'/api/v1/public/share/uploads/{session_id}/finalize', {})
        if final.get('status') != 'finalized':
            raise MirrorError('Share did not confirm upload finalize')
        return 'uploaded'


def publish(manifest: dict, share: Share) -> list[tuple[str, str, str]]:
    items = validate_manifest(manifest)   # Validate every input BEFORE any upload.
    share.verify_grant()                 # Real permission check; no blind PUT.
    results = []
    for item in items:
        platform, commit = item['platform'], item['commit']
        folder = 0
        for segment in ('xDrive-Clients', platform, commit[:12]):
            folder = share.directory(folder, segment)
        path = Path(item['path'])
        result = share.upload(folder, item['name'], path, item['sha256'], platform, commit)
        # Small immutable checksum sidecar; generated only after the binary is
        # successfully finalized or verified present under the same SHA folder.
        checksum_path = path.with_name(path.name + '.sha256.mirror-temp')
        try:
            checksum_path.write_text(f"{item['sha256']}  {item['name']}\n", encoding='ascii')
            share.upload(folder, item['name'] + '.sha256', checksum_path,
                         sha256_file(checksum_path), platform, commit)
        finally:
            checksum_path.unlink(missing_ok=True)
        results.append((platform, commit[:12], result))
        print(f'{platform}: {result}, {item["size"]} bytes, commit {commit[:12]}')
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    plan = sub.add_parser('plan')
    plan.add_argument('--staging', type=Path, required=True)
    plan.add_argument('--manifest', type=Path, required=True)
    plan.add_argument('--include-dsm', action='store_true')
    push = sub.add_parser('publish')
    push.add_argument('--manifest', type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == 'plan':
            document = build_manifest(args.staging, args.include_dsm)
            args.manifest.write_text(json.dumps(document, indent=2) + '\n', encoding='utf-8')
            for item in document['items']:
                print(f"{item['platform']}: {item['size']} bytes, source {item['commit'][:12]}, SHA256 {item['sha256']}")
        else:
            url = os.environ.get('XDRIVE_CLIENT_MIRROR_SHARE_URL', '')
            if not url:
                raise MirrorError('Missing XDRIVE_CLIENT_MIRROR_SHARE_URL repository secret')
            share = Share(url, os.environ.get('XDRIVE_CLIENT_MIRROR_SHARE_PASSWORD', ''))
            publish(json.loads(args.manifest.read_text(encoding='utf-8')), share)
        return 0
    except (MirrorError, ValueError, KeyError, OSError, zipfile.BadZipFile) as exc:
        # Never log URL, token, password, error response body, or request object.
        print(f'Client mirror: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
