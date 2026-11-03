#!/usr/bin/env python3
"""Behavioral publisher tests at Share HTTP and GitHub download boundaries."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import unittest
from contextlib import redirect_stderr
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

    def test_signed_go_companion_is_uploaded_before_completion_and_rechecked(self):
        go_binary = self.root / mirror.GO_INSTALLER_ASSET
        go_binary.write_bytes(b'\x7fELF' + b'signed-build-exactly')
        descriptor = json.loads((self.root / 'delivery.json').read_text())
        descriptor['go_installer'] = dict(name=mirror.GO_INSTALLER_ASSET,
                                          size=go_binary.stat().st_size,
                                          sha256=digest(go_binary.read_bytes()))
        (self.root / 'delivery.json').write_text(json.dumps(descriptor), encoding='utf-8')
        mirror.publish(self.root, self.share)
        self.assertEqual(self.finalized[-1], 'delivery.json')
        self.assertIn(mirror.GO_INSTALLER_ASSET, self.finalized)
        self.assertLess(self.finalized.index(mirror.GO_INSTALLER_ASSET),
                        self.finalized.index('delivery.json'))
        self.assertEqual(len(self.remote.files), 10)
        go_binary.write_bytes(b'\x7fELF' + b'tampered-build-exactl')
        with self.assertRaises(mirror.MirrorError):
            mirror.publish(self.root, self.share)
        self.assertEqual(self.finalized.count('delivery.json'), 1)

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

    def test_share_mirror_failure_reports_fixed_stage_without_leaking_exception(self):
        secret = 'https://private-user:secret@example.invalid/#/s/PRIVATE-CAPABILITY'
        stderr = io.StringIO()
        with patch.object(self.share, 'upload', side_effect=mirror.MirrorError(secret)), \
             patch.object(mirror, 'Share', return_value=self.share), \
             patch.dict(mirror.os.environ, {'XDRIVE_CLIENT_MIRROR_SHARE_URL': 'configured'}), \
             patch.object(mirror.sys, 'argv', ['mirror', 'publish', '--directory', str(self.root)]), \
             redirect_stderr(stderr):
            self.assertEqual(mirror.main(), 1)
        self.assertEqual(stderr.getvalue(),
                         'Server release verification failed [share-package-app]; no publication may be assumed\n')
        self.assertNotIn(secret, stderr.getvalue())
        self.assertNotIn('PRIVATE-CAPABILITY', stderr.getvalue())

    def test_github_package_fetch_failure_reports_fixed_stage(self):
        secret = 'https://secret.example.invalid/release?token=private'
        item = self.manifest['packages']['postgres']
        (self.root / item['filename']).unlink()
        stderr = io.StringIO()
        with patch.object(mirror.subprocess, 'run', side_effect=OSError(secret)), \
             patch.object(mirror.sys, 'argv', ['mirror', 'fetch', '--directory', str(self.root)]), \
             redirect_stderr(stderr):
            self.assertEqual(mirror.main(), 1)
        self.assertEqual(stderr.getvalue(),
                         'Server release verification failed [github-package-postgres]; no publication may be assumed\n')
        self.assertNotIn(secret, stderr.getvalue())

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
        return dict(self.record, assets=[dict(id=i, name=n, size=len(v), digest='sha256:' + digest(v))
                                        for i, (n, v) in enumerate(self.files.items(), 1)])

    def download(self, tag, name, directory):
        (directory / name).write_bytes(self.files[name])

    def verify(self, directory, bundle):
        signed = json.loads(bundle.read_text(encoding='utf-8'))
        names = ('manifest.json', 'xdrive-offline.py', 'delivery.json')
        if (directory / mirror.GO_INSTALLER_ASSET).exists():
            names += (mirror.GO_INSTALLER_ASSET,)
        for name in names:
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
        if (tag.startswith('offline-manifest-') and
                set(self.files) not in (set(mirror.RELEASE_FILES), set(mirror.RELEASE_FILES_GO))
                or not tag.startswith('offline-manifest-') and len(self.files) != 1):
            raise AssertionError('incomplete release published')
        self.events.append('publish')
        self.record['draft'] = False


class GitHubLookupTests(unittest.TestCase):
    def setUp(self):
        self.tag = 'offline-manifest-' + 'a' * 12
        self.record = dict(id=7, tag_name=self.tag, target_commitish='a' * 40, draft=True, assets=[])

    def responses(self, command, **kwargs):
        if command[1:3] == ['api', 'graphql']:
            self.assertIn('tag=' + self.tag, command)
            release = None if self.record is None else dict(
                databaseId=self.record['id'], tagName=self.record['tag_name'], isDraft=self.record['draft'])
            body = dict(data=dict(repository=dict(databaseId=1382670236, release=release)))
            return subprocess.CompletedProcess(command, 0, stdout=json.dumps(body), stderr='')
        if command[1:3] == ['api', 'repos/lazyxu/xdrive/releases/7']:
            return subprocess.CompletedProcess(command, 0, stdout=json.dumps(self.record), stderr='')
        if '/releases/tags/' in command[2]:
            # GitHub's REST tag endpoint cannot see a pending draft tag.
            return subprocess.CompletedProcess(command, 1, stdout='', stderr='gh: Not Found (HTTP 404)')
        raise AssertionError('Unexpected GitHub lookup: ' + repr(command))

    def test_pending_draft_tag_is_resolved_to_exact_numeric_release(self):
        with patch.object(mirror.subprocess, 'run', side_effect=self.responses):
            self.assertEqual(mirror.GitHub().get(self.tag), self.record)

    def test_only_explicit_graphql_absence_returns_missing(self):
        self.record = None
        with patch.object(mirror.subprocess, 'run', side_effect=self.responses):
            self.assertIsNone(mirror.GitHub().get(self.tag))
        for body in ({'errors': [{'message': 'Resource not accessible'}]},
                     {'data': {'repository': None}},
                     {'data': {'repository': {'databaseId': 1382670236}}},
                     {'data': {'repository': {'databaseId': 1, 'release': None}}}):
            with self.subTest(body=body), patch.object(mirror.subprocess, 'run', return_value=
                    subprocess.CompletedProcess([], 0, stdout=json.dumps(body), stderr='')):
                with self.assertRaises(mirror.MirrorError):
                    mirror.GitHub().get(self.tag)

    def test_disappearing_or_replaced_numeric_release_fails_closed(self):
        for replacement in (subprocess.CompletedProcess([], 1, stdout='', stderr='gh: Not Found (HTTP 404)'),
                            subprocess.CompletedProcess([], 0, stdout=json.dumps(dict(self.record, id=8)), stderr=''),
                            subprocess.CompletedProcess([], 0, stdout=json.dumps(dict(self.record, tag_name='other')), stderr='')):
            original = self.responses
            def changed(command, **kwargs):
                return original(command, **kwargs) if command[2] == 'graphql' else replacement
            with self.subTest(replacement=replacement), patch.object(mirror.subprocess, 'run', side_effect=changed):
                with self.assertRaises(mirror.MirrorError):
                    mirror.GitHub().get(self.tag)


class SignedGoInstallerReleaseTests(unittest.TestCase):
    def setUp(self):
        self.root, self.manifest = fixtures.prepare(self)
        self.commit = 'a' * 40
        self.binary = self.root / mirror.GO_INSTALLER_ASSET
        self.binary.write_bytes(b'\x7fELF' + b'exact-release-build-bytes')
        self.descriptor = dict(
            schema=1, repository_id=1382670236, channel='master',
            platform='linux/amd64', source_commit=self.commit, sequence=42,
            manifest=dict(name='manifest.json',
                          size=(self.root / 'manifest.json').stat().st_size,
                          sha256=digest((self.root / 'manifest.json').read_bytes())),
            installer=dict(name='xdrive-offline.py', size=10,
                           sha256=digest(b'installer\n')),
            go_installer=dict(name=mirror.GO_INSTALLER_ASSET,
                              size=self.binary.stat().st_size,
                              sha256=digest(self.binary.read_bytes())),
        )
        (self.root / 'delivery.json').write_text(
            json.dumps(self.descriptor), encoding='utf-8')
        mirror.write_checksums(self.root)
        signed = {name: digest((self.root / name).read_bytes())
                  for name in ('manifest.json', 'xdrive-offline.py',
                               'delivery.json', mirror.GO_INSTALLER_ASSET)}
        for name in mirror.BUNDLE_FILES:
            (self.root / name).write_text(json.dumps(signed), encoding='utf-8')

    def test_signed_go_release_is_exactly_published_without_altering_legacy_schema(self):
        self.assertEqual(mirror.local_release_files(self.root), mirror.RELEASE_FILES_GO)
        self.assertEqual(self.descriptor['schema'], 1)
        self.assertEqual(self.descriptor['installer']['name'], 'xdrive-offline.py')
        self.assertLess(mirror.RELEASE_FILES_GO.index(mirror.GO_INSTALLER_ASSET),
                        mirror.RELEASE_FILES_GO.index('delivery.json'))
        github = MemoryGitHub()
        mirror.publish_github(self.root, self.commit, github)
        self.assertIsNotNone(github.record)
        self.assertFalse(github.record['draft'])
        self.assertEqual(set(github.files), set(mirror.RELEASE_FILES_GO))
        self.assertEqual(github.files[mirror.GO_INSTALLER_ASSET], self.binary.read_bytes())

    def test_modified_go_binary_is_rejected_before_publishing(self):
        self.binary.write_bytes(b'\x7fELF' + b'evil-replacement-bytes-')
        github = MemoryGitHub()
        with self.assertRaises(mirror.MirrorError):
            mirror.publish_github(self.root, self.commit, github)
        self.assertIsNone(github.record)


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

    def test_publication_ignores_non_identity_asset_metadata_changes(self):
        for field, before, after in (
                ('download_count', 0, 1),
                ('browser_download_url', 'https://github.com/draft/asset', 'https://github.com/published/asset'),
                ('updated_at', '2026-11-02T23:08:40Z', '2026-11-02T23:08:41Z')):
            with self.subTest(field=field):
                github = MemoryGitHub()
                original_get = github.get
                def get(tag):
                    record = original_get(tag)
                    if record is not None:
                        for asset in record['assets']:
                            asset[field] = before if record['draft'] else after
                    return record
                github.get = get
                mirror.publish_github(self.root, self.commit, github)
                self.assertFalse(github.record['draft'])
                self.assertEqual(github.files, self.files)

    def test_publication_rejects_changed_fixed_asset_or_release_identity(self):
        changes = {
            'asset-id': lambda r: r['assets'][0].update(id=999),
            'asset-size': lambda r: r['assets'][0].update(size=r['assets'][0]['size'] + 1),
            'asset-digest': lambda r: r['assets'][0].update(digest='sha256:' + '0' * 64),
            'asset-name': lambda r: r['assets'][0].update(name='unexpected.json'),
            'missing-asset': lambda r: r['assets'].pop(),
            'release-id': lambda r: r.update(id=999),
            'source-commit': lambda r: r.update(target_commitish='b' * 40),
        }
        for name, change in changes.items():
            with self.subTest(change=name):
                github = MemoryGitHub()
                original_get = github.get
                def get(tag):
                    record = original_get(tag)
                    if record is not None and not record['draft']:
                        change(record)
                    return record
                github.get = get
                with self.assertRaises(mirror.MirrorError):
                    mirror.publish_github(self.root, self.commit, github)

    def test_unverifiable_asset_id_blocks_publication(self):
        for asset_id in (None, True, 0, -1, '7'):
            with self.subTest(asset_id=asset_id):
                github = MemoryGitHub(dict(self.record), self.files)
                original_get = github.get
                def get(tag):
                    record = original_get(tag)
                    record['assets'][0]['id'] = asset_id
                    return record
                github.get = get
                with self.assertRaises(mirror.MirrorError):
                    mirror.publish_github(self.root, self.commit, github)
                self.assertNotIn('publish', github.events)

    def test_publication_failure_diagnostics_are_controlled_and_hide_exception_text(self):
        secret = 'https://user:private-token@example.invalid/secret'
        for stage in ('github-publish', 'github-post-publish-lookup', 'github-post-publish-identity'):
            with self.subTest(stage=stage):
                github = MemoryGitHub()
                original_get = github.get
                original_publish = github.publish
                def publish(tag):
                    if stage == 'github-publish':
                        raise OSError(secret)
                    original_publish(tag)
                def get(tag):
                    record = original_get(tag)
                    if record is not None and not record['draft']:
                        if stage == 'github-post-publish-lookup':
                            raise mirror.MirrorError(secret)
                        record['assets'][0]['id'] = 999
                    return record
                github.publish, github.get = publish, get
                stderr = io.StringIO()
                with patch.object(mirror, 'GitHub', return_value=github), patch.object(
                        mirror.sys, 'argv', ['mirror', 'publish-github', '--directory', str(self.root),
                                            '--commit', self.commit]), redirect_stderr(stderr):
                    self.assertEqual(mirror.main(), 1)
                self.assertEqual(stderr.getvalue(),
                                 f'Server release verification failed [{stage}]; no publication may be assumed\n')
                self.assertNotIn(secret, stderr.getvalue())

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

    def test_new_manifest_publishes_through_real_draft_lookup_adapter(self):
        github = MemoryGitHub()
        lookup = GitHubLookupTests()
        lookup.setUp()
        def command(args, **kwargs):
            lookup.record = MemoryGitHub.get(github, self.tag)
            return lookup.responses(args, **kwargs)
        github.get = mirror.GitHub().get
        with patch.object(mirror.subprocess, 'run', side_effect=command):
            mirror.publish_github(self.root, self.commit, github)
        self.assertFalse(github.record['draft'])
        self.assertEqual(github.events[-1], 'publish')

    def package_github(self, files=None, **changes):
        self.assertTrue(callable(getattr(mirror, 'publish_packages', None)), 'Component draft recovery is missing')
        for component in ('postgres', 'media-worker', 'ai-runtime', 'ai-models'):
            (self.root / self.manifest['packages'][component]['filename']).unlink(missing_ok=True)
        item = self.manifest['packages']['app']
        record = dict(id=7, tag_name=item['release_tag'], target_commitish=self.commit, draft=True)
        record.update(changes)
        return MemoryGitHub(record, files), item

    def test_component_complete_draft_is_published_without_reupload(self):
        github, item = self.package_github()
        github.files[item['filename']] = (self.root / item['filename']).read_bytes()
        mirror.publish_packages(self.root, self.commit, github)
        self.assertFalse(github.record['draft'])
        self.assertEqual(github.events, ['verify', 'publish'])

    def test_component_empty_draft_uploads_missing_archive_then_publishes(self):
        github, item = self.package_github()
        mirror.publish_packages(self.root, self.commit, github)
        self.assertFalse(github.record['draft'])
        self.assertEqual(github.events, ['verify', 'upload:' + item['filename'], 'publish'])
        self.assertEqual(github.files[item['filename']], (self.root / item['filename']).read_bytes())

    def test_component_creation_is_a_verified_draft_before_publication(self):
        github, item = self.package_github()
        github.record = None
        mirror.publish_packages(self.root, self.commit, github)
        self.assertEqual(github.record['target_commitish'], self.commit)
        self.assertFalse(github.record['draft'])
        self.assertEqual(github.events, ['verify', 'create-draft', 'upload:' + item['filename'], 'publish'])

    def test_component_collision_or_wrong_target_never_mutates_release(self):
        github, item = self.package_github()
        content = (self.root / item['filename']).read_bytes()
        for target, files in (('b' * 40, {}), (self.commit, {item['filename']: b'!' + content[1:]}),
                              (self.commit, {'unrelated.bin': b'extra'})):
            github.record['target_commitish'] = target
            github.files = files
            github.events = []
            with self.assertRaises(mirror.MirrorError):
                mirror.publish_packages(self.root, self.commit, github)
            self.assertEqual(github.events, ['verify'])
            self.assertTrue(github.record['draft'])

    def test_component_published_archive_is_immutable_and_incomplete_release_is_refused(self):
        github, item = self.package_github(draft=False)
        github.files[item['filename']] = (self.root / item['filename']).read_bytes()
        mirror.publish_packages(self.root, self.commit, github)
        self.assertEqual(github.events, ['verify'])
        github.files.clear()
        with self.assertRaises(mirror.MirrorError):
            mirror.publish_packages(self.root, self.commit, github)
        self.assertEqual(github.events, ['verify', 'verify'])

    def test_component_lost_upload_ack_retry_does_not_overwrite_archive(self):
        github, item = self.package_github()
        upload = github.upload
        def lost_ack(tag, path):
            upload(tag, path)
            raise mirror.MirrorError('Lost upload acknowledgement')
        github.upload = lost_ack
        with self.assertRaises(mirror.MirrorError):
            mirror.publish_packages(self.root, self.commit, github)
        self.assertTrue(github.record['draft'])
        github.upload = upload
        mirror.publish_packages(self.root, self.commit, github)
        self.assertFalse(github.record['draft'])
        self.assertEqual(github.events.count('upload:' + item['filename']), 1)

    def test_referenced_published_component_must_match_signed_build_commit(self):
        github = mirror.GitHub()
        target = self.commit
        def release(tag):
            item = next(x for x in self.manifest['packages'].values() if x['release_tag'] == tag)
            return dict(id=7, tag_name=tag, target_commitish=target, draft=False,
                        assets=[dict(name=item['filename'], size=item['size'], digest='sha256:' + item['sha256'])])
        with patch.object(github, 'get', side_effect=release):
            github.packages(self.manifest)
            target = 'b' * 40
            with self.assertRaises(mirror.MirrorError):
                github.packages(self.manifest)


class ReconcilePackageTests(unittest.TestCase):
    def setUp(self):
        self.root, self.manifest = fixtures.prepare(self)
        self.git = self.root / 'source'
        self.git.mkdir()
        self.git_run('init', '-q')
        self.git_run('config', 'user.name', 'Fixture')
        self.git_run('config', 'user.email', 'fixture@example.invalid')
        self.history = []
        for name in ('original A', 'different B', 'return to A'):
            self.git_run('commit', '--allow-empty', '-m', name)
            self.history.append(self.git_run('rev-parse', 'HEAD').strip())
        self.commit = self.history[-1]
        self.git_run('update-ref', 'refs/remotes/origin/master', self.commit)
        self.manifest['source_commit'] = self.commit
        for item in self.manifest['packages'].values():
            item['built_from_commit'] = self.commit
        for key in ('server', 'caddy'):
            self.manifest['images'][key]['ref'] = self.manifest['images'][key]['ref'].split(':sha-')[0] + ':sha-' + self.commit[:12]
        self.item = self.manifest['packages']['ai-models']
        for component, item in self.manifest['packages'].items():
            if component != 'ai-models':
                (self.root / item['filename']).unlink()
        self.path = self.root / self.item['filename']
        self.original = self.path.read_bytes()
        self.record = dict(id=7, tag_name=self.item['release_tag'], target_commitish=self.history[0], draft=False)
        self.github = MemoryGitHub(self.record, {self.path.name: self.original})
        self.save_manifest()

    def git_run(self, *args):
        return subprocess.run(['git', '-C', str(self.git), *args], check=True,
                              capture_output=True, text=True).stdout

    def save_manifest(self):
        (self.root / 'manifest.json').write_text(json.dumps(self.manifest), encoding='utf-8')

    def reconcile(self):
        self.assertTrue(callable(getattr(mirror, 'reconcile_packages', None)), 'Pre-attestation reconciliation is missing')
        mirror.reconcile_packages(self.root, self.commit, self.git, self.github)

    def sign(self):
        descriptor = mirror.delivery.generate(self.root, self.commit, self.git)
        (self.root / 'delivery.json').write_text(json.dumps(descriptor), encoding='utf-8')
        mirror.write_checksums(self.root)
        signed = {n: digest((self.root / n).read_bytes()) for n in ('manifest.json', 'xdrive-offline.py', 'delivery.json')}
        for name in mirror.BUNDLE_FILES:
            (self.root / name).write_text(json.dumps(signed), encoding='utf-8')

    def test_same_bytes_recent_or_historical_release_preserves_original_provenance(self):
        for original_commit in (self.history[1], self.history[0]):
            with self.subTest(original_commit=original_commit):
                self.github.record['target_commitish'] = original_commit
                self.save_manifest()
                self.reconcile()
                actual = json.loads((self.root / 'manifest.json').read_text(encoding='utf-8'))
                self.assertEqual(actual['packages']['ai-models']['built_from_commit'], original_commit)
                self.assertEqual(actual['fingerprints'], self.manifest['fingerprints'])
                self.assertEqual(actual['packages']['ai-models']['fingerprint'], self.item['fingerprint'])
                self.assertEqual(self.path.read_bytes(), self.original)
                self.assertEqual(self.github.events, [])
                self.sign()
                mirror.publish_packages(self.root, self.commit, self.github)
                self.assertEqual(self.github.events, ['verify'])
                self.github.events.clear()
                for name in mirror.BUNDLE_FILES:
                    (self.root / name).unlink()

    def test_conflicting_bytes_size_or_nonancestor_target_do_not_rewrite_manifest(self):
        self.git_run('checkout', '--detach', self.history[0])
        self.git_run('commit', '--allow-empty', '-m', 'divergent')
        divergent = self.git_run('rev-parse', 'HEAD').strip()
        self.git_run('checkout', '--detach', self.commit)
        before = (self.root / 'manifest.json').read_bytes()
        for target, content in ((self.history[0], b'!' + self.original[1:]),
                                (self.history[0], self.original + b'!'),
                                ('master', self.original), ('f' * 40, self.original),
                                (divergent, self.original)):
            with self.subTest(target=target, size=len(content)):
                self.github.record['target_commitish'] = target
                self.github.files[self.path.name] = content
                with self.assertRaises(mirror.MirrorError):
                    self.reconcile()
                self.assertEqual((self.root / 'manifest.json').read_bytes(), before)
                self.assertEqual(self.github.events, [])

    def test_current_draft_is_preserved_but_historical_draft_never_relabelled(self):
        self.github.record.update(draft=True, target_commitish=self.commit)
        self.github.files.clear()
        before = (self.root / 'manifest.json').read_bytes()
        self.reconcile()
        self.assertEqual((self.root / 'manifest.json').read_bytes(), before)
        self.github.record['target_commitish'] = self.history[0]
        with self.assertRaises(mirror.MirrorError):
            self.reconcile()
        self.assertEqual((self.root / 'manifest.json').read_bytes(), before)
        self.assertEqual(self.github.events, [])

    def test_reconciled_old_provenance_requires_still_published_matching_release(self):
        self.reconcile()
        self.sign()
        self.github.record['draft'] = True
        with self.assertRaises(mirror.MirrorError):
            mirror.publish_packages(self.root, self.commit, self.github)
        self.assertEqual(self.github.events, ['verify'])
        self.github.events.clear()
        self.github.record = None
        with self.assertRaises(mirror.MirrorError):
            mirror.publish_packages(self.root, self.commit, self.github)
        self.assertEqual(self.github.events, ['verify'])

    def test_signed_manifest_is_never_reconciled_or_tampered_after_attestation(self):
        self.sign()
        with self.assertRaises(mirror.MirrorError):
            self.reconcile()
        self.item['built_from_commit'] = self.history[0]
        self.save_manifest()
        # Even if an attacker refreshes the unsigned descriptor hash binding,
        # the original attestation cannot authorize this changed manifest.
        descriptor = mirror.delivery.generate(self.root, self.commit, self.git)
        (self.root / 'delivery.json').write_text(json.dumps(descriptor), encoding='utf-8')
        with self.assertRaises(mirror.MirrorError):
            mirror.publish_packages(self.root, self.commit, self.github)
        self.assertEqual(self.github.events, [])


if __name__ == '__main__':
    unittest.main()
