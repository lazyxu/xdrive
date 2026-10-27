#!/usr/bin/env python3
"""Offline regression for numeric-JWT GitHub App mint; no network or real keys."""
import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/ci/mint-snapshot-publisher-token.sh"
APP_ID = 123456
TOKEN = "ghs_" + "a" * 40

MOCK_CURL = r'''#!/usr/bin/env python3
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

args = sys.argv[1:]
def option(name):
    return args[args.index(name)+1]

auth = [args[i+1] for i, v in enumerate(args[:-1])
        if v == "-H" and args[i+1].startswith("Authorization: Bearer ")]
assert len(auth) == 1
jwt = auth[0].split("Bearer ", 1)[1]
parts = jwt.split(".")
assert len(parts) == 3

def b64(value):
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))

header = json.loads(b64(parts[0]))
claims = json.loads(b64(parts[1]))
assert header == {"alg":"RS256","typ":"JWT"}
assert isinstance(claims["iss"], int) and claims["iss"] == int(os.environ["TEST_APP_ID"])
assert isinstance(claims["iat"], int) and isinstance(claims["exp"], int)
assert 0 < claims["exp"] - claims["iat"] <= 600
with tempfile.NamedTemporaryFile() as sigfile:
    sigfile.write(b64(parts[2]))
    sigfile.flush()
    verified = subprocess.run(
        ["openssl","dgst","-sha256","-verify",os.environ["TEST_PUBLIC_KEY"],
         "-signature",sigfile.name],
        input=(".".join(parts[:2])).encode(), capture_output=True)
    assert verified.returncode == 0, verified.stderr

method = option("-X") if "-X" in args else "GET"
url = args[-1]
logfile = Path(os.environ["TEST_CURL_CALLS"])
with logfile.open("a") as log:
    log.write(json.dumps({"method":method, "url":url}) + "\n")
if os.getenv("TEST_API_REJECT"):
    sys.exit(22)

if method == "GET":
    assert url == "https://api.github.com/repos/lazyxu/xdrive/installation"
    app_id = 999 if os.getenv("TEST_WRONG_INSTALLATION") else int(os.environ["TEST_APP_ID"])
    print(json.dumps({"id":4321, "app_id":app_id}))
elif method == "POST":
    assert url == "https://api.github.com/app/installations/4321/access_tokens"
    body = json.loads(option("--data-binary"))
    assert body == {"repositories":["xdrive"],"permissions":{
        "contents":"write","workflows":"write"}}
    permissions = {"contents":"write","workflows":"read"} if os.getenv("TEST_BAD_SCOPE") else {
        "contents":"write","workflows":"write"}
    print(json.dumps({
        "token":os.environ["TEST_TOKEN"],
        "permissions":permissions,
        "repositories":[{"full_name":"lazyxu/xdrive"}],
    }))
else:
    sys.exit("Unexpected curl operation")
'''

with tempfile.TemporaryDirectory(prefix="xdrive-snapshot-int-iss-") as d:
    temp = Path(d)
    private_key = temp / "private.pem"
    public_key = temp / "public.pem"
    subprocess.run([
        "openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt",
        "rsa_keygen_bits:2048", "-out", str(private_key)
    ], check=True, capture_output=True)
    subprocess.run(["openssl", "pkey", "-in", str(private_key),
                    "-pubout", "-out", str(public_key)], check=True, capture_output=True)
    mock_bin = temp / "bin"
    mock_bin.mkdir()
    curl = mock_bin / "curl"
    curl.write_text(MOCK_CURL, encoding="utf-8")
    curl.chmod(0o755)
    output = temp / "output"
    calls = temp / "calls"
    defaults = {
        **os.environ,
        "PATH": str(mock_bin) + os.pathsep + os.environ["PATH"],
        "GITHUB_REPOSITORY": "lazyxu/xdrive",
        "GITHUB_OUTPUT": str(output),
        "XD_SNAPSHOT_APP_ID": str(APP_ID),
        "XD_SNAPSHOT_APP_PRIVATE_KEY": private_key.read_text(),
        "TEST_PUBLIC_KEY": str(public_key),
        "TEST_APP_ID": str(APP_ID),
        "TEST_TOKEN": TOKEN,
        "TEST_CURL_CALLS": str(calls),
    }

    def run(**overrides):
        output.write_text("")
        calls.write_text("")
        env = {**defaults, **overrides}
        process = subprocess.run(["bash", str(SCRIPT)], env=env,
                                 capture_output=True, text=True, timeout=20)
        actions = [json.loads(row) for row in calls.read_text().splitlines()]
        return process, actions, output.read_text()

    okay, calls_made, result = run()
    assert okay.returncode == 0, (okay.stdout, okay.stderr)
    assert [a["method"] for a in calls_made] == ["GET", "POST"]
    assert result == "token=" + TOKEN + "\n"
    assert "::add-mask::" + TOKEN in okay.stdout
    assert TOKEN not in okay.stderr and "PRIVATE KEY" not in okay.stdout

    for label, switches, requests in [
        ("client-id-rejected", {"XD_SNAPSHOT_APP_ID":"Iv1.client"}, []),
        ("missing-id", {"XD_SNAPSHOT_APP_ID":""}, []),
        ("bad-pem", {"XD_SNAPSHOT_APP_PRIVATE_KEY":"invalid"}, []),
        ("wrong-repo", {"GITHUB_REPOSITORY":"someone/else"}, []),
        ("wrong-installation", {"TEST_WRONG_INSTALLATION":"1"}, ["GET"]),
        ("denied-api", {"TEST_API_REJECT":"1"}, ["GET"]),
        ("wrong-grant", {"TEST_BAD_SCOPE":"1"}, ["GET","POST"]),
    ]:
        process, observed, published = run(**switches)
        assert process.returncode != 0, (label, process.stdout)
        assert [a["method"] for a in observed] == requests, (label, observed)
        assert published == "", label
        assert TOKEN not in process.stdout and TOKEN not in process.stderr, label

print("Snapshot integer issuer + RSA signature + exact App token scope: 8 cases passed")
