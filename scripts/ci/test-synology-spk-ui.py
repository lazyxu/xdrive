#!/usr/bin/env python3
"""Validate the optional DSM 7 shared-MUI SPK, including exact original binaries."""
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import struct
import subprocess
import sys
import tarfile

if len(sys.argv) != 5:
    raise SystemExit("usage: test-synology-spk-ui.py SPK CORE VERSION UI_DIST")
spk, core, version, dist = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], Path(sys.argv[4])
root = Path(__file__).resolve().parents[2]
assert spk.is_file() and (dist / "synology.html").is_file()
assert spk.with_name(spk.name + ".sha256").read_text().strip() == (
    hashlib.sha256(spk.read_bytes()).hexdigest() + "  " + spk.name
)


def members(tar):
    out = {}
    for member in tar.getmembers():
        name = member.name.removeprefix("./")
        if name in ("", "."):
            continue
        assert not name.startswith("/") and ".." not in PurePosixPath(name).parts
        assert (member.isfile() or member.isdir()) and name not in out
        out[name] = member
    return out


with tarfile.open(spk) as outer:
    content = members(outer)
    allowed = {"INFO", "package.tgz", "LICENSE", "PACKAGE_ICON.PNG",
               "PACKAGE_ICON_256.PNG", "conf", "conf/privilege", "scripts"}
    allowed |= {"scripts/" + x for x in (
        "preinst", "postinst", "preuninst", "postuninst",
        "preupgrade", "postupgrade", "start-stop-status"
    )}
    assert set(content) == allowed, set(content) ^ allowed
    info = outer.extractfile(content["INFO"]).read().decode()
    for field in (
        'package="xdrivenas"', f'version="{version}"',
        'arch="armada38x"', 'os_min_ver="7.0-40759"',
        'dsmuidir="ui"', 'dsmappname="com.xdrive.NASBackup"'
    ):
        assert field in info, field
    privilege = json.load(outer.extractfile(content["conf/privilege"]))
    assert privilege["defaults"]["run-as"] == "package"
    assert privilege["username"] == privilege["groupname"] == "xdrivenas"
    payload = outer.extractfile(content["package.tgz"]).read()

ui_files = set()
for item in dist.rglob("*"):
    assert not item.is_symlink()
    if item.is_file() and (item.name == "synology.html" or item.suffix in {".js", ".css", ".png"}):
        ui_files.add("ui/" + item.relative_to(dist).as_posix())
assert "ui/synology.html" in ui_files
assert any(item.startswith("ui/assets/") and item.endswith(".js") for item in ui_files)
sizes = (16, 24, 32, 48, 64, 72, 256)
icons = {"ui/images/icon_%d.png" % size for size in sizes}
files = {"bin/xd", "bin/xdrive-agent", "ui/config", "ui/backup.cgi"} | ui_files | icons
folders = {"bin", "ui", "ui/assets", "ui/images"}
for item in ui_files:
    parent = PurePosixPath(item).parent
    while str(parent) not in (".", ""):
        folders.add(str(parent))
        parent = parent.parent

with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as body:
    inner = members(body)
    assert set(inner) == files | folders, sorted(set(inner) ^ (files | folders))
    for name in files:
        assert inner[name].isfile(), name
    for name in folders:
        assert inner[name].isdir(), name
    for name in ("xd", "xdrive-agent"):
        artifact = core / name
        data = body.extractfile(inner["bin/" + name]).read()
        assert data == artifact.read_bytes(), "binary differs from source-exact core"
        info = subprocess.check_output(["go", "version", "-m", str(artifact)], text=True)
        for field in ("GOARCH=arm", "GOARM=7", "GOOS=linux",
                      "github.com/lazyxu/xdrive/cmd/" + name):
            assert field in info, field
    for item in ui_files:
        actual = body.extractfile(inner[item]).read()
        assert actual == (dist / item.removeprefix("ui/")).read_bytes(), item
        if item.endswith(".png"):
            assert 24 <= len(actual) <= (2 << 20) and actual.startswith(b"\x89PNG\r\n\x1a\n"), item
    config = json.load(body.extractfile(inner["ui/config"]))
    app = config[".url"]["com.xdrive.NASBackup"]
    assert app["type"] == "url" and app["url"] == "3rdparty/xdrivenas/synology.html"
    assert app["icon"] == "images/icon_{0}.png"
    assert app["allUsers"] is True
    cgi = body.extractfile(inner["ui/backup.cgi"]).read()
    assert inner["ui/backup.cgi"].mode & 0o111
    assert cgi == (root / "packaging/synology/ui/backup.cgi").read_bytes()
    assert b'backup synology-ui cgi' in cgi
    for unsafe in (b"sudo ", b"su -", b"chmod 777", b"curl ", b"wget "):
        assert unsafe not in cgi, "unsafe CGI helper"
    for size in sizes:
        icon = body.extractfile(inner[f"ui/images/icon_{size}.png"]).read()
        assert icon[:8] == b"\x89PNG\r\n\x1a\n"
        assert struct.unpack(">II", icon[16:24]) == (size, size)
    html = body.extractfile(inner["ui/synology.html"]).read()
    assert b"./assets/" in html
    assert b"http://" not in html and b"https://" not in html

print("DSM shared-MUI SPK verified: same ARMv7 xd/Agent, owner-only CGI, "
      "same-origin launcher, exact UI bytes and restricted archive")
