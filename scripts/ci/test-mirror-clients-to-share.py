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
        self.base = 'https://fixture.test'
        self.opener = self
        self.download_requests = []

    def open(self, request, timeout):
        self.download_requests.append(request)
        identifier = int(request.full_url.split('/public-share-download/')[1].split('?')[0])
        binary = list(self.files.values())[identifier - 1][1]
        stream = io.BytesIO(binary)
        stream.status = 200
        stream.headers = {'Content-Length': str(len(binary))}
        return stream

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
            return {'items': [dict(id=i, name=k[1], type='file', size=v[0])
                              for i, (k, v) in enumerate(self.files.items(), 1) if k[0] == parent], 'next_cursor': 0}
        if path == '/api/v1/public/share/download-ticket':
            return {'url': '/api/v1/public-share-download/' + str(body['node_id']) + '?ticket=fixture'}
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
    verify_remote = mirror.Share.verify_remote


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

    @staticmethod
    def entry(platform, file, commit='a'*40, source_time='2026-11-03T12:34:56Z'):
        return {
            'platform': platform, 'commit': commit, 'source_time': source_time,
            'path': str(file), 'name': file.name,
            'published_name': mirror.published_name(platform, file.name, commit, source_time),
            'size': file.stat().st_size, 'sha256': mirror.sha256_file(file),
        }

    @staticmethod
    def elf(machine):
        return b'\x7fELF\x02\x01' + b'\x00'*12 + machine + b'fixture'

    def test_snapshot_published_dispatch_is_opt_in_and_pr_cannot_upload(self):
        root = Path(__file__).resolve().parents[2]
        workflow = (root / '.github/workflows/client-artifact-share-mirror.yml').read_text()
        publisher = (root / '.github/workflows/release.yml').read_text()
        self.assertIn('repository_dispatch:\n    types: [xdrive_snapshot_published]', workflow)
        self.assertIn('event_type=xdrive_snapshot_published', publisher)
        self.assertIn("github.ref == 'refs/heads/master'", workflow)
        self.assertIn("vars.XDRIVE_CLIENT_MIRROR_ENABLED == 'true'", workflow)
        self.assertIn("github.event_name == 'repository_dispatch'", workflow)
        self.assertIn("github.event_name == 'schedule'", workflow)
        self.assertIn("if: github.event_name == 'pull_request'", workflow)
        self.assertIn("if: github.event_name != 'workflow_dispatch' || inputs.dry_run == false", workflow)
        self.assertIn(
            "if: github.event_name == 'repository_dispatch' || github.event_name == 'schedule' || github.event_name == 'push' || inputs.dry_run == false",
            workflow,
        )
        self.assertIn('secrets.XDRIVE_CLIENT_MIRROR_SHARE_URL', workflow)

    def test_master_mirror_code_push_reconciles_old_snapshot_without_unrelated_pushes(self):
        root = Path(__file__).resolve().parents[2]
        workflow = (root / '.github/workflows/client-artifact-share-mirror.yml').read_text()
        trigger = workflow.split('\non:\n', 1)[1].split('\npermissions:', 1)[0]
        self.assertIn('  push:\n    branches: [master]\n    paths:', trigger)
        allowed = trigger.split('  push:\n', 1)[1].split('  pull_request:\n', 1)[0]
        self.assertIn("      - '.github/workflows/client-artifact-share-mirror.yml'", allowed)
        self.assertIn("      - 'scripts/ci/mirror-clients-to-share.py'", allowed)
        self.assertIn("      - 'scripts/ci/collect-client-share-mirror.sh'", allowed)
        self.assertNotIn("      - 'docs/", allowed)
        self.assertNotIn("      - 'internal/", allowed)
        self.assertNotIn("      - 'scripts/ci/test-", allowed)
        mirror_job = workflow.split('  mirror:\n', 1)[1]
        self.assertIn("github.ref == 'refs/heads/master'", mirror_job)
        self.assertIn("vars.XDRIVE_CLIENT_MIRROR_ENABLED == 'true'", mirror_job)
        self.assertIn("github.event_name == 'push'", mirror_job)
        self.assertIn("github.event_name == 'workflow_dispatch'", mirror_job)
        self.assertIn("cancel-in-progress: false", workflow)
        self.assertIn("if: github.event_name == 'pull_request'", workflow)
        self.assertIn("if: github.event_name != 'workflow_dispatch' || inputs.dry_run == false", workflow)

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
        entry = self.entry('ios', ipa)
        mirror.validate_manifest({'schema': 2, 'items': [entry]})
        ipa.write_bytes(ipa_bytes() + b'changed')
        with self.assertRaises(mirror.MirrorError):
            mirror.validate_manifest({'schema': 2, 'items': [entry]})

    def test_immutable_publish_skips_existing_and_includes_digest(self):
        ipa = self.root / 'xDrive-unsigned.ipa'
        ipa.write_bytes(ipa_bytes())
        item = self.entry('ios', ipa)
        manifest = {'schema': 2, 'items': [item]}
        share = FakeShare()
        self.assertEqual(mirror.publish(manifest, share)[0][2], 'uploaded')
        self.assertEqual(len(share.files), 2)
        parent = share.folders[(0, 'Mobile')]
        self.assertEqual(share.files[(parent, item['published_name'])][1], ipa.read_bytes())
        self.assertIn(item['sha256'].encode(), share.files[(parent, item['published_name'] + '.sha256')][1])
        self.assertIn(item['published_name'].encode(), share.files[(parent, item['published_name'] + '.sha256')][1])
        self.assertNotIn((0, 'latest'), share.folders)
        self.assertNotIn((0, 'xDrive-Clients'), share.folders)
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
        (root / ('android/xdrive-android-master-' + 'b'*12 + '-debug.apk')).write_bytes(
            self._zip_bytes('AndroidManifest.xml'))
        (root / 'ios/xDrive-unsigned.ipa').write_bytes(ipa_bytes())
        (root / 'snapshot/xdrive-backup-linux-amd64.tar.gz').write_bytes(b'\x1f\x8b' + b'fixture')
        (root / 'snapshot/xdrive-backup-windows-amd64.zip').write_bytes(self._zip_bytes('xdrive-backup.exe'))
        (root / 'snapshot/xdrive-source-agent-linux-amd64').write_bytes(self.elf(b'\x3e\x00'))
        (root / 'snapshot/xdrive-source-agent-linux-arm64').write_bytes(self.elf(b'\xb7\x00'))
        (root / 'meta/snapshot.sha').write_text('a'*40)
        (root / 'meta/android.sha').write_text('b'*40)
        (root / 'meta/ios.sha').write_text('c'*40)
        for source in ('snapshot', 'android', 'ios'):
            (root / 'meta' / (source + '.time')).write_text('2026-11-03T12:34:56Z')
        manifest = mirror.build_manifest(root, with_dsm=False)
        self.assertEqual({p['platform'] for p in manifest['items']},
                         {'windows', 'linux', 'android', 'ios', 'backup-linux', 'backup-windows',
                          'agent-linux-amd64', 'agent-linux-arm64'})
        for item in manifest['items']:
            self.assertEqual(len(item['sha256']), 64)
            self.assertEqual(item['published_name'],
                             mirror.published_name(item['platform'], item['name'], item['commit'],
                                                   item['source_time']))
            self.assertIn('20261103T123456Z', item['published_name'])
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
        item = self.entry('ios', ipa, commit='b'*40)
        share = FakeShare(allow=False)
        with self.assertRaises(mirror.MirrorError):
            mirror.publish({'schema': 2, 'items': [item]}, share)
        self.assertEqual(share.directory_calls, [])


    def test_snapshot_client_collector_pins_time_and_supporting_asset_hashes(self):
        root = Path(__file__).resolve().parents[2]
        source = (root / 'scripts/ci/collect-client-share-mirror.sh').read_text()
        for filename in ('xdrive-backup-linux-amd64.tar.gz',
                         'xdrive-backup-windows-amd64.zip',
                         'xdrive-source-agent-linux-amd64',
                         'xdrive-source-agent-linux-arm64'):
            self.assertIn("--pattern '" + filename + "'", source)
            self.assertIn('verify_release_asset "$supporting"', source)
        self.assertIn('gh api "repos/$repo/commits/$sha"', source)
        self.assertIn('commit_utc "$snapshot_sha"', source)
        self.assertIn('commit_utc "$sha"', source)
        self.assertIn('sha256sum --check --ignore-missing SHA256SUMS.txt', source)

    def test_elf_architecture_and_backup_archive_types_are_exact(self):
        for platform, machine in (('agent-linux-amd64', b'\x3e\x00'),
                                  ('agent-linux-arm64', b'\xb7\x00')):
            file = self.root / platform
            file.write_bytes(self.elf(machine))
            mirror.validate_source(file, platform)
            wrong = b'\xb7\x00' if machine == b'\x3e\x00' else b'\x3e\x00'
            file.write_bytes(self.elf(wrong))
            with self.assertRaises(mirror.MirrorError):
                mirror.validate_source(file, platform)
        backup = self.root / 'xdrive-backup-windows-amd64.zip'
        backup.write_bytes(self._zip_bytes('xdrive-backup.exe'))
        mirror.validate_source(backup, 'backup-windows')
        backup.write_bytes(b'PKinvalid')
        with self.assertRaises(zipfile.BadZipFile):
            mirror.validate_source(backup, 'backup-windows')

    def test_plan_b_group_names_and_stable_originals(self):
        time = '2026-11-03T12:34:56Z'
        commit = 'a' * 40
        cases = [
            ('windows', 'xDriveSetup-amd64.exe', 'Desktop',
             'xDriveSetup-master-20261103T123456Z-aaaaaaaaaaaa-win-amd64.exe'),
            ('linux', 'xdrive-linux-amd64.deb', 'Desktop',
             'xDriveDesktop-master-20261103T123456Z-aaaaaaaaaaaa-linux-amd64.deb'),
            ('android', 'xdrive-android-master-aaaaaaaaaaaa-debug.apk', 'Mobile',
             'xDrive-master-20261103T123456Z-aaaaaaaaaaaa-android-debug.apk'),
            ('ios', 'xDrive-unsigned.ipa', 'Mobile',
             'xDrive-master-20261103T123456Z-aaaaaaaaaaaa-ios-unsigned.ipa'),
            ('dsm', 'xdrivenas-armada38x-0.1.0-7642.spk', 'DSM',
             'xdrivenas-master-20261103T123456Z-aaaaaaaaaaaa-dsm-armada38x-0.1.0-7642.spk'),
            ('backup-linux', 'xdrive-backup-linux-amd64.tar.gz', 'Backup-CLI',
             'xdrive-backup-master-20261103T123456Z-aaaaaaaaaaaa-linux-amd64.tar.gz'),
            ('backup-windows', 'xdrive-backup-windows-amd64.zip', 'Backup-CLI',
             'xdrive-backup-master-20261103T123456Z-aaaaaaaaaaaa-win-amd64.zip'),
            ('agent-linux-amd64', 'xdrive-source-agent-linux-amd64', 'Source-Agent',
             'xdrive-source-agent-master-20261103T123456Z-aaaaaaaaaaaa-linux-amd64'),
            ('agent-linux-arm64', 'xdrive-source-agent-linux-arm64', 'Source-Agent',
             'xdrive-source-agent-master-20261103T123456Z-aaaaaaaaaaaa-linux-arm64'),
        ]
        for platform, original, group, expected in cases:
            with self.subTest(platform=platform):
                self.assertEqual(mirror.GROUPS[platform], group)
                self.assertEqual(mirror.published_name(platform, original, commit, time), expected)
        self.assertNotIn('latest', mirror.GROUPS.values())

    def test_reject_tampered_filename_and_invalid_source_time_before_write(self):
        ipa = self.root / 'xDrive-unsigned.ipa'
        ipa.write_bytes(ipa_bytes())
        item = self.entry('ios', ipa)
        share = FakeShare()
        for patched in (dict(published_name='xDrive-unsigned.ipa'),
                        dict(published_name='../xDrive.exe'),
                        dict(source_time='2026-02-30T00:00:00Z'),
                        dict(source_time='2026-11-03T12:34:56+09:00'),
                        dict(name='xDrive-unsigned-bad.ipa')):
            with self.subTest(patched=patched), self.assertRaises(mirror.MirrorError):
                mirror.publish({'schema': 2, 'items': [dict(item, **patched)]}, share)
        self.assertEqual(share.directory_calls, [])

    def test_legacy_paths_are_not_removed_or_overwritten_by_flat_archive(self):
        ipa = self.root / 'xDrive-unsigned.ipa'
        ipa.write_bytes(ipa_bytes())
        share = FakeShare()
        legacy_id = share.directory(0, 'xDrive-Clients')
        share.files[(legacy_id, 'old.ipa')] = (len(ipa.read_bytes()), ipa.read_bytes())
        item = self.entry('ios', ipa)
        self.assertEqual(mirror.publish({'schema': 2, 'items': [item]}, share)[0][2], 'uploaded')
        self.assertEqual(share.files[(legacy_id, 'old.ipa')][1], ipa.read_bytes())
        self.assertIn((0, 'Mobile'), share.folders)
        self.assertNotIn((0, 'latest'), share.folders)

    def test_same_source_retries_reuse_flat_name_instead_of_creating_keep_both(self):
        ipa = self.root / 'xDrive-unsigned.ipa'
        ipa.write_bytes(ipa_bytes())
        item = self.entry('ios', ipa)
        share = FakeShare()
        first = mirror.publish({'schema': 2, 'items': [item]}, share)
        second = mirror.publish({'schema': 2, 'items': [item]}, share)
        self.assertEqual(first[0][2], 'uploaded')
        self.assertEqual(second[0][2], 'skipped')
        self.assertEqual(len(share.files), 2)
        self.assertFalse(any('(1)' in name for (_, name) in share.files))

    def test_existing_different_size_refuses_keep_both(self):
        share = FakeShare()
        share.files[(123, 'test.apk')] = (234, b'wrong')
        path = self.root / 'test.apk'
        path.write_bytes(b'PK12345')
        with self.assertRaisesRegex(mirror.MirrorError, 'never overwrite'):
            share.upload(123, 'test.apk', path, mirror.sha256_file(path), 'android', 'c' * 40)
        self.assertEqual(len(share.sessions), 0)

    def test_existing_same_size_wrong_sha256_is_not_skipped(self):
        share = FakeShare()
        share.files[(123, 'test.apk')] = (7, b'PKwrong')
        path = self.root / 'test.apk'
        path.write_bytes(b'PKright')
        with self.assertRaisesRegex(mirror.MirrorError, 'SHA256'):
            share.upload(123, 'test.apk', path, mirror.sha256_file(path), 'android', 'c' * 40)
        self.assertEqual(share.sessions, {})
        self.assertEqual(share.chunks, [])

    def test_existing_verified_bytes_use_only_scoped_ticket(self):
        share = FakeShare()
        path = self.root / 'test.apk'
        path.write_bytes(b'PKright')
        share.files[(123, path.name)] = (7, path.read_bytes())
        self.assertEqual(share.upload(123, path.name, path, mirror.sha256_file(path), 'android', 'c' * 40), 'skipped')
        self.assertEqual(share.chunks, [])
        self.assertEqual(len(share.download_requests), 1)
        request = share.download_requests[0]
        self.assertIsNone(request.get_header('X-xdrive-share-token'))
        self.assertIsNone(request.get_header('X-xdrive-share-password'))

    def test_instant_receipt_at_new_path_sends_no_chunks(self):
        share = FakeShare()
        path = self.root / 'test.apk'
        path.write_bytes(b'PKright')
        original_request = share.request
        def request(method, route, body=None):
            if route == '/api/v1/public/share/uploads':
                self.assertEqual(body['sha256'], mirror.sha256_file(path))
                self.assertEqual(body['size'], path.stat().st_size)
                share.files[(body['parent_id'], body['name'])] = (path.stat().st_size, path.read_bytes())
                return {'id': 'instant-session', 'status': 'finalized'}
            return original_request(method, route, body)
        share.request = request
        self.assertEqual(share.upload(123, path.name, path, mirror.sha256_file(path), 'android', 'c' * 40), 'resumed')
        self.assertEqual(share.chunks, [])
        self.assertEqual(share.files[(123, path.name)][1], path.read_bytes())

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
