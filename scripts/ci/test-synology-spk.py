#!/usr/bin/env python3
"""Read the real SPK as DSM would; enforce scope, architecture and reuse."""
import hashlib
import io
import json
import pathlib
import struct
import subprocess
import sys
import tarfile

spk, core, version = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
assert spk.is_file(), spk
checksum_file = spk.with_name(spk.name + ".sha256")
assert checksum_file.read_text().strip() == hashlib.sha256(spk.read_bytes()).hexdigest() + "  " + spk.name


def members(tar):
    result = {}
    for member in tar.getmembers():
        name = member.name.removeprefix('./')
        if name in ('', '.'):
            continue
        parts = pathlib.PurePosixPath(name).parts
        assert not name.startswith('/') and '..' not in parts, member.name
        assert member.isfile() or member.isdir(), ("unexpected link or device", member.name)
        assert name not in result, ("duplicate archive entry", member.name)
        result[name] = member
    return result


with tarfile.open(spk) as pkg:
    outer = members(pkg)
    allowed = {'INFO', 'package.tgz', 'LICENSE', 'PACKAGE_ICON.PNG', 'PACKAGE_ICON_256.PNG', 'conf', 'conf/privilege', 'scripts'}
    allowed |= {'scripts/' + action for action in ('preinst', 'postinst', 'preuninst', 'postuninst', 'preupgrade', 'postupgrade', 'start-stop-status')}
    assert set(outer) == allowed, ("unexpected SPK files", sorted(set(outer) ^ allowed))
    info = pkg.extractfile(outer['INFO']).read().decode()
    assert 'package="xdrivenas"' in info and f'version="{version}"' in info
    assert 'arch="armada38x"' in info and 'os_min_ver="7.0-40759"' in info
    assert 'ctl_stop="yes"' in info and 'startable=' not in info and 'thirdparty=' not in info
    privilege = json.load(pkg.extractfile(outer['conf/privilege']))
    assert privilege['defaults']['run-as'] == 'package'
    assert privilege['username'] == 'xdrivenas'
    for action in ('start-stop-status', 'postinst', 'postupgrade'):
        assert outer['scripts/' + action].mode & 0o111
    lifecycle = pkg.extractfile(outer['scripts/start-stop-status']).read().decode()
    assert '"$agent" --backup-only' in lifecycle
    assert 'SYNOPKG_PKGHOME' in lifecycle and 'SYNOPKG_PKGVAR' in lifecycle
    assert 'SIGKILL' not in lifecycle.replace('Do not SIGKILL', '')
    for icon, expected in (('PACKAGE_ICON.PNG', 64), ('PACKAGE_ICON_256.PNG', 256)):
        data = pkg.extractfile(outer[icon]).read()
        assert data[:8] == b'\x89PNG\r\n\x1a\n'
        assert struct.unpack('>II', data[16:24]) == (expected, expected)
    payload = pkg.extractfile(outer['package.tgz']).read()

with tarfile.open(fileobj=io.BytesIO(payload), mode='r:gz') as body:
    inner = members(body)
    assert set(inner) == {'bin', 'bin/xd', 'bin/xdrive-agent'}, list(inner)
    for name in ('xd', 'xdrive-agent'):
        item = inner['bin/' + name]
        assert item.mode & 0o111
        expected = (core / name).read_bytes()
        received = body.extractfile(item).read()
        assert hashlib.sha256(received).digest() == hashlib.sha256(expected).digest()
        metadata = subprocess.check_output(['go', 'version', '-m', str(core / name)], text=True)
        assert 'GOARCH=arm' in metadata and 'GOARM=7' in metadata
        assert 'GOOS=linux' in metadata
        assert 'github.com/lazyxu/xdrive/cmd/' + name in metadata

print('DSM 7 SPK passed: armada38x, non-root privilege, exact xd/Agent bytes, icons, scope and persistent paths')
