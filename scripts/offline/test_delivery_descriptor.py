"""Delivery descriptor tests using real Git ancestry and package metadata."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

fixture = load('offline_fixture', HERE / 'test_offline.py')
PATH = HERE / 'delivery_descriptor.py'
delivery = load('delivery', PATH) if PATH.exists() else None


def prepare(test):
    test.fixture = fixture.OfflinePackageTests()
    test.fixture.setUp()
    test.addCleanup(test.fixture.doCleanups)
    root = test.fixture.out
    manifest = test.fixture.manifest
    manifest['schema'] = 2
    manifest['fingerprints'] = {c: 'f' * 64 for c in fixture.offline.COMPONENTS}
    manifest['contracts'] = dict(postgres_major=17, media_worker_api=1, photo_intelligence_api=1, model_runtime_api=1)
    for c, item in manifest['packages'].items():
        item.update(built_from_commit=manifest['source_commit'], fingerprint='f' * 64,
                    release_tag=f"offline-{c}-{item['sha256'][:12]}")
    (root / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
    (root / 'xdrive-offline.py').write_bytes(b'installer\n')
    return root, manifest


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(delivery, 'Delivery descriptor generator must be implemented')
        self.root, self.manifest = prepare(self)
        self.git = self.root / 'git'
        self.git.mkdir()
        self.run_git('init', '-q')
        self.run_git('config', 'user.name', 'Fixture')
        self.run_git('config', 'user.email', 'fixture@example.invalid')
        self.run_git('commit', '--allow-empty', '-m', 'one')
        self.first = self.run_git('rev-parse', 'HEAD').strip()
        self.run_git('commit', '--allow-empty', '-m', 'two')
        self.commit = self.run_git('rev-parse', 'HEAD').strip()
        self.run_git('update-ref', 'refs/remotes/origin/master', self.commit)
        self.manifest['source_commit'] = self.commit
        (self.root / 'manifest.json').write_text(json.dumps(self.manifest), encoding='utf-8')

    def run_git(self, *args):
        return subprocess.run(['git', '-C', str(self.git), *args], check=True,
                              capture_output=True, text=True).stdout

    def test_sequence_counts_target_first_parent_not_current_head_and_binds_bytes(self):
        self.run_git('commit', '--allow-empty', '-m', 'later')
        result = delivery.generate(self.root, self.commit, self.git)
        self.assertEqual(result['sequence'], 2)
        self.assertEqual(result['repository_id'], 1382670236)
        self.assertEqual(result['source_commit'], self.commit)
        self.assertEqual(result['manifest']['sha256'], fixture.sha(self.root / 'manifest.json'))
        self.assertEqual(result['installer']['size'], 10)
        self.assertEqual(result['installer']['name'], 'xdrive-offline.py')

    def test_non_master_first_parent_commit_is_rejected(self):
        self.run_git('checkout', '-b', 'side', self.first)
        self.run_git('commit', '--allow-empty', '-m', 'side')
        side = self.run_git('rev-parse', 'HEAD').strip()
        self.run_git('checkout', '--detach', self.commit)
        self.run_git('merge', '--no-ff', 'side', '-m', 'merge')
        self.run_git('update-ref', 'refs/remotes/origin/master', 'HEAD')
        self.manifest['source_commit'] = side
        (self.root / 'manifest.json').write_text(json.dumps(self.manifest), encoding='utf-8')
        with self.assertRaises(ValueError):
            delivery.generate(self.root, side, self.git)

    def test_source_mismatch_or_untrusted_provenance_rejected(self):
        with self.assertRaises(ValueError):
            delivery.generate(self.root, self.first, self.git)
        self.manifest['source'] = 'gitlab'
        (self.root / 'manifest.json').write_text(json.dumps(self.manifest), encoding='utf-8')
        with self.assertRaises(ValueError):
            delivery.generate(self.root, self.commit, self.git)


if __name__ == '__main__':
    unittest.main()
