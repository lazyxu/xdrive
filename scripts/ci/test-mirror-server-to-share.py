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

    def test_server_fast_upload_receipt_for_same_content_at_new_path_sends_no_chunks(self):
        content = b'content already authorized by the Share server'
        self.remote.files[(50, 'existing-original.bin')] = (len(content), content)
        source = self.root / 'new-filename.bin'
        source.write_bytes(content)
        original = self.share.request
        def instant(method, path, body=None):
            if path == '/api/v1/public/share/uploads':
                self.assertEqual(body['sha256'], digest(content))
                self.assertEqual(body['size'], len(content))
                self.assertEqual(body['name'], 'new-filename.bin')
                # The API boundary grants a finalized, Share-scoped CAS receipt.
                # This is not a claim that the pre-migration backend supports it.
                self.remote.files[(body['parent_id'], body['name'])] = (len(content), content)
                return {'id': 'fast-upload', 'status': 'finalized', 'instant_cas_reused': True}
            return original(method, path, body)
        self.share.request = instant
        self.assertEqual(self.share.upload(51, source.name, source, digest(content), 'server-app', 'a' * 40), 'resumed')
        self.assertEqual(self.remote.chunks, [])
        self.assertEqual(self.remote.files[(51, source.name)][1], content)

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


class MemoryGitHub:
    def __init__(self, record=None, files=None):
        self.record = record
        self.files = dict(files or {})
        self.events = []

    def get(self, tag):
        if self.record is None:
            return None
        return dict(self.record, assets=[dict(name=n, size=len(v), digest='sha256:' + digest(v))
                                        for n, v in self.files.items()])

    def download(self, tag, name, directory):
        (directory / name).write_bytes(self.files[name])

    def verify(self, directory, bundle):
        signed = json.loads(bundle.read_text(encoding='utf-8'))
        for name in ('manifest.json', 'xdrive-offline.py', 'delivery.json'):
            if signed.get(name) != digest((directory / name).read_bytes()):
                raise mirror.MirrorError('Fixture signature does not bind this artifact')
        self.events.append('verify')

    def packages(self, manifest):
        self.events.append('verify-packages')

    def create(self, tag, commit, notes=""):
        if self.record is not None:
            raise AssertionError('existing release overwritten')
        self.record = dict(id=7, tag_name=tag, target_commitish=commit, draft=True)
        self.events.append('create-draft')

    def upload(self, tag, path):
        if path.name in self.files:
            raise AssertionError('existing asset overwritten')
        self.files[path.name] = path.read_bytes()
        self.events.append('upload:' + path.name)

    def publish(self, tag):
        if set(self.files) != set(mirror.RELEASE_FILES):
            raise AssertionError('incomplete release published')
        self.events.append('publish')
        self.record['draft'] = False


class DraftRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(callable(getattr(mirror, 'resume_github', None)), 'Verified draft recovery is missing')
        self.root, self.manifest = fixtures.prepare(self)
        self.commit = 'a' * 40
        self.tag = 'offline-manifest-' + self.commit[:12]
        self.descriptor = dict(schema=1, repository_id=1382670236, channel='master', platform='linux/amd64',
                               source_commit=self.commit, sequence=123,
                               manifest=dict(name='manifest.json', size=(self.root / 'manifest.json').stat().st_size,
                                             sha256=digest((self.root / 'manifest.json').read_bytes())),
                               installer=dict(name='xdrive-offline.py', size=10, sha256=digest(b'installer\n')))
        (self.root / 'delivery.json').write_text(json.dumps(self.descriptor, sort_keys=True, indent=2) + '\n', encoding='utf-8')
        mirror.write_checksums(self.root)
        signed = {n: digest((self.root / n).read_bytes()) for n in ('manifest.json', 'xdrive-offline.py', 'delivery.json')}
        for name in ('delivery-attestation.jsonl', 'xdrive-offline-attestation.json'):
            (self.root / name).write_text(json.dumps(signed), encoding='utf-8')
        self.files = {n: (self.root / n).read_bytes() for n in mirror.RELEASE_FILES}
        self.record = dict(id=7, tag_name=self.tag, target_commitish=self.commit, draft=True)
        self.staging = self.root / 'resume'
        self.staging.mkdir()
        self.addCleanup(patch.stopall)
        patch.object(mirror.delivery, 'generate', return_value=self.descriptor).start()
        patch.object(mirror, 'installer_source', return_value=self.root / 'xdrive-offline.py').start()

    def test_complete_draft_is_verified_then_published_before_replay(self):
        github = MemoryGitHub(self.record, self.files)
        self.assertTrue(mirror.resume_github(self.staging, self.commit, self.root, github))
        self.assertFalse(github.record['draft'])
        self.assertEqual(github.events[-1], 'publish')
        self.assertNotIn('create-draft', github.events)
        self.assertFalse(any(e.startswith('upload:') for e in github.events))

    def test_signed_partial_draft_rebuilds_missing_metadata_preserving_original_bundle(self):
        keep = {k: v for k, v in self.files.items() if k in ('manifest.json', 'delivery-attestation.jsonl')}
        github = MemoryGitHub(self.record, keep)
        self.assertTrue(mirror.resume_github(self.staging, self.commit, self.root, github))
        self.assertEqual(github.files, self.files)
        self.assertNotIn('upload:delivery-attestation.jsonl', github.events)
        self.assertFalse(github.record['draft'])

    def test_unsigned_partial_draft_requests_build_then_only_uploads_missing_assets(self):
        github = MemoryGitHub(self.record, {'xdrive-offline.py': self.files['xdrive-offline.py']})
        self.assertFalse(mirror.resume_github(self.staging, self.commit, self.root, github))
        self.assertTrue(github.record['draft'])
        self.assertEqual(github.events, [])
        mirror.publish_github(self.root, self.commit, github)
        self.assertFalse(github.record['draft'])
        self.assertNotIn('upload:xdrive-offline.py', github.events)

    def test_existing_attestation_is_reused_instead_of_overwriting_new_random_signature(self):
        github = MemoryGitHub(self.record, self.files)
        for name in ('delivery-attestation.jsonl', 'xdrive-offline-attestation.json'):
            (self.root / name).write_text(json.dumps(json.loads(self.files[name]), indent=4), encoding='utf-8')
        mirror.publish_github(self.root, self.commit, github)
        self.assertEqual(github.files, self.files)
        self.assertEqual((self.root / 'delivery-attestation.jsonl').read_bytes(), self.files['delivery-attestation.jsonl'])

    def test_asset_collision_or_wrong_draft_target_blocks_all_mutation(self):
        for record, files in ((self.record, dict(self.files, **{'xdrive-offline.py': b'evil bytes'})),
                              (dict(self.record, target_commitish='b' * 40), self.files)):
            github = MemoryGitHub(record, files)
            with self.assertRaises(mirror.MirrorError):
                mirror.publish_github(self.root, self.commit, github)
            self.assertTrue(github.record['draft'])
            self.assertFalse(any(e.startswith('upload:') or e == 'publish' for e in github.events))

    def test_incomplete_published_release_is_never_silently_repaired(self):
        github = MemoryGitHub(dict(self.record, draft=False), {'manifest.json': self.files['manifest.json']})
        with self.assertRaises(mirror.MirrorError):
            mirror.resume_github(self.staging, self.commit, self.root, github)
        self.assertEqual(github.events, [])

    def test_new_release_is_created_as_draft_and_manifest_is_uploaded_first(self):
        github = MemoryGitHub()
        mirror.publish_github(self.root, self.commit, github)
        uploads = [e for e in github.events if e.startswith('upload:')]
        self.assertEqual(uploads[0], 'upload:manifest.json')
        self.assertEqual(github.events[-1], 'publish')
        self.assertFalse(github.record['draft'])

    def test_new_release_rejects_inconsistent_attestation_alias_before_creation(self):
        github = MemoryGitHub()
        (self.root / 'xdrive-offline-attestation.json').write_bytes(b'wrong bundle')
        with self.assertRaises(mirror.MirrorError):
            mirror.publish_github(self.root, self.commit, github)
        self.assertIsNone(github.record)
        self.assertNotIn('create-draft', github.events)

    def test_unpublished_package_prevents_draft_publication(self):
        github = MemoryGitHub(self.record, self.files)
        def unavailable(manifest):
            raise mirror.MirrorError('Referenced package is not published')
        github.packages = unavailable
        with self.assertRaises(mirror.MirrorError):
            mirror.resume_github(self.staging, self.commit, self.root, github)
        self.assertTrue(github.record['draft'])
        self.assertNotIn('publish', github.events)

    def test_previous_manifest_excludes_newer_draft(self):
        older = dict(tag_name='offline-manifest-' + 'a' * 12, draft=False, created_at='2026-11-01')
        newer = dict(tag_name='offline-manifest-' + 'b' * 12, draft=True, created_at='2026-11-02')
        self.assertEqual(mirror.previous_manifest([older, newer]), older['tag_name'])


if __name__ == '__main__':
    unittest.main()
