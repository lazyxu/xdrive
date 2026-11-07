#!/usr/bin/env python3
"""Mirror exact authenticated GitHub offline releases to a private upload Share.

GitHub publication precedes this opt-in transport. No Owner credential is used;
remote bytes, including prior uploads, must match before delivery.json appears.
"""
from __future__ import annotations
import argparse
from contextlib import contextmanager
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


HERE = Path(__file__).resolve().parent
offline = load('server_mirror_offline', HERE.parent / 'offline/xdrive_offline.py')
delivery = load('server_mirror_delivery', HERE.parent / 'offline/delivery_descriptor.py')
class MirrorError(Exception):
    pass


def sha256_file(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()
REPOSITORY = 'lazyxu/xdrive'
METADATA_LIMIT = 16 * 1024 * 1024
PACKAGE_LIMIT = 8 * 1024**3

# Only fixed GitHub package stages are emitted on publishing errors.
# Never expose raw GitHub API responses, credentials, or remote URLs.
PUBLISH_PHASES = frozenset({'github-manifest'} |
    {f'github-package-{component}' for component in offline.COMPONENTS})


class MirrorPhaseError(MirrorError):
    def __init__(self, phase):
        if phase not in PUBLISH_PHASES:
            raise ValueError('Unknown GitHub package stage')
        super().__init__('GitHub offline source stage failed')
        self.phase = phase


@contextmanager
def mirror_phase(phase):
    if phase not in PUBLISH_PHASES:
        raise ValueError('Unknown GitHub package stage')
    print('[offline-release] verifying ' + phase, flush=True)
    try:
        yield
    except (MirrorError, OSError, ValueError, KeyError, TypeError) as error:
        if isinstance(error, MirrorPhaseError):
            raise
        raise MirrorPhaseError(phase) from error


def check_file(path, size, digest):
    if (type(size) is not int or not 0 < size <= PACKAGE_LIMIT or
            not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest) or
            path.is_symlink() or not path.is_file() or path.stat().st_size != size or
            sha256_file(path) != digest):
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
    with mirror_phase('github-manifest'):
        manifest = manifest_at(directory)
    for component in offline.COMPONENTS:
        with mirror_phase('github-package-' + component):
            item = manifest['packages'][component]
            path = directory / item['filename']
            if not path.exists() and not path.is_symlink():
                # Download only the exact signed component; never use a floating tag.
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


def validate_delivery(directory, manifest):
    descriptor = read_json(directory / 'delivery.json')
    expected = {'schema', 'repository_id', 'channel', 'platform',
                'source_commit', 'sequence', 'manifest', 'installer'}
    if isinstance(descriptor, dict) and 'go_installer' in descriptor:
        expected.add('go_installer')
    if (not isinstance(descriptor, dict) or set(descriptor) != expected or
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
    if 'go_installer' in descriptor:
        item = descriptor['go_installer']
        if (not isinstance(item, dict) or set(item) != {'name', 'size', 'sha256'} or
                item['name'] != 'xdrive-offline-linux-amd64'):
            raise MirrorError('Invalid signed Go installer binding')
        check_file(directory / item['name'], item['size'], item['sha256'])
    elif (directory / 'xdrive-offline-linux-amd64').exists():
        raise MirrorError('Unsigned Go installer must not be published')
    bundle = directory / 'delivery-attestation.jsonl'
    if bundle.is_symlink() or not bundle.is_file() or not 0 < bundle.stat().st_size <= METADATA_LIMIT:
        raise MirrorError('Missing delivery attestation')
    return descriptor


# Previously published schema-1 releases are immutable and have exactly seven
# assets. New releases can additionally carry one signed Go ELF; no unrelated
# asset names are accepted in either form.
RELEASE_FILES = ('manifest.json', 'xdrive-offline.py', 'delivery.json',
                 'delivery-attestation.jsonl', 'xdrive-offline-attestation.json',
                 'SHA256SUMS.txt', 'MANIFEST_SHA256.txt')
GO_INSTALLER_ASSET = 'xdrive-offline-linux-amd64'
# Place Go before signed delivery metadata so interrupted draft publication can
# always reconstruct a descriptor from the already-uploaded immutable ELF.
RELEASE_FILES_GO = RELEASE_FILES[:2] + (GO_INSTALLER_ASSET,) + RELEASE_FILES[2:]
BUNDLE_FILES = ('delivery-attestation.jsonl', 'xdrive-offline-attestation.json')


def local_release_files(directory):
    descriptor = read_json(directory / 'delivery.json')
    return RELEASE_FILES_GO if 'go_installer' in descriptor else RELEASE_FILES


def installer_source(repository):
    return repository / 'scripts/offline/xdrive_offline.py'


def previous_manifest(releases):
    published = [r for r in releases if r.get('draft') is False and
                 re.fullmatch(r'offline-manifest-[a-f0-9]{12}', r.get('tag_name', ''))]
    return max(published, key=lambda r: r['created_at'])['tag_name'] if published else ''


def write_checksums(directory):
    manifest = manifest_at(directory)
    lines = [sha256_file(directory / 'manifest.json') + '  manifest.json']
    # Declare all five package identities so metadata is deterministic on retries,
    # regardless of which archives the runner needed to build or fetch locally.
    lines.extend(manifest['packages'][c]['sha256'] + '  ' + manifest['packages'][c]['filename']
                 for c in offline.COMPONENTS)
    lines.append(sha256_file(directory / 'xdrive-offline.py') + '  xdrive-offline.py')
    go_binary = directory / GO_INSTALLER_ASSET
    if go_binary.exists() or go_binary.is_symlink():
        if go_binary.is_symlink() or not go_binary.is_file():
            raise MirrorError('Invalid Go ELF asset')
        lines.append(sha256_file(go_binary) + '  ' + GO_INSTALLER_ASSET)
    (directory / 'SHA256SUMS.txt').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    (directory / 'MANIFEST_SHA256.txt').write_text(lines[0].split()[0] + '\n', encoding='ascii')


class GitHub:
    def run(self, *args):
        result = subprocess.run(['gh', *args], stdin=subprocess.DEVNULL,
                                capture_output=True, text=True, check=False)
        if result.returncode:
            raise MirrorError('GitHub release operation failed')
        return result.stdout

    def get(self, tag):
        def read(*args):
            output = self.run(*args)
            if len(output) > METADATA_LIMIT:
                raise MirrorError('Excessive GitHub release metadata')
            try:
                value = json.loads(output)
            except ValueError as error:
                raise MirrorError('Malformed GitHub release metadata') from error
            if not isinstance(value, dict) or value.get('errors'):
                raise MirrorError('Cannot determine GitHub release state')
            return value

        # REST /releases/tags/{tag} only sees published releases. Like gh's
        # FetchRelease, resolve pending draft tags with GraphQL, then fetch the
        # exact numeric REST identity. Never interpret a failed request as absent.
        query = ('query($tag:String!) { repository(owner:"lazyxu",name:"xdrive") '
                 '{ databaseId release(tagName:$tag) { databaseId tagName isDraft } } }')
        result = read('api', 'graphql', '-f', 'query=' + query, '-f', 'tag=' + tag)
        data = result.get('data')
        repository = data.get('repository') if isinstance(data, dict) else None
        if (not isinstance(repository, dict) or type(repository.get('databaseId')) is not int or
                repository['databaseId'] != 1382670236 or 'release' not in repository):
            raise MirrorError('GitHub repository identity unavailable')
        release = repository['release']
        if release is None:
            return None
        if (not isinstance(release, dict) or type(release.get('databaseId')) is not int or
                release['databaseId'] <= 0 or release.get('tagName') != tag or
                type(release.get('isDraft')) is not bool):
            raise MirrorError('Invalid GitHub release identity')
        record = read('api', f"repos/{REPOSITORY}/releases/{release['databaseId']}")
        if (record.get('id') != release['databaseId'] or record.get('tag_name') != tag or
                record.get('draft') is not release['isDraft']):
            raise MirrorError('GitHub release identity changed during lookup')
        return record

    def download(self, tag, name, directory):
        self.run('release', 'download', tag, '--repo', REPOSITORY,
                 '--pattern', name, '--dir', str(directory))

    def verify(self, directory, bundle):
        names = ('manifest.json', 'xdrive-offline.py', 'delivery.json')
        if (directory / GO_INSTALLER_ASSET).exists():
            names += (GO_INSTALLER_ASSET,)
        for name in names:
            result = json.loads(self.run('attestation', 'verify', str(directory / name),
                '--repo', REPOSITORY, '--bundle', str(bundle), '--signer-workflow',
                REPOSITORY + '/.github/workflows/offline-packages.yml',
                '--source-ref', 'refs/heads/master', '--deny-self-hosted-runners', '--format', 'json'))
            if not isinstance(result, list) or not result:
                raise MirrorError('Missing verified publisher identity')
            for item in result:
                identity = item['verificationResult']['signature']['certificate']['sourceRepositoryIdentifier']
                if type(identity) not in (str, int) or str(identity) != '1382670236':
                    raise MirrorError('GitHub publisher repository identity mismatch')

    def packages(self, manifest):
        for item in manifest['packages'].values():
            release = self.get(item['release_tag'])
            if not isinstance(release, dict) or release.get('draft') is not False:
                raise MirrorError('Referenced package is not published')
            package_asset(release, item)

    def create(self, tag, commit, notes=''):
        title = ('xDrive offline Manifest ' + commit[:12] if tag.startswith('offline-manifest-')
                 else 'xDrive ' + tag)
        self.run('release', 'create', tag, '--repo', REPOSITORY, '--target', commit,
                 '--draft', '--prerelease', '--title', title,
                 '--notes', notes)

    def upload(self, tag, path):
        self.run('release', 'upload', tag, str(path), '--repo', REPOSITORY)

    def publish(self, tag):
        self.run('release', 'edit', tag, '--repo', REPOSITORY, '--draft=false')


def package_asset(record, item):
    if (not isinstance(record, dict) or record.get('tag_name') != item['release_tag'] or
            record.get('target_commitish') != item['built_from_commit'] or
            type(record.get('id')) is not int or record['id'] <= 0 or
            type(record.get('draft')) is not bool or not isinstance(record.get('assets'), list)):
        raise MirrorError('Package release target differs from its exact build commit')
    assets = record['assets']
    if not assets and record['draft']:
        return None
    if len(assets) != 1 or not isinstance(assets[0], dict):
        raise MirrorError('Unexpected or missing immutable package asset')
    asset = assets[0]
    if (asset.get('name') != item['filename'] or type(asset.get('size')) is not int or
            asset['size'] != item['size'] or asset.get('digest') != 'sha256:' + item['sha256']):
        raise MirrorError('Immutable package release collision; never overwrite')
    return asset


def reconcile_packages(directory, commit, repository, github):
    manifest = manifest_at(directory)
    if manifest['source_commit'] != commit or not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise MirrorError('Wrong source manifest for package reconciliation')
    if any((directory / name).exists() or (directory / name).is_symlink() for name in BUNDLE_FILES):
        raise MirrorError('Package identities must be reconciled before attestation')
    changed = False
    for item in manifest['packages'].values():
        path = directory / item['filename']
        if not path.exists() and not path.is_symlink():
            continue
        check_file(path, item['size'], item['sha256'])
        record = github.get(item['release_tag'])
        if record is None or not isinstance(record, dict) or record.get('draft') is not False:
            # Only the exact source run may recover a draft. An old draft is
            # not published provenance and must be retried at its own source.
            if item['built_from_commit'] != commit:
                raise MirrorError('Old package provenance requires an already published release')
            if record is not None:
                package_asset(record, item)
            continue
        original = record.get('target_commitish')
        if not isinstance(original, str) or not re.fullmatch(r'[a-f0-9]{40}', original):
            raise MirrorError('Published package must name its original full build commit')
        package_asset(record, dict(item, built_from_commit=original))
        kind = subprocess.run(['git', '-C', str(repository), 'cat-file', '-t', original],
                              stdin=subprocess.DEVNULL, capture_output=True, text=True, check=False)
        ancestor = subprocess.run(['git', '-C', str(repository), 'merge-base', '--is-ancestor', original, commit],
                                  stdin=subprocess.DEVNULL, capture_output=True, check=False)
        if kind.returncode or kind.stdout.strip() != 'commit' or ancestor.returncode:
            raise MirrorError('Published package build is not a verified source ancestor')
        if item['built_from_commit'] not in (commit, original):
            raise MirrorError('Local package provenance conflicts with the immutable release')
        if item['built_from_commit'] != original:
            item['built_from_commit'] = original
            changed = True
    if changed:
        # Validate the complete reconciled metadata before one atomic promotion.
        # Fingerprints describe current build inputs; only original provenance
        # comes from the existing content-addressed release (including A→B→A).
        with tempfile.TemporaryDirectory(prefix='package-reconcile-', dir=directory) as temporary:
            stage = Path(temporary)
            target = stage / 'manifest.json'
            target.write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + '\n', encoding='utf-8')
            manifest_at(stage)
            target.replace(directory / 'manifest.json')


def publish_packages(directory, commit, github):
    manifest = manifest_at(directory)
    if manifest['source_commit'] != commit or not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise MirrorError('Wrong source manifest for package publication')
    validate_delivery(directory, manifest)
    # The verified manifest binds every archive's digest and exact build commit.
    github.verify(directory, directory / BUNDLE_FILES[0])
    for component in offline.COMPONENTS:
        item = manifest['packages'][component]
        path = directory / item['filename']
        if not path.exists() and not path.is_symlink():
            continue  # Reused components are verified by publish_github.packages.
        check_file(path, item['size'], item['sha256'])
        tag = item['release_tag']
        record = github.get(tag)
        asset = package_asset(record, item) if record is not None else None
        if record is not None and not record['draft']:
            continue
        if item['built_from_commit'] != commit:
            raise MirrorError('Old package provenance requires an already published release')
        if record is None:
            github.create(tag, commit, f"Immutable {component}, source {commit}, SHA256 {item['sha256']}")
            record = github.get(tag)
            if package_asset(record, item) is not None or record['draft'] is not True:
                raise MirrorError('New package draft identity changed')
        if asset is None:
            github.upload(tag, path)
        current = github.get(tag)
        if (package_asset(current, item) is None or current['id'] != record['id'] or
                current['draft'] is not True):
            raise MirrorError('Package draft changed during upload')
        github.publish(tag)
        published = github.get(tag)
        if (package_asset(published, item) is None or published['id'] != record['id'] or
                published['draft'] is not False):
            raise MirrorError('Package publication was not confirmed')


def release_assets(record, commit):
    tag = 'offline-manifest-' + commit[:12]
    if (not isinstance(record, dict) or record.get('tag_name') != tag or
            record.get('target_commitish') != commit or type(record.get('id')) is not int or
            type(record.get('draft')) is not bool or not isinstance(record.get('assets'), list)):
        raise MirrorError('Release target does not match the exact source commit')
    assets = {}
    for item in record['assets']:
        name = item.get('name')
        if (name not in RELEASE_FILES_GO or name in assets or type(item.get('id')) is not int or
                item['id'] <= 0 or type(item.get('size')) is not int or
                not 0 < item['size'] <= METADATA_LIMIT):
            raise MirrorError('Unexpected or duplicate release asset')
        assets[name] = item
    return assets


def asset_identities(assets):
    # Download counters, URLs and timestamps can change during publication.
    # The ID also detects delete/reupload replacements with identical bytes.
    return {name: (item['id'], item['size'], item.get('digest')) for name, item in assets.items()}


class PublicationError(MirrorError):
    CODES = frozenset(('github-publish', 'github-post-publish-lookup', 'github-post-publish-identity'))

    def __init__(self, code):
        super().__init__('Release publication was not confirmed')
        self.code = code if code in self.CODES else 'verification'


def download_release(directory, commit, github, record):
    assets = release_assets(record, commit)
    directory.mkdir(parents=True, exist_ok=True)
    for name, item in assets.items():
        github.download(record['tag_name'], name, directory)
        path = directory / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size != item['size']:
            raise MirrorError('Downloaded release metadata size mismatch')
        digest = item.get('digest')
        if digest is not None and digest != 'sha256:' + sha256_file(path):
            raise MirrorError('Downloaded release metadata digest mismatch')
    return assets


def publish_github(directory, commit, github):
    manifest = manifest_at(directory)
    if manifest['source_commit'] != commit or not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise MirrorError('Wrong source manifest for publication')
    validate_delivery(directory, manifest)
    expected_files = local_release_files(directory)
    tag = 'offline-manifest-' + commit[:12]
    record = github.get(tag)
    with tempfile.TemporaryDirectory(prefix='release-verify-', dir=directory) as temp:
        remote = Path(temp)
        assets = download_release(remote, commit, github, record) if record is not None else {}
        existing_bundles = [remote / n for n in BUNDLE_FILES if n in assets]
        if existing_bundles:
            original = existing_bundles[0].read_bytes()
            if any(p.read_bytes() != original for p in existing_bundles):
                raise MirrorError('Existing attestation bundles conflict')
            github.verify(directory, existing_bundles[0])
            for name in BUNDLE_FILES:
                (directory / name).write_bytes(original)
        if (directory / BUNDLE_FILES[0]).read_bytes() != (directory / BUNDLE_FILES[1]).read_bytes():
            raise MirrorError('Local attestation aliases conflict')
        github.verify(directory, directory / BUNDLE_FILES[0])
        for name in expected_files:
            path = directory / name
            if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= METADATA_LIMIT:
                raise MirrorError('Missing local release metadata')
            if name in assets and path.read_bytes() != (remote / name).read_bytes():
                raise MirrorError('Immutable release asset collision; never overwrite')
        github.packages(manifest)
        if record is not None and not record['draft']:
            if set(assets) != set(expected_files):
                raise MirrorError('Published release differs from this exact signed format; refusing mutation')
            return
        if record is None:
            notes = ('Source Commit: ' + commit + '\nTrusted Manifest SHA-256: ' +
                     sha256_file(directory / 'manifest.json') + '\nTrusted Installer SHA-256: ' +
                     sha256_file(directory / 'xdrive-offline.py'))
            github.create(tag, commit, notes)
            record = github.get(tag)
            if not record or release_assets(record, commit) or record['draft'] is not True:
                raise MirrorError('New release draft identity changed')
        for name in expected_files:  # Manifest is uploaded first; never clobber.
            if name not in assets:
                github.upload(tag, directory / name)
        current = github.get(tag)
        if current is None or current['id'] != record['id'] or current.get('draft') is not True:
            raise MirrorError('Draft changed during recovery')
        with tempfile.TemporaryDirectory(prefix='release-readback-', dir=directory) as checked:
            checked = Path(checked)
            complete = download_release(checked, commit, github, current)
            if set(complete) != set(expected_files) or any(
                    (checked / n).read_bytes() != (directory / n).read_bytes() for n in expected_files):
                raise MirrorError('Draft assets are incomplete or changed')
        try:
            github.publish(tag)
        except (MirrorError, OSError, ValueError, KeyError, TypeError) as error:
            raise PublicationError('github-publish') from error
        try:
            published = github.get(tag)
        except (MirrorError, OSError, ValueError, KeyError, TypeError) as error:
            raise PublicationError('github-post-publish-lookup') from error
        try:
            if (published is None or published['id'] != record['id'] or published.get('draft') is not False or
                    asset_identities(release_assets(published, commit)) != asset_identities(complete)):
                raise MirrorError('Release publication was not confirmed')
        except (MirrorError, OSError, ValueError, KeyError, TypeError) as error:
            raise PublicationError('github-post-publish-identity') from error


def resume_github(directory, commit, repository, github):
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise MirrorError('Full source commit required')
    tag = 'offline-manifest-' + commit[:12]
    record = github.get(tag)
    if record is None:
        return False
    assets = release_assets(record, commit)
    if not record['draft'] and set(assets) not in (set(RELEASE_FILES), set(RELEASE_FILES_GO)):
        raise MirrorError('Published release has an unrecognized asset set')
    # No authenticated seed yet: the normal CI build may supply missing assets.
    # publish_github will compare every surviving byte before adding anything.
    if 'manifest.json' not in assets or not any(n in assets for n in BUNDLE_FILES):
        return False
    with tempfile.TemporaryDirectory(prefix='release-resume-', dir=directory.parent) as temp:
        stage = Path(temp)
        download_release(stage, commit, github, record)
        original = {n: (stage / n).read_bytes() for n in assets}
        (stage / 'xdrive-offline.py').write_bytes(installer_source(repository).read_bytes())
        descriptor = delivery.generate(stage, commit, repository)
        (stage / 'delivery.json').write_text(json.dumps(descriptor, sort_keys=True, indent=2) + '\n', encoding='utf-8')
        write_checksums(stage)
        for name, contents in original.items():
            if name not in BUNDLE_FILES and (stage / name).read_bytes() != contents:
                raise MirrorError('Existing draft metadata conflicts with exact source')
        bundle = next(original[n] for n in BUNDLE_FILES if n in original)
        for name in BUNDLE_FILES:
            if name in original and original[name] != bundle:
                raise MirrorError('Existing draft signatures conflict')
            (stage / name).write_bytes(bundle)
        # This verifies signatures before publication and publishes only a fully
        # verified exact draft. Missing/mismatched package releases fail closed.
        publish_github(stage, commit, github)
        directory.mkdir(parents=True, exist_ok=True)
        for name in local_release_files(stage):
            (directory / name).write_bytes((stage / name).read_bytes())
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('fetch', 'resume-github', 'publish-github',
                                           'reconcile-packages', 'publish-packages', 'checksums', 'previous'))
    parser.add_argument('--directory', type=Path, default=Path('offline'))
    parser.add_argument('--commit')
    parser.add_argument('--repository', type=Path, default=HERE.parents[1])
    args = parser.parse_args()
    try:
        if args.command == 'fetch':
            fetch_packages(args.directory)
        elif args.command == 'checksums':
            write_checksums(args.directory)
        elif args.command == 'previous':
            print(previous_manifest(json.loads(sys.stdin.read())))
        elif args.command in ('resume-github', 'publish-github', 'publish-packages', 'reconcile-packages'):
            if not isinstance(args.commit, str) or not re.fullmatch(r'[a-f0-9]{40}', args.commit):
                raise MirrorError('Full source commit required')
            if args.command == 'resume-github':
                print('true' if resume_github(args.directory, args.commit, args.repository, GitHub()) else 'false')
            elif args.command == 'publish-packages':
                publish_packages(args.directory, args.commit, GitHub())
            elif args.command == 'reconcile-packages':
                reconcile_packages(args.directory, args.commit, args.repository, GitHub())
            else:
                publish_github(args.directory, args.commit, GitHub())
        return 0
    except (MirrorError, OSError, ValueError, KeyError, TypeError) as error:
        # Only locally controlled codes are logged; exceptions may contain URLs
        # or credentials from an external process or private Share request.
        if isinstance(error, MirrorPhaseError):
            code = error.phase
        elif isinstance(error, PublicationError) and error.code in PublicationError.CODES:
            code = error.code
        else:
            code = 'verification'
        print(f'Server release verification failed [{code}]; no publication may be assumed', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
