#!/usr/bin/env python3
"""Offline, no-secret contract tests of immutable client Share publishing."""
import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
import zipfile

MODULE_PATH = Path(__file__).with_name('mirror-clients-to-share.py')
spec = importlib.util.spec_from_file_location('xdrive_share_mirror', MODULE_PATH)
mirror = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mirror)


class FakeShare:
    def __init__(self, allow=True):
        self.allow = allow
        self.token = 'private-fixture-share-token'
        self.password = ''
        self.folders = {}
        self.files = {}
        self.sessions = {}
        self.chunks = []
        self.directory_calls = []
        self.next_dir = 1

    def request(self, method, path, body=None):
        if path == '/api/v1/public/share' and method == 'GET':
            return {'type': 'dir', 'capabilities': {'upload': self.allow}, 'requires_password': False}
        if path == '/api/v1/public/share/directories':
            key = (body['parent_id'], body['name'])
            self.directory_calls.append(key)
            if key not in self.folders:
                self.folders[key] = self.next_dir
                self.next_dir += 1
            return {'id': self.folders[key], 'name': body['name'], 'parent_id': body['parent_id']}
        if path == '/api/v1/public/share/children':
            parent = body['parent_id']
            return {'items': [dict(name=k[1], type='file', size=v[0])
                              for k, v in self.files.items() if k[0] == parent], 'next_cursor': 0}
        if path == '/api/v1/public/share/uploads' and method == 'POST':
            key = body['resume_key']
            if key in self.sessions:
                return self.sessions[key]['receipt']
            sid = 'session-' + str(len(self.sessions) + 1)
            receipt = {'id': sid, 'status': 'active', 'chunk_size': body['chunk_size'],
                       'chunk_count': (body['size'] + body['chunk_size'] - 1) // body['chunk_size'],
                       'received_chunks': []}
            self.sessions[key] = {'receipt': receipt, 'parent': body['parent_id'], 'name': body['name'],
                                  'size': body['size'], 'chunks': {}}
            return receipt
        if path.endswith('/finalize'):
            sid = path.rsplit('/', 2)[1]
            s = next(s for s in self.sessions.values() if s['receipt']['id'] == sid)
            binary = b''.join(s['chunks'][index] for index in sorted(s['chunks']))
            if len(binary) != s['size']:
                raise AssertionError('fixture missing chunk bytes')
            self.files[(s['parent'], s['name'])] = (len(binary), binary)
            s['receipt']['status'] = 'finalized'
            return {'status': 'finalized'}
        raise AssertionError((method, path, body))

    def upload_chunk(self, session_id, index, data, checksum):
        assert hashlib.sha256(data).hexdigest() == checksum
        s = next(s for s in self.sessions.values() if s['receipt']['id'] == session_id)
        s['chunks'][index] = data
        self.chunks.append((session_id, index, len(data)))

    directory = mirror.Share.directory
    entries = mirror.Share.entries
    verify_grant = mirror.Share.verify_grant
    upload = mirror.Share.upload


def ipa_bytes():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        archive.writestr('Payload/xDriveIOS.app/Info.plist', b'plist')
    return buffer.getvalue()


class MirrorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_url_validation_requires_https_and_full_share_hash_route(self):
        valid = 'https://example.test:8443/#/s/' + 'Z' * 43
        share = mirror.Share(valid)
        self.assertEqual(share.base, 'https://example.test:8443')
        for invalid in ('http://example.test/#/s/' + 'A' * 43,
                        'https://example.test/s/' + 'A' * 43,
                        'https://example.test/#/s/short',
                        'https://bad.test:443/#/s/' + 'A' * 43 + '?junk'):
            with self.subTest(invalid=invalid), self.assertRaises(mirror.MirrorError):
                mirror.Share(invalid)

    def test_manifest_checks_source_bytes_before_upload(self):
        ipa = self.root / 'xDrive-unsigned.ipa'
        ipa.write_bytes(ipa_bytes())
        entry = {'platform': 'ios', 'commit': 'a' * 40, 'path': str(ipa), 'name': ipa.name,
                 'size': ipa.stat().st_size, 'sha256': mirror.sha256_file(ipa)}
        mirror.validate_manifest({'schema': 1, 'items': [entry]})
        ipa.write_bytes(ipa_bytes() + b'changed')
        with self.assertRaises(mirror.MirrorError):
            mirror.validate_manifest({'schema': 1, 'items': [entry]})

    def test_immutable_publish_skips_existing_and_includes_digest(self):
        ipa = self.root / 'xDrive-unsigned.ipa'
        ipa.write_bytes(ipa_bytes())
        item = {'platform': 'ios', 'commit': 'a' * 40, 'path': str(ipa), 'name': ipa.name,
                'size': ipa.stat().st_size, 'sha256': mirror.sha256_file(ipa)}
        manifest = {'schema': 1, 'items': [item]}
        share = FakeShare()
        self.assertEqual(mirror.publish(manifest, share)[0][2], 'uploaded')
        self.assertEqual(len(share.files), 2)
        parent = share.folders[(share.folders[(share.folders[(0, 'xDrive-Clients')], 'ios')], 'a'*12)]
        self.assertEqual(share.files[(parent, 'xDrive-unsigned.ipa')][1], ipa.read_bytes())
        self.assertIn(item['sha256'].encode(), share.files[(parent, 'xDrive-unsigned.ipa.sha256')][1])
        chunks = len(share.chunks)
        self.assertEqual(mirror.publish(manifest, share)[0][2], 'skipped')
        self.assertEqual(len(share.files), 2)
        self.assertEqual(len(share.chunks), chunks)
        self.assertFalse((self.root / 'xDrive-unsigned.ipa.sha256.mirror-temp').exists())

    def test_plan_only_approved_local_installers(self):
        root = self.root
        for folder in ('snapshot', 'android', 'ios', 'meta'):
            (root / folder).mkdir()
        (root / 'snapshot/xDriveSetup-amd64.exe').write_bytes(b'MZfixture')
        (root / 'snapshot/xdrive-linux-amd64.deb').write_bytes(b'!<arch>\nfixture')
        (root / 'android/xdrive-android-debug.apk').write_bytes(self._zip_bytes('AndroidManifest.xml'))
        (root / 'ios/xDrive-unsigned.ipa').write_bytes(ipa_bytes())
        (root / 'meta/snapshot.sha').write_text('a'*40)
        (root / 'meta/android.sha').write_text('b'*40)
        (root / 'meta/ios.sha').write_text('c'*40)
        manifest = mirror.build_manifest(root, with_dsm=False)
        self.assertEqual({p['platform'] for p in manifest['items']}, {'windows', 'linux', 'android', 'ios'})
        for item in manifest['items']:
            self.assertEqual(len(item['sha256']), 64)
        mirror.validate_manifest(manifest)

    @staticmethod
    def _zip_bytes(member):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            archive.writestr(member, b'fixture')
        return buffer.getvalue()

    def test_read_only_share_fails_before_create(self):
        ipa = self.root / 'xDrive-unsigned.ipa'
        ipa.write_bytes(ipa_bytes())
        item = {'platform': 'ios', 'commit': 'b'*40, 'path': str(ipa), 'name': ipa.name,
                'size': ipa.stat().st_size, 'sha256': mirror.sha256_file(ipa)}
        share = FakeShare(allow=False)
        with self.assertRaises(mirror.MirrorError):
            mirror.publish({'schema': 1, 'items': [item]}, share)
        self.assertEqual(share.directory_calls, [])

    def test_existing_different_size_refuses_keep_both(self):
        share = FakeShare()
        share.files[(123, 'test.apk')] = (234, b'wrong')
        path = self.root / 'test.apk'
        path.write_bytes(b'PK12345')
        with self.assertRaisesRegex(mirror.MirrorError, 'never overwrite'):
            share.upload(123, 'test.apk', path, mirror.sha256_file(path), 'android', 'c' * 40)
        self.assertEqual(len(share.sessions), 0)

    def test_resume_upload_hmac_is_stable_and_not_plain_token(self):
        share = FakeShare()
        path = self.root / 'test.bin'
        path.write_bytes(b'a' * 120)
        digest = mirror.sha256_file(path)
        self.assertEqual(share.upload(1, 'test.bin', path, digest, 'ios', 'a' * 40), 'uploaded')
        key = next(iter(share.sessions))
        self.assertTrue(key.startswith('ps1_'))
        self.assertEqual(len(key), 68)
        self.assertEqual(share.upload(1, 'test.bin', path, digest, 'ios', 'a' * 40), 'skipped')

    def test_chunk_upload_is_bounded(self):
        share = FakeShare()
        path = self.root / 'test.bin'
        path.write_bytes(b'z' * (mirror.CHUNK_SIZE + 3))
        share.upload(2, 'test.bin', path, mirror.sha256_file(path), 'android', 'a' * 40)
        self.assertEqual([chunk[2] for chunk in share.chunks], [mirror.CHUNK_SIZE, 3])


if __name__ == '__main__':
    unittest.main()
