#!/usr/bin/env python3
"""Behavioral publisher tests at Share HTTP and GitHub download boundaries."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

fixtures = load('delivery_tests', HERE.parent / 'offline/test_delivery_descriptor.py')
client_fixture = load('client_tests', HERE / 'test-mirror-clients-to-share.py')
PATH = HERE / 'mirror-server-to-share.py'
mirror = load('server_mirror', PATH) if PATH.exists() else None


def digest(data):
    return hashlib.sha256(data).hexdigest()


class MemoryResponse(io.BytesIO):
    status = 200
    def __init__(self, data):
        super().__init__(data)
        self.headers = {'Content-Length': str(len(data))}


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(mirror, 'Server Share publisher must be implemented')
        self.root, self.manifest = fixtures.prepare(self)
        descriptor = dict(schema=1, repository_id=1382670236, channel='master', platform='linux/amd64',
                          source_commit='a' * 40, sequence=123,
                          manifest=dict(name='manifest.json', size=(self.root / 'manifest.json').stat().st_size,
                                        sha256=digest((self.root / 'manifest.json').read_bytes())),
                          installer=dict(name='xdrive-offline.py', size=10, sha256=digest(b'installer\n')))
        (self.root / 'delivery.json').write_text(json.dumps(descriptor), encoding='utf-8')
        (self.root / 'delivery-attestation.jsonl').write_bytes(b'{"bundle":"fixture"}\n')
        self.remote = client_fixture.FakeShare()
        self.share = mirror.Share('https://share.example/#/s/' + 'T' * 40)
        self.original_request = self.remote.request
        self.finalized = []
        self.corrupt_name = None
        self.share.request = self.request
        self.share.upload_chunk = self.remote.upload_chunk
        self.share.opener.open = self.open

    def request(self, method, path, body=None):
        if path == '/api/v1/public/share/children':
            entries = [dict(id=i + 1000, name=k[1], type='file', size=v[0])
                       for i, (k, v) in enumerate(self.remote.files.items()) if k[0] == body['parent_id']]
            entries += [dict(id=v, name=k[1], type='dir', size=0)
                        for k, v in self.remote.folders.items() if k[0] == body['parent_id']]
            return dict(items=entries, next_cursor=0)
        if path == '/api/v1/public/share/download-ticket':
            return {'url': '/api/v1/public-share-download/' + str(body['node_id']) + '?ticket=fixture'}
        result = self.original_request(method, path, body)
        if path.endswith('/finalize'):
            session = next(s for s in self.remote.sessions.values() if s['receipt']['id'] == path.rsplit('/', 2)[1])
            self.finalized.append(session['name'])
            if session['name'] == self.corrupt_name:
                key = session['parent'], session['name']
                size, data = self.remote.files[key]
                self.remote.files[key] = size, b'!' + data[1:]
        return result

    def open(self, request, **kwargs):
        node = int(request.full_url.split('/public-share-download/')[1].split('?')[0])
        data = list(self.remote.files.values())[node - 1000][1]
        return MemoryResponse(data)

    def test_completion_marker_is_last_and_exact_retry_rechecks_bytes(self):
        mirror.publish(self.root, self.share)
        self.assertEqual(self.finalized[-1], 'delivery.json')
        self.assertEqual(len(self.remote.files), 9)
        before = len(self.remote.chunks)
        mirror.publish(self.root, self.share)
        self.assertEqual(len(self.remote.chunks), before)
        self.assertEqual(len(self.remote.files), 9)

    def test_same_size_corrupt_existing_package_refuses_completion(self):
        mirror.publish(self.root, self.share)
        key = next(k for k in self.remote.files if k[1].endswith('.tar.gz'))
        size, data = self.remote.files[key]
        self.remote.files[key] = size, b'!' + data[1:]
        with self.assertRaises(mirror.MirrorError):
            mirror.publish(self.root, self.share)

    def test_newly_finalized_corruption_never_publishes_completion(self):
        self.corrupt_name = self.manifest['packages']['app']['filename']
        with self.assertRaises(mirror.MirrorError):
            mirror.publish(self.root, self.share)
        self.assertNotIn('delivery.json', self.finalized)

    def test_interrupted_upload_keeps_release_incomplete_then_resumes(self):
        original = self.remote.upload_chunk
        def interrupt(session, index, data, checksum):
            if self.finalized:
                raise mirror.MirrorError('interrupted')
            return original(session, index, data, checksum)
        self.share.upload_chunk = interrupt
        with self.assertRaises(mirror.MirrorError):
            mirror.publish(self.root, self.share)
        self.assertNotIn('delivery.json', self.finalized)
        self.share.upload_chunk = original
        mirror.publish(self.root, self.share)
        self.assertEqual(self.finalized[-1], 'delivery.json')

    def test_missing_local_package_fails_before_any_share_write(self):
        (self.root / self.manifest['packages']['postgres']['filename']).unlink()
        with self.assertRaises(mirror.MirrorError):
            mirror.publish(self.root, self.share)
        self.assertEqual(self.remote.directory_calls, [])

    def test_duplicate_remote_names_fail_closed(self):
        item = dict(id=1, name='duplicate', type='file', size=2)
        with patch.object(self.share, 'request', return_value=dict(items=[item, item], next_cursor=0)):
            with self.assertRaises(mirror.MirrorError):
                self.share.entries(0)

    def test_malformed_listing_and_duplicate_node_identity_fail_closed(self):
        cases = ({}, {'items': 'bad', 'next_cursor': 0},
                 {'items': [dict(id=1, name='a', type='file', size=2),
                            dict(id=1, name='b', type='file', size=2)], 'next_cursor': 0})
        for response in cases:
            with patch.object(self.share, 'request', return_value=response):
                with self.assertRaises(mirror.MirrorError):
                    self.share.entries(0)

    def test_corrupt_github_download_is_not_promoted_to_local_cache(self):
        item = self.manifest['packages']['postgres']
        path = self.root / item['filename']
        data = path.read_bytes()
        path.unlink()
        def download(command, **kwargs):
            folder = Path(command[command.index('--dir') + 1])
            (folder / item['filename']).write_bytes(b'!' + data[1:])
            return subprocess.CompletedProcess(command, 0)
        with patch.object(mirror.subprocess, 'run', side_effect=download):
            with self.assertRaises(mirror.MirrorError):
                mirror.fetch_packages(self.root)
        self.assertFalse(path.exists())
        self.assertFalse(list(self.root.glob('xdrive-package-fetch-*')))

    def test_wrong_descriptor_identity_fails_before_any_share_write(self):
        path = self.root / 'delivery.json'
        descriptor = json.loads(path.read_text(encoding='utf-8'))
        descriptor['source_commit'] = 'b' * 40
        path.write_text(json.dumps(descriptor), encoding='utf-8')
        with self.assertRaises(mirror.MirrorError):
            mirror.publish(self.root, self.share)
        self.assertEqual(self.remote.directory_calls, [])

    def test_download_ticket_rejects_out_of_scope_and_never_sends_share_bearer(self):
        entry = dict(id=2, type='file', size=4)
        for url in ('https://evil.example/file', '//evil.example/file', '/private?ticket=a',
                    '/api/v1/public-share-download/1?ticket=a&other=b'):
            with patch.object(self.share, 'request', return_value={'url': url}):
                with self.assertRaises(mirror.MirrorError):
                    self.share.verify_remote(entry, 4, digest(b'good'))
        with patch.object(self.share, 'request', return_value={'url': '/api/v1/public-share-download/1?ticket=a'}), \
             patch.object(self.share.opener, 'open', return_value=MemoryResponse(b'good')) as opened:
            self.share.verify_remote(entry, 4, digest(b'good'))
        self.assertNotIn('X-xdrive-share-token', dict(opened.call_args.args[0].header_items()))

    def test_truncated_or_oversize_remote_stream_is_rejected(self):
        for data in (b'bad', b'longer'):
            with patch.object(self.share, 'request', return_value={'url': '/api/v1/public-share-download/1?ticket=a'}), \
                 patch.object(self.share.opener, 'open', return_value=MemoryResponse(data)):
                with self.assertRaises(mirror.MirrorError):
                    self.share.verify_remote(dict(id=1, type='file', size=4), 4, digest(b'good'))

    def test_fetch_reused_package_uses_exact_validated_github_release_and_hash(self):
        item = self.manifest['packages']['postgres']
        path = self.root / item['filename']
        expected = path.read_bytes()
        path.unlink()
        calls = []
        def download(command, **kwargs):
            calls.append(command)
            folder = Path(command[command.index('--dir') + 1])
            (folder / item['filename']).write_bytes(expected)
            return subprocess.CompletedProcess(command, 0)
        with patch.object(mirror.subprocess, 'run', side_effect=download):
            mirror.fetch_packages(self.root)
        self.assertEqual(calls[0][0:4], ['gh', 'release', 'download', item['release_tag']])
        self.assertEqual(calls[0][calls[0].index('--repo') + 1], 'lazyxu/xdrive')
        self.assertEqual(path.read_bytes(), expected)
        path.write_bytes(b'!' + expected[1:])
        with self.assertRaises(mirror.MirrorError):
            mirror.fetch_packages(self.root)


if __name__ == '__main__':
    unittest.main()
