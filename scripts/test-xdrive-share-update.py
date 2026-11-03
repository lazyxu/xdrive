#!/usr/bin/env python3
"""Behavioral security tests for the Share transport; no external services."""
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.request import ProxyHandler, Request


PATH = Path(__file__).with_name('xdrive-share-update.py')
spec = importlib.util.spec_from_file_location('share_update', PATH)
provider = importlib.util.module_from_spec(spec) if PATH.exists() else None
if provider:
    spec.loader.exec_module(provider)


def digest(data):
    return hashlib.sha256(data).hexdigest()


# Public, test-only loopback certificate/key; never used as a production trust root.
TLS_CERT = '''-----BEGIN CERTIFICATE-----
MIIBVDCB+6ADAgECAgEBMAoGCCqGSM49BAMCMBUxEzARBgNVBAMMCnNoYXJlLnRl
c3QwIBcNMjAwMTAxMDAwMDAwWhgPMjEyMDAxMDEwMDAwMDBaMBUxEzARBgNVBAMM
CnNoYXJlLnRlc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATQIkoDST82DE7y
vEBlcjrzjuADze6FuRvRIaaZk4SwQAt9QS4XParrQhvpVsG92XNzVKpXFSRtep1L
sdqtnWRDozowODAPBgNVHRMBAf8EBTADAQH/MBUGA1UdEQQOMAyCCnNoYXJlLnRl
c3QwDgYDVR0PAQH/BAQDAgGGMAoGCCqGSM49BAMCA0gAMEUCIENqqR/VDh8lXeQN
uddyel8hgjCYP5VY3PM7ey0Pv9EpAiEA4vtPNWy+6KwUxFd2mH4IHHSswIMsELtU
q0NLu917gn0=
-----END CERTIFICATE-----
'''
TLS_KEY = '''-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgjfoUldckoqG2QHmF
6Xi4pckiKwa6g3Uygphq8yovKPyhRANCAATQIkoDST82DE7yvEBlcjrzjuADze6F
uRvRIaaZk4SwQAt9QS4XParrQhvpVsG92XNzVKpXFSRtep1LsdqtnWRD
-----END PRIVATE KEY-----
'''


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(provider, 'Share update provider must be implemented')
        self.tmp = tempfile.TemporaryDirectory(prefix='xdrive-share-provider-test-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def test_provider_is_implemented(self):
        self.assertTrue(callable(provider.read_config))

    def tls_share_server(self, *, redirect=False):
        certificate, key = self.root / 'test-cert.pem', self.root / 'test-key.pem'
        certificate.write_text(TLS_CERT)
        key.write_text(TLS_KEY)
        observed = {'sni': [], 'requests': []}
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                observed['requests'].append((self.path, self.headers['Host'],
                                             self.headers.get('X-XDrive-Share-Token')))
                body = b'{"type":"dir"}' if self.path == '/api/v1/public/share' else b'package'
                self.send_response(302 if redirect else 200)
                if redirect:
                    self.send_header('Location', 'https://other.test/redirected')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            def log_message(self, *args):
                pass
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certificate, key)
        context.set_servername_callback(lambda _socket, hostname, _context: observed['sni'].append(hostname))
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.addCleanup(server.server_close)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True)
        thread.start()
        def stop():
            server.shutdown()
            thread.join(timeout=5)
            self.assertFalse(thread.is_alive(), 'Loopback TLS server did not stop')
        self.addCleanup(stop)
        return server.server_port, observed

    def test_connect_address_routes_metadata_and_download_with_original_tls_identity(self):
        port, observed = self.tls_share_server()
        context = ssl.create_default_context()
        context.load_verify_locations(cadata=TLS_CERT)
        with patch.dict(os.environ, {'https_proxy': 'http://127.0.0.1:1', 'no_proxy': ''}, clear=True), \
             patch.object(provider.ssl, 'create_default_context', return_value=context), \
             patch.object(socket, 'create_connection', wraps=socket.create_connection) as connected:
            share = provider.Share(f'https://share.test:{port}/#/s/' + 'T' * 40,
                                   connect_address='127.0.0.1')
            self.assertEqual(share.request('GET', '/api/v1/public/share'), {'type': 'dir'})
            ticket = '/api/v1/public-share-download/9?ticket=test'
            with patch.object(share, 'request', return_value={'url': ticket}):
                share.download(9, self.root / 'download', 7)
        self.assertEqual((self.root / 'download').read_bytes(), b'package')
        self.assertEqual([call.args[0] for call in connected.call_args_list], [('127.0.0.1', port)] * 2)
        self.assertEqual(observed['sni'], ['share.test'] * 2)
        self.assertEqual(observed['requests'], [('/api/v1/public/share', f'share.test:{port}', 'T' * 40),
                                               (ticket, f'share.test:{port}', None)])
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)

    def test_connect_address_rejects_wrong_hostname_untrusted_certificate_and_redirect(self):
        port, observed = self.tls_share_server(redirect=True)
        trusted = ssl.create_default_context()
        trusted.load_verify_locations(cadata=TLS_CERT)
        for hostname, context, message in (('wrong.test', trusted, 'bounded retries'),
                                            ('share.test', ssl.create_default_context(), 'bounded retries'),
                                            ('share.test', trusted, 'redirect rejected')):
            with self.subTest(hostname=hostname, message=message), \
                 patch.object(provider.ssl, 'create_default_context', return_value=context), \
                 patch.object(provider.time, 'sleep'):
                share = provider.Share(f'https://{hostname}:{port}/#/s/' + 'T' * 40,
                                       connect_address='127.0.0.1')
                with self.assertRaisesRegex(provider.UpdateError, message):
                    share.request('GET', '/api/v1/public/share')
        self.assertEqual(len(observed['requests']), 1, 'Invalid TLS peers received HTTP credentials')
        self.assertEqual(observed['sni'], ['wrong.test'] * 3 + ['share.test'] * 4)

    def test_connect_address_is_literal_and_origin_bound_with_default_proxy_unchanged(self):
        url = 'https://share.test/#/s/' + 'T' * 40
        for address in ('', 'localhost', ' 127.0.0.1', '127.0.0.1:443', 'https://127.0.0.1',
                        '[::1]', 'fe80::1%lo', '127.1', True, 2130706433, {}):
            with self.subTest(address=address), self.assertRaises(provider.UpdateError):
                provider.Share(url, connect_address=address)
        provider.Share(url, connect_address='::1')
        with patch.dict(os.environ, {'https_proxy': 'http://proxy.test:8888'}, clear=True):
            ordinary = provider.Share(url)
            self.assertTrue(any(isinstance(handler, ProxyHandler) and handler.proxies.get('https') ==
                                'http://proxy.test:8888' for handler in ordinary.opener.handlers))
            pinned = provider.Share(url, connect_address='127.0.0.1')
            with patch.object(socket, 'create_connection', side_effect=AssertionError('Escaped pinned origin')):
                for target in ('https://other.test/', 'https://share.test:444/'):
                    with self.assertRaises(provider.UpdateError):
                        pinned.opener.open(Request(target), timeout=1)
                tunnel = Request('https://share.test/')
                tunnel.set_proxy('share.test:443', 'http')
                with self.assertRaises(provider.UpdateError):
                    pinned.opener.open(tunnel, timeout=1)

    def test_pagination_uses_password_and_rejects_repeated_cursor_and_duplicate_names(self):
        share = provider.Share('https://share.example/#/s/' + 'T' * 40, 'secret')
        calls = []
        pages = [dict(items=[dict(id=1, name='a', type='file', size=2)], next_cursor=1),
                 dict(items=[dict(id=2, name='b', type='dir', size=0)], next_cursor=0)]
        def request(method, path, body=None):
            calls.append((method, path, body))
            return pages.pop(0)
        with patch.object(share, 'request', side_effect=request):
            self.assertEqual(set(share.children(5)), {'a', 'b'})
        self.assertEqual(calls[1], ('POST', '/api/v1/public/share/children',
                                  dict(parent_id=5, cursor=1, password='secret')))
        for bad_pages in ([dict(items=[], next_cursor=1)] * 3,
                          [dict(items=[dict(id=1, name='a', type='file', size=2)], next_cursor=1),
                           dict(items=[dict(id=2, name='a', type='file', size=2)], next_cursor=0)]):
            with self.subTest(bad_pages=bad_pages), patch.object(share, 'request', side_effect=bad_pages):
                with self.assertRaises(provider.UpdateError):
                    share.children(0)

    def test_download_ticket_must_be_relative_same_origin_and_secrets_stay_in_body(self):
        share = provider.Share('https://share.example/#/s/' + 'T' * 40, 'password')
        for url in ('https://other.example/file', '//other.example/file',
                    '/api/v1/public-share-download/1?ticket=abc&redirect=bad', '/private?ticket=abc'):
            with self.subTest(url=url), patch.object(share, 'request', return_value={'url': url}):
                with self.assertRaises(provider.UpdateError):
                    share.download(1, self.root / 'output', 10)
        response = io.BytesIO(b'hello')
        response.status = 200
        response.headers = {'Content-Length': '5'}
        with patch.object(share, 'request', return_value={'url': '/api/v1/public-share-download/9?ticket=abc'}) as ticket, \
             patch.object(share.opener, 'open', return_value=response) as opened:
            share.download(7, self.root / 'good', 5)
        self.assertEqual((self.root / 'good').read_bytes(), b'hello')
        self.assertEqual(ticket.call_args.args[2], {'node_id': 7, 'password': 'password'})
        self.assertNotIn('X-xdrive-share-token', dict(opened.call_args.args[0].header_items()))

    def test_redirects_are_rejected_instead_of_forwarding_capability(self):
        with self.assertRaises(provider.UpdateError):
            provider.RejectRedirects().redirect_request(None, None, 302, '', {}, 'https://evil.example')

    def test_same_size_modified_cache_and_truncated_download_are_rejected(self):
        destination = self.root / 'artifact'
        destination.write_bytes(b'evil')
        class Source:
            def download(self, node, path, limit):
                path.write_bytes(b'bad')
        with self.assertRaises(provider.UpdateError):
            provider.download_verified_file(Source(), 1, destination, 4, digest(b'good'))
        self.assertFalse(destination.exists())
        self.assertEqual(list(self.root.iterdir()), [])

    def test_verified_cache_is_rehashed_and_reused_without_network(self):
        path = self.root / 'artifact'
        path.write_bytes(b'good')
        class NeverNetwork:
            def download(self, *args):
                raise AssertionError('verified bytes should be reused')
        self.assertEqual(provider.download_verified_file(NeverNetwork(), 1, path, 4, digest(b'good')), path)

    def test_publisher_checks_verified_numeric_repository_identity_and_pinned_inputs(self):
        artifact = self.root / 'delivery.json'
        bundle = self.root / 'bundle'
        verifier = self.root / 'gh'
        trust = self.root / 'root.jsonl'
        for path in (artifact, bundle, verifier, trust):
            path.write_bytes(b'test')
            path.chmod(0o700 if path == verifier else 0o600)
        arguments = dict(verifier_path=verifier, verifier_sha256=digest(b'test'),
                         trust_root_sha256=digest(b'test'))
        good = [{'verificationResult': {'signature': {'certificate': {'sourceRepositoryIdentifier': '1382670236'}}}}]
        with patch.object(provider.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, json.dumps(good), '')) as run:
            provider.verify_publisher(artifact, bundle, trust, **arguments)
        command = run.call_args.args[0]
        self.assertIn('--custom-trusted-root', command)
        self.assertIn('--bundle', command)
        self.assertIn('--deny-self-hosted-runners', command)
        self.assertIn('lazyxu/xdrive/.github/workflows/offline-packages.yml', command)
        self.assertEqual(command[command.index('--source-ref') + 1], 'refs/heads/master')
        self.assertEqual(command[command.index('--repo') + 1], 'lazyxu/xdrive')
        self.assertEqual(run.call_args.kwargs['env']['TMPDIR'], str(self.root))
        with patch.object(provider.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, json.dumps(good), '')):
            with self.assertRaises(provider.UpdateError):
                provider.verify_publisher(artifact, bundle, trust, **arguments)
        for value in ([], [{'verificationResult': {}}],
                      [{'verificationResult': {'signature': {'certificate': {'sourceRepositoryIdentifier': '999'}}}}],
                      good + [{'verificationResult': {'signature': {'certificate': {'sourceRepositoryIdentifier': '999'}}}}]):
            with patch.object(provider.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, json.dumps(value), '')):
                with self.assertRaises(provider.UpdateError):
                    provider.verify_publisher(artifact, bundle, trust, **arguments)
        trust.write_bytes(b'changed')
        with patch.object(provider.subprocess, 'run', side_effect=AssertionError('untrusted root executed verifier')):
            with self.assertRaises(provider.UpdateError):
                provider.verify_publisher(artifact, bundle, trust, **arguments)

    def test_replay_and_same_sequence_conflict_fail_but_exact_retry_succeeds(self):
        old = dict(sequence=10, source_commit='a' * 40, descriptor_sha256='b' * 64)
        provider.check_floor(old, old)
        for candidate in (dict(old, sequence=9), dict(old, source_commit='c' * 40),
                          dict(old, descriptor_sha256='d' * 64)):
            with self.assertRaises(provider.UpdateError):
                provider.check_floor(candidate, old)
        provider.check_floor(dict(old, sequence=11), old)
        with self.assertRaises(provider.UpdateError):
            provider.check_floor(old, {'sequence': 10})

    def test_descriptor_rejects_duplicate_keys_paths_and_boolean_sequences(self):
        with self.assertRaises(provider.UpdateError):
            provider.decode_json(b'{"sequence":1,"sequence":2}')
        descriptor = self.descriptor()
        provider.validate_descriptor(descriptor)
        for replacement in (dict(descriptor, sequence=True), dict(descriptor, repository_id=1),
                            dict(descriptor, installer=dict(descriptor['installer'], name='../tool.py'))):
            with self.assertRaises(provider.UpdateError):
                provider.validate_descriptor(replacement)

    def descriptor(self):
        return dict(schema=1, repository_id=1382670236, channel='master', platform='linux/amd64',
                    source_commit='a' * 40, sequence=12,
                    manifest=dict(name='manifest.json', size=2, sha256=digest(b'{}')),
                    installer=dict(name='xdrive-offline.py', size=4, sha256=digest(b'tool')))

    def test_private_config_requires_pinned_verifier_trust_and_https_capability(self):
        verifier = self.root / 'gh'
        trust = self.root / 'trust'
        verifier.write_bytes(b'gh')
        trust.write_bytes(b'root')
        verifier.chmod(0o700)
        trust.chmod(0o600)
        value = dict(schema=1, share_url='https://example.test/#/s/' + 'x' * 40,
                     verifier_path=str(verifier), verifier_sha256=digest(b'gh'),
                     trust_root_path=str(trust), trust_root_sha256=digest(b'root'), initial_sequence=2)
        config = self.root / 'config.json'
        config.write_text(json.dumps(value))
        config.chmod(0o600)
        self.assertEqual(provider.read_config(config)['initial_sequence'], 2)
        config.write_text(json.dumps(dict(value, connect_address='127.0.0.1')))
        self.assertEqual(provider.read_config(config)['connect_address'], '127.0.0.1')
        config.write_text(json.dumps(dict(value, connect_address='localhost')))
        with self.assertRaises(provider.UpdateError):
            provider.read_config(config)
        for url in ('http://example.test/#/s/' + 'x' * 40, 'https://user:secret@example.test/#/s/' + 'x' * 40):
            config.write_text(json.dumps(dict(value, share_url=url)))
            with self.assertRaises(provider.UpdateError):
                provider.read_config(config)
        config.write_text(json.dumps(value))
        if os.name != 'nt':
            config.chmod(0o644)
            with self.assertRaises(provider.UpdateError):
                provider.read_config(config)

    def fixture_share(self):
        payloads = {name: ('package-' + name).encode() for name in provider.COMPONENTS}
        packages = {name: dict(filename='xdrive-' + name + '-' + digest(data)[:12] + '.tar.gz',
                               sha256=digest(data), size=len(data), members={'payload': {'size': len(data)}})
                    for name, data in payloads.items()}
        manifest = dict(schema=2, platform='linux/amd64', channel='master', source='github',
                        source_commit='a' * 40, packages=packages)
        raw_manifest = json.dumps(manifest).encode()
        raw_tool = b'raise RuntimeError("downloaded tool was executed")\n'
        descriptor = self.descriptor()
        descriptor['manifest'] = dict(name='manifest.json', size=len(raw_manifest), sha256=digest(raw_manifest))
        descriptor['installer'] = dict(name='xdrive-offline.py', size=len(raw_tool), sha256=digest(raw_tool))
        raw_descriptor = json.dumps(descriptor).encode()
        contents = {10: raw_descriptor, 11: b'bundle', 12: raw_manifest, 13: raw_tool}
        def entry(i, name, kind='dir'):
            return dict(id=i, name=name, type=kind, size=len(contents[i]) if kind == 'file' else 0)
        releases = {str(12) + '-' + 'a' * 40: entry(4, str(12) + '-' + 'a' * 40),
                    str(13) + '-' + 'c' * 40: entry(5, str(13) + '-' + 'c' * 40)}
        directories = {0: {'xDrive-Server': entry(1, 'xDrive-Server')},
                       1: {'master': entry(2, 'master'), 'packages': entry(3, 'packages')},
                       2: releases, 3: {}, 4: {n: entry(i, n, 'file') for i, n in
                       [(10, 'delivery.json'), (11, 'delivery-attestation.jsonl'),
                        (12, 'manifest.json'), (13, 'xdrive-offline.py')]},
                       5: {'manifest.json': entry(12, 'manifest.json', 'file')}}
        for index, (name, item) in enumerate(packages.items(), 20):
            file_id = index + 100
            contents[file_id] = payloads[name]
            directories[3][item['sha256']] = entry(index, item['sha256'])
            directories[index] = {item['filename']: entry(file_id, item['filename'], 'file')}
        class MemoryShare:
            def __init__(self, *args):
                self.downloads = []
            def request(self, method, path, body=None):
                return {'type': 'dir'}
            def children(self, parent):
                return directories[parent]
            def download(self, node_id, destination, limit):
                data = contents[node_id]
                if len(data) > limit:
                    raise provider.UpdateError('oversize')
                destination.write_bytes(data)
                self.downloads.append(node_id)
        return MemoryShare(), contents, manifest

    def pipeline_config(self):
        return dict(initial_sequence=1, share_url='https://example.test/#/s/' + 'x' * 40,
                    verifier_path='/unused/gh', verifier_sha256='a' * 64,
                    trust_root_path='/unused/root', trust_root_sha256='b' * 64)

    def test_incomplete_newest_release_is_not_selected_and_prefetch_never_executes_tool(self):
        self.assertTrue(callable(getattr(provider, 'update', None)), 'Prefetch pipeline is missing')
        share, contents, _ = self.fixture_share()
        home = self.root / 'home'
        home.mkdir(mode=0o700)
        with patch.object(provider, 'verify_publisher', return_value=[{}]), \
             patch.object(provider, 'run_offline_install', side_effect=AssertionError('prefetch executed installer')):
            result = provider.update(self.pipeline_config(), home, prefetch_only=True, share=share)
        self.assertEqual(result['sequence'], 12)
        self.assertEqual(set(share.downloads), set(contents))
        high_water = json.loads((home / 'state/xdrive-share-update/high-water.json').read_text())
        self.assertEqual(high_water['source_commit'], 'a' * 40)
        self.assertEqual(high_water['descriptor_sha256'], digest(contents[10]))

    def test_update_passes_trusted_connect_address_to_share(self):
        share, _, _ = self.fixture_share()
        home = self.root / 'home'
        home.mkdir(mode=0o700)
        config = dict(self.pipeline_config(), connect_address='127.0.0.1', share_password='secret')
        with patch.object(provider, 'Share', return_value=share) as factory, \
             patch.object(provider, 'verify_publisher', return_value=[{}]), \
             patch.object(provider, 'run_offline_install', side_effect=AssertionError('prefetch executed installer')):
            provider.update(config, home, prefetch_only=True)
        factory.assert_called_once_with(config['share_url'], 'secret', connect_address='127.0.0.1')

    def test_corrupt_final_package_prevents_any_installer_execution(self):
        self.assertTrue(callable(getattr(provider, 'update', None)), 'Install pipeline is missing')
        share, contents, _ = self.fixture_share()
        last = max(contents)
        contents[last] = b'X' * len(contents[last])
        home = self.root / 'home'
        home.mkdir(mode=0o700)
        with patch.object(provider, 'verify_publisher', return_value=[{}]), \
             patch.object(provider, 'run_offline_install', side_effect=AssertionError('corruption reached installer')):
            with self.assertRaises(provider.UpdateError):
                provider.update(self.pipeline_config(), home, share=share)

    def test_bad_signature_rejects_before_manifest_tool_or_packages_are_downloaded(self):
        self.assertTrue(callable(getattr(provider, 'update', None)), 'Publisher pipeline is missing')
        share, contents, _ = self.fixture_share()
        home = self.root / 'home'
        home.mkdir(mode=0o700)
        with patch.object(provider, 'verify_publisher', side_effect=provider.UpdateError('signature rejected')):
            with self.assertRaises(provider.UpdateError):
                provider.update(self.pipeline_config(), home, share=share)
        self.assertEqual(set(share.downloads), {10, 11})

    def test_run_offline_install_passes_only_verified_local_bundle_and_preserves_profiles(self):
        self.assertTrue(callable(getattr(provider, 'run_offline_install', None)), 'Offline adapter is missing')
        directory = self.root / 'bundle'
        directory.mkdir(mode=0o700)
        tool = directory / 'xdrive-offline.py'
        tool.write_bytes(b'pass')
        release = dict(directory=directory, descriptor=dict(installer={'sha256': digest(b'pass')},
                       manifest={'sha256': 'b' * 64}))
        with patch.object(provider.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as run:
            provider.run_offline_install(release, self.root, self.root, backup_file_data=True)
        command = run.call_args.args[0]
        self.assertIn('--update-source', command)
        self.assertIn('xdrive', command)
        self.assertIn('--backup-file-data', command)
        self.assertNotIn('--enable-ai', command)
        self.assertNotIn('--enable-media', command)
        self.assertEqual(run.call_args.kwargs['env']['XD_OFFLINE_NO_PULL'], '1')

    def test_symlink_parent_is_rejected_before_writing_or_reading_cache(self):
        target = self.root / 'target'
        target.mkdir()
        alias = self.root / 'alias'
        try:
            alias.symlink_to(target, target_is_directory=True)
        except OSError:
            self.skipTest('Creating symbolic links is unavailable on this runner')
        with self.assertRaises(provider.UpdateError):
            provider.download_verified_file(None, 1, alias / 'file', 1, digest(b'a'))

    def test_concurrent_provider_is_rejected_and_lock_is_released_on_failure(self):
        with provider.update_lock(self.root):
            with self.assertRaises(provider.UpdateError):
                with provider.update_lock(self.root):
                    self.fail('Concurrent update entered the critical section')
        with provider.update_lock(self.root):
            pass

    def test_failed_install_does_not_mark_success_and_exact_retry_uses_verified_cache(self):
        share, contents, _ = self.fixture_share()
        home = self.root / 'home'
        home.mkdir(mode=0o700)
        state = home / 'state/xdrive-share-update'
        with patch.object(provider, 'verify_publisher', return_value=[{}]), \
             patch.object(provider, 'run_offline_install', side_effect=provider.UpdateError('installer failed')):
            with self.assertRaises(provider.UpdateError):
                provider.update(self.pipeline_config(), home, share=share)
        self.assertFalse((state / 'installed.json').exists())
        self.assertEqual(list((state / 'work').iterdir()), [])
        share.downloads.clear()
        def installed(release, actual_home, workdir, **options):
            self.assertEqual(actual_home, home)
            for item in release['manifest']['packages'].values():
                path = release['directory'] / item['filename']
                self.assertEqual(digest(path.read_bytes()), item['sha256'])
            self.assertTrue(workdir.is_dir())
        with patch.object(provider, 'verify_publisher', return_value=[{}]), \
             patch.object(provider, 'run_offline_install', side_effect=installed):
            provider.update(self.pipeline_config(), home, share=share)
        self.assertEqual(share.downloads, [10, 11])
        self.assertEqual(json.loads((state / 'installed.json').read_text())['sequence'], 12)

    def test_local_high_water_and_initial_floor_cannot_be_lowered_by_share(self):
        share, _, _ = self.fixture_share()
        home = self.root / 'home'
        home.mkdir(mode=0o700)
        with patch.object(provider, 'verify_publisher', return_value=[{}]), \
             patch.object(provider, 'run_offline_install', side_effect=AssertionError('rollback executed')):
            with self.assertRaises(provider.UpdateError):
                provider.update(dict(self.pipeline_config(), initial_sequence=14), home, share=share)
        self.assertEqual(share.downloads, [])

    def test_download_failure_and_oversize_do_not_leave_partial_file(self):
        share = provider.Share('https://share.example/#/s/' + 'T' * 40)
        response = io.BytesIO(b'123456')
        response.status = 200
        response.headers = {}
        path = self.root / 'oversize'
        with patch.object(share, 'request', return_value={'url': '/api/v1/public-share-download/9?ticket=abc'}), \
             patch.object(share.opener, 'open', return_value=response):
            with self.assertRaises(provider.UpdateError):
                share.download(1, path, 5)
        self.assertFalse(path.exists())

    def test_low_disk_space_stops_before_download(self):
        class Network:
            def download(self, *args):
                raise AssertionError('Disk exhaustion reached network')
        from collections import namedtuple
        Usage = namedtuple('Usage', 'total used free')
        with patch.object(provider.shutil, 'disk_usage', return_value=Usage(1000, 999, 1)):
            with self.assertRaises(provider.UpdateError):
                provider.download_verified_file(Network(), 1, self.root / 'file', 10, 'a' * 64)

    def test_cli_sanitizes_untrusted_io_exception_instead_of_printing_share_capability(self):
        secret = 'https://share.example/#/s/' + 'X' * 40
        with patch.object(provider.sys, 'argv', ['share-update', '--config', 'config', '--home', 'home']), \
             patch.object(provider, 'read_config', side_effect=OSError(secret)), \
             patch.object(provider.sys, 'stderr', new_callable=io.StringIO) as errors:
            self.assertEqual(provider.main(), 1)
        self.assertNotIn(secret, errors.getvalue())


if __name__ == '__main__':
    unittest.main()
