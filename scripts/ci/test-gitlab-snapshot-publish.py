#!/usr/bin/env python3
"""Offline runtime regression for GitLab snapshot stage/verify/promote semantics."""
import copy
from contextlib import ExitStack, contextmanager
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import lzma
import shutil
import tarfile
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import threading
from urllib.parse import parse_qs, urlencode, urlsplit

ROOT = Path(__file__).resolve().parents[2]
PUBLISHER = ROOT / 'scripts/ci/gitlab-publish-release.sh'
SPK_NAME = 'xdrivenas-armada38x-0.1.0-123.spk'
A = 'a' * 40
B = 'b' * 40
FILES = (
    'xdrive-linux-amd64.deb', 'xDriveSetup-amd64.exe',
    'xdrive-source-agent-linux-amd64', 'xdrive-source-agent-linux-arm64',
    'xdrive-backup-linux-amd64.tar.gz', 'xdrive-backup-windows-amd64.zip',
    SPK_NAME, SPK_NAME + '.sha256',
    'xdrive-server-install.sh', 'server-backup.sh', 'server-backup-scheduled.sh',
    'server-restore.sh', 'server-verify.sh', 'server-doctor.sh',
    'server-migrate-user.sh', 'xdrive-server', 'docker-compose.yml',
    'server-control.sh', 'caddy-env-config.py', 'caddy-admission.py',
    'xdrive.env.example', 'SHA256SUMS.txt',
)

MOCK_GLAB = r'''#!/usr/bin/python3
import hashlib
import json
import os
from pathlib import Path
import sys
from urllib.parse import parse_qs, urlsplit

path = Path(os.environ['MOCK_STATE'])
state = json.loads(path.read_text())
args = sys.argv[1:]

def persist():
    path.write_text(json.dumps(state))

def fail(message):
    print(message, file=sys.stderr)
    sys.exit(22)

if args[:2] == ['release','create']:
    tag = args[2]
    if tag == 'snapshot':
        if state['release'] is not None:
            fail('already exists')
        state['release'] = {'description':args[args.index('--notes') + 1],
                            'name':args[args.index('--name') + 1], 'links':[]}
        state['events'].append('create-release')
        persist()
        print('release created')
        sys.exit(0)
    state['events'].append('create-stable')
    persist()
    print('release created')
    sys.exit(0)
if not args or args[0] != 'api':
    fail('unexpected command: '+' '.join(args))

args = args[1:]
method = 'GET'
input_file = None
fields = {}
endpoint = ''
paginate = False
i = 0
while i < len(args):
    a = args[i]
    if a in ('--method','-X'):
        method=args[i+1];i+=2
    elif a == '--input':
        input_file=args[i+1];i+=2
    elif a in ('--header','-H'):
        i+=2
    elif a in ('-f','--raw-field'):
        k,v=args[i+1].split('=',1);fields[k]=v;i+=2
    elif a == '--paginate':
        paginate=True;i+=1
    elif a.startswith('-'):
        fail('unexpected flag: '+a)
    else:
        endpoint=a;i+=1
if not endpoint:
    fail('missing endpoint')

if '/packages/generic/' in endpoint:
    parts=endpoint.split('/')
    assert method=='PUT' and input_file
    version=parts[5]; name=parts[6]
    if os.getenv('MOCK_FAIL_ASSET') == name:
        state['events'].append('failed-upload-'+name);persist();fail('simulated upload failure')
    content=Path(input_file).read_bytes()
    state['packages'].setdefault(version,{})[name]=hashlib.sha256(content).hexdigest()
    state['events'].append('upload-'+name)
    persist()
    print('{"message":"201 Created"}')
    sys.exit(0)

if endpoint.startswith('projects/42/packages?'):
    if os.getenv('MOCK_FAIL_PACKAGE_READ'):
        print('[]')
        fail('simulated package API failure with valid JSON')
    version=endpoint.split('package_version=',1)[1].split('&',1)[0]
    print(json.dumps([{'id':123, 'name':'xdrive-build-packages', 'version':version}]
                     if version in state['packages'] else []))
    sys.exit(0)
if endpoint.startswith('projects/42/packages/123/package_files?'):
    # Model GitLab's JSON response, not a nonexistent glab --jq flag.
    version=next(reversed(state['packages']))
    files=[]
    for name,sha in state['packages'][version].items():
        if os.getenv('MOCK_CORRUPT_DIGEST') == name:
            sha='0'*64
        files.append({'file_name':name, 'file_sha256':sha})
    print(json.dumps(files))
    sys.exit(0)

if endpoint == 'projects/42/releases/snapshot':
    if method == 'GET':
        if state['release'] is None:
            fail('404 Not Found')
        print('{invalid JSON' if os.getenv('MOCK_INVALID_RELEASE_JSON')
              else json.dumps(state['release']))
        sys.exit(0)
    if method == 'PUT':
        state['release']['name'] = fields['name']
        state['release']['description'] = fields['description']
        state['events'].append('promote-marker')
        persist()
        print(json.dumps(state['release']))
        sys.exit(0)

link_request = urlsplit(endpoint)
if link_request.path == 'projects/42/releases/snapshot/assets/links':
    if method == 'GET':
        # GitLab returns newest IDs first and only 20 links by default. The
        # old unbounded fixture hid the failure once a release had 22 assets.
        links = sorted(state['release']['links'], key=lambda link:link['id'], reverse=True)
        query = parse_qs(link_request.query)
        page = int(query.get('page', ['1'])[0])
        per_page = int(query.get('per_page', ['20'])[0])
        while True:
            phase = ('after' if any('sha-'+'b'*40 in link['url'] for link in links)
                     else 'before')
            fault = os.getenv('MOCK_LINK_PAGE_FAILURE', '')
            if page >= 3 and fault.startswith(phase+'-'):
                if fault.endswith('-json'):
                    print('{invalid page JSON')
                    sys.exit(0)
                print('[]')
                fail('simulated later link page failure')
            print(json.dumps(links[(page-1)*per_page:page*per_page]))
            if not paginate or page*per_page >= len(links):
                break
            page += 1
        sys.exit(0)
    if method == 'POST':
        if os.getenv('MOCK_FAIL_LINK') == fields.get('name'):
            fail('simulated link failure')
        if any(link['name'] == fields['name'] for link in state['release']['links']):
            fail('link name has already been taken')
        state['next_link'] += 1
        link={'id':state['next_link'], 'name':fields['name'], 'url':fields['url']}
        state['release']['links'].append(link)
        state['events'].append('create-link-'+fields['name'])
        persist()
        print(json.dumps(link))
        sys.exit(0)

if endpoint.startswith('projects/42/releases/snapshot/assets/links/'):
    link_id=int(endpoint.rsplit('/',1)[-1])
    link=next((l for l in state['release']['links'] if l['id']==link_id),None)
    if link is None:
        fail('link missing')
    if method == 'PUT':
        if os.getenv('MOCK_FAIL_LINK') == link['name'] and 'sha-'+'b'*40 in fields.get('url',''):
            fail('simulated link failure')
        link['url']=fields['url']
        state['events'].append('update-link-'+link['name'])
        persist()
        print(json.dumps(link))
        sys.exit(0)
    if method == 'DELETE':
        state['release']['links'].remove(link)
        state['events'].append('delete-link-'+link['name'])
        persist()
        sys.exit(0)
fail('unexpected API call: '+method+' '+endpoint+' fields='+str(fields))
'''

MOCK_GIT = r'''#!/bin/sh
if [ "$1" = merge-base ] && [ "$2" = --is-ancestor ]; then
  [ "${MOCK_STALE:-0}" != 1 ]
  exit $?
fi
if [ -n "${XDRIVE_TEST_REAL_GIT:-}" ]; then exec "$XDRIVE_TEST_REAL_GIT" "$@"; fi
echo "unexpected git command: $*" >&2
exit 2
'''


@contextmanager
def real_cli_api(tmp):
    """Exercise the real glab binary against a loopback-only GitLab API fixture.

    Reuse the failure/state model, but never mock CLI parsing, HTTP methods,
    JSON request encoding, uploads or response decoding in this mode.
    """
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def handle_api(self):
            prefix = '/api/v4/'
            assert self.path.startswith(prefix), self.path
            endpoint = self.path[len(prefix):].replace('xuliang%2Fxdrive', '42')
            body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            args = ['api', '--method', self.command, endpoint]
            upload = None
            try:
                if '/packages/generic/' in endpoint:
                    assert self.headers.get_content_type() == 'application/octet-stream'
                    # The next HTTP request can start before this handler's
                    # finally block runs. Never share its upload path.
                    with tempfile.NamedTemporaryFile(dir=tmp, prefix='request-upload-', delete=False) as request:
                        upload = Path(request.name)
                        request.write(body)
                    args += ['--input', str(upload)]
                elif body:
                    fields = json.loads(body)
                    if self.command == 'POST' and endpoint == 'projects/42/releases':
                        args = ['release', 'create', fields['tag_name'],
                                '--notes', fields['description'], '--name', fields['name']]
                    else:
                        for key, value in fields.items():
                            args += ['-f', f'{key}={value}']
                result = subprocess.run(
                    [sys.executable, str(tmp/'api-model'), *args],
                    env=self.server.fixture_env, capture_output=True, timeout=5,
                )
                status = 200
                response = result.stdout
                if result.returncode:
                    status = 404 if b'404 Not Found' in result.stderr else 500
                    response = json.dumps({'message': result.stderr.decode()}).encode()
                elif args[:2] == ['release', 'create']:
                    status = 201
                    release = json.loads((tmp/'state.json').read_text())['release']
                    response = json.dumps({**release, 'tag_name':'snapshot'}).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(response)))
                request = urlsplit(endpoint)
                if (status == 200 and self.command == 'GET'
                        and request.path == 'projects/42/releases/snapshot/assets/links'):
                    query = {key:values[0] for key,values in parse_qs(request.query).items()}
                    page = int(query.get('page', '1'))
                    per_page = int(query.get('per_page', '20'))
                    total = len(json.loads((tmp/'state.json').read_text())['release']['links'])
                    self.send_header('X-Page', str(page))
                    self.send_header('X-Per-Page', str(per_page))
                    self.send_header('X-Total', str(total))
                    self.send_header('X-Next-Page', str(page+1) if page*per_page < total else '')
                    if page*per_page < total:
                        query.update(page=str(page+1), per_page=str(per_page))
                        next_url = (f'http://127.0.0.1:{self.server.server_port}/api/v4/'
                                    f'{request.path}?{urlencode(query)}')
                        self.send_header('Link', f'<{next_url}>; rel="next"')
                self.end_headers()
                self.wfile.write(response)
            finally:
                if upload is not None:
                    upload.unlink(missing_ok=True)

        do_GET = do_POST = do_PUT = do_DELETE = handle_api

    with ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            yield server
        finally:
            server.shutdown()
            worker.join(timeout=5)
            assert not worker.is_alive(), 'fixture HTTP server did not stop'


api_server = None


def run(tmp, sha, **switches):
    state_path = tmp/'state.json'
    env = {
        **os.environ,
        'PATH':str(tmp/'bin')+os.pathsep+os.environ['PATH'],
        'MOCK_STATE':str(state_path),
        'CI_COMMIT_SHA':sha, 'CI_COMMIT_BRANCH':'master',
        'CI_PROJECT_ID':'42', 'CI_PROJECT_PATH':'xuliang/xdrive',
        'CI_API_V4_URL':'http://gitlab.local/api/v4',
    }
    env.pop('CI_COMMIT_TAG', None)
    if api_server is not None:
        host = f'127.0.0.1:{api_server.server_port}'
        env.update({
            'GITLAB_CI':'true', 'CI_SERVER_URL':f'http://{host}',
            'CI_SERVER_HOST':'127.0.0.1', 'CI_SERVER_PORT':str(api_server.server_port),
            'CI_SERVER_PROTOCOL':'http', 'CI_SERVER_FQDN':host,
            'CI_API_V4_URL':f'http://{host}/api/v4',
            'CI_PROJECT_URL':f'http://{host}/xuliang/xdrive',
            'CI_JOB_TOKEN':'fixture-token-not-a-credential',
            'XDRIVE_TEST_REAL_GIT':shutil.which('git'),
            'GLAB_CONFIG_DIR':str(tmp/'glab-config'), 'GLAB_CHECK_UPDATE':'false',
            'NO_PROXY':'127.0.0.1', 'no_proxy':'127.0.0.1',
        })
    for key in ('MOCK_FAIL_ASSET','MOCK_CORRUPT_DIGEST','MOCK_FAIL_LINK','MOCK_STALE',
                'MOCK_FAIL_PACKAGE_READ','MOCK_INVALID_RELEASE_JSON','MOCK_LINK_PAGE_FAILURE'):
        env.pop(key,None)
    env.update(switches)
    if api_server is not None:
        api_server.fixture_env = env
    result=subprocess.run(['sh',str(PUBLISHER)],cwd=tmp,env=env,capture_output=True,text=True,timeout=22)
    return result,json.loads(state_path.read_text())


def check(label,proc):
    if proc.returncode:
        raise AssertionError(f'{label}: unexpected failure {proc.returncode}\n{proc.stdout}\n{proc.stderr}')


def unchanged(before,after):
    assert after['release'] == before['release'], (before['release'],after['release'])


with tempfile.TemporaryDirectory(prefix='xdrive-gitlab-snapshot-') as temp, ExitStack() as stack:
    tmp=Path(temp)
    (tmp/'release').mkdir()
    # The publisher runs from the isolated fixture working directory, not
    # the checkout. Stage its exact verifier and a valid synthetic DSM SPK.
    (tmp/'scripts/ci').mkdir(parents=True)
    shutil.copyfile(ROOT/'scripts/ci/verify-synology-spk-release.sh',
                    tmp/'scripts/ci/verify-synology-spk-release.sh')
    for name in FILES:
        if name not in ('SHA256SUMS.txt', SPK_NAME, SPK_NAME + '.sha256'):
            (tmp/'release'/name).write_bytes(('asset: '+name+'\n').encode())
    spk_path = tmp/'release'/SPK_NAME
    spk_info = (b'package="xdrivenas"\nversion="0.1.0-123"\n'
                b'arch="armada38x"\nos_min_ver="7.0-40759"\n'
                b'dsmuidir="ui"\ndsmappname="com.xdrive.NASBackup"\n')
    # The published SPK is GUI-required. Match its nested package.tgz contract
    # rather than incorrectly using a CLI-only fixture for successful cases.
    nested = io.BytesIO()
    # DSM 7's pkg_make_package writes XZ (not GZIP) to package.tgz and
    # literal root entries. Keep this GitLab offline fixture aligned with the
    # source-exact ARMv7 SPK builder and the fail-closed release verifier.
    with tarfile.open(fileobj=nested, mode='w:xz') as payload:
        for dirname in ('bin/', 'ui/', 'ui/assets/'):
            member = tarfile.TarInfo(dirname)
            member.type = tarfile.DIRTYPE
            member.mode = 0o755
            payload.addfile(member)
        for item_name, body in (
            ('bin/xd', b'fixture ARMv7 xd executable'),
            ('bin/xdrive-agent', b'fixture ARMv7 agent executable'),
            ('ui/config', b'fixture DSM app registration'),
            ('ui/backup.cgi', b'fixture authenticated CGI'),
            ('ui/synology.html', b'fixture shared MUI entry'),
            ('ui/assets/app.js', b'fixture compiled MUI JavaScript'),
        ):
            member = tarfile.TarInfo(item_name)
            member.size = len(body)
            member.mode = 0o755 if item_name in ('bin/xd', 'bin/xdrive-agent', 'ui/backup.cgi') else 0o644
            payload.addfile(member, io.BytesIO(body))
    assert nested.getvalue().startswith(b'\xfd7zXZ\x00'), 'fixture must be XZ, not GZIP'
    # Python tarfile normalizes directory member.name from "bin/" to "bin";
    # compare normalized directory names and still verify literal TAR bytes.
    with tarfile.open(fileobj=io.BytesIO(nested.getvalue()), mode='r:xz') as inner:
        members = inner.getmembers()
        assert {'bin', 'ui', 'ui/assets'} <= {
            item.name for item in members if item.isdir()
        }, 'fixture must include the required DSM toolkit directories'
        assert {'bin/xd', 'bin/xdrive-agent', 'ui/config',
                'ui/backup.cgi', 'ui/synology.html', 'ui/assets/app.js'} <= {
            item.name for item in members if item.isfile()
        }, 'fixture must include the required DSM toolkit files'
    # Ensure the raw first TAR header actually uses the literal "bin/" root;
    # tarfile's normalized directory names alone do not prove this.
    assert lzma.decompress(nested.getvalue())[:100].split(bytes([0]), 1)[0] == b'bin/', (
        'fixture must have a literal bin/ TAR root header'
    )
    # The real DSM package publisher requires the canonical raw outer SPK
    # layout. A legacy "./INFO" fixture used to pass here and masked the
    # format regression that prevents DS218j Package Center installation.
    with tarfile.open(spk_path, 'w', format=tarfile.USTAR_FORMAT) as archive:
        member = tarfile.TarInfo('INFO')
        member.size = len(spk_info)
        archive.addfile(member, io.BytesIO(spk_info))
        packaged = nested.getvalue()
        member = tarfile.TarInfo('package.tgz')
        member.size = len(packaged)
        archive.addfile(member, io.BytesIO(packaged))
    with tarfile.open(spk_path, 'r:') as archive:
        assert [member.name for member in archive.getmembers()] == [
            'INFO', 'package.tgz',
        ], 'GitLab publisher fixture must match literal INFO-first DSM SPK'
    (tmp/'release'/(SPK_NAME + '.sha256')).write_text(
        f'{hashlib.sha256(spk_path.read_bytes()).hexdigest()}  {SPK_NAME}\n')
    (tmp/'bin').mkdir()
    for name,content in [('glab',MOCK_GLAB),('git',MOCK_GIT)]:
        binary=tmp/'bin'/name
        binary.write_text(content)
        binary.chmod(0o755)
    if os.environ.get('XDRIVE_TEST_REAL_GLAB'):
        real_glab = Path(os.environ['XDRIVE_TEST_REAL_GLAB']).resolve(strict=True)
        (tmp/'api-model').write_text(MOCK_GLAB)
        (tmp/'bin/glab').unlink()
        (tmp/'bin/glab').symlink_to(real_glab)
        api_server = stack.enter_context(real_cli_api(tmp))
        # glab release create resolves its repository through Git. Use a real
        # temporary repository; only the synthetic A/B ancestry is simulated.
        subprocess.run(['git', 'init', '-q', str(tmp)], check=True)
        subprocess.run(['git', '-C', str(tmp), 'remote', 'add', 'origin',
                        f'http://127.0.0.1:{api_server.server_port}/xuliang/xdrive.git'], check=True)
    initial={'packages':{},'release':None,'next_link':0,'events':[]}
    (tmp/'state.json').write_text(json.dumps(initial))

    fresh,new=run(tmp,A)
    check('new',fresh)
    assert 'XDRIVE_RELEASE_COMMIT='+A in new['release']['description']
    assert len(new['release']['links']) == len(FILES)
    assert new['events'][-1]=='promote-marker'
    assert len(new['packages']['sha-'+A]) == len(FILES)
    assert len([e for e in new['events'] if e=='promote-marker']) == 1

    # Corrupting the DSM package must fail before uploading or promoting
    # a newer snapshot. Restore the known-good bytes for later fixtures.
    original_spk = spk_path.read_bytes()
    spk_path.write_bytes(original_spk + b'tampered')
    invalid_spk, after = run(tmp, B)
    assert invalid_spk.returncode != 0
    unchanged(new, after)
    assert len(after['events']) == len(new['events'])
    spk_path.write_bytes(original_spk)

    # Replaying exact commit reuses bytes and links; no extra package uploads.
    replay,same=run(tmp,A)
    check('idempotent',replay)
    assert same['release'] == new['release']
    assert len(same['packages']) == 1
    assert len([e for e in same['events'] if e.startswith('upload-')]) == len(FILES)

    # Historic/manual links can exceed even GitLab's maximum page size (100).
    # Required links on later pages must retain their IDs, unrelated links must
    # survive, and all required URLs must be verified before advancing marker.
    paged = copy.deepcopy(new)
    for index in range(101):
        paged['next_link'] += 1
        paged['release']['links'].append({
            'id':paged['next_link'], 'name':f'legacy-{index}',
            'url':f'https://archive.example/legacy-{index}',
        })
    (tmp/'state.json').write_text(json.dumps(paged))
    paginated_update,after=run(tmp,B)
    check('publish with required links beyond page 100',paginated_update)
    assert [(link['id'], link['name']) for link in after['release']['links']] == [
        (link['id'], link['name']) for link in paged['release']['links']]
    assert all('sha-'+B in link['url'] for link in after['release']['links'][:len(FILES)])
    assert after['release']['links'][len(FILES):] == paged['release']['links'][len(FILES):]
    assert 'XDRIVE_RELEASE_COMMIT='+B in after['release']['description']
    assert after['events'][-1] == 'promote-marker'

    # An incomplete later page cannot become a partial link inventory. This
    # also covers failure during final verification after links were updated:
    # every original URL, including links outside page one, must be restored.
    # Put all required links before the failing third page (even at page size
    # 20), with enough legacy links to reach it even at GitLab's maximum 100.
    # Missing-asset checks must not accidentally mask a swallowed API error.
    fault_paged = copy.deepcopy(paged)
    for index in range(101,201):
        fault_paged['next_link'] += 1
        fault_paged['release']['links'].append({
            'id':fault_paged['next_link'], 'name':f'legacy-{index}',
            'url':f'https://archive.example/legacy-{index}',
        })
    for link in fault_paged['release']['links'][:len(FILES)]:
        fault_paged['next_link'] += 1
        link['id'] = fault_paged['next_link']
    for phase in ('before', 'after'):
        for fault in ('error', 'json'):
            (tmp/'state.json').write_text(json.dumps(fault_paged))
            failed_page,after=run(tmp,B,MOCK_LINK_PAGE_FAILURE=f'{phase}-{fault}')
            assert failed_page.returncode != 0, (phase,fault)
            unchanged(fault_paged,after)
            events = after['events'][len(fault_paged['events']):]
            assert 'promote-marker' not in events, (phase,fault)
            assert any(e.startswith('update-link-') for e in events) == (phase == 'after')

    # Duplicate-name protection must include links from different pages.
    duplicate = copy.deepcopy(paged)
    duplicate['next_link'] += 1
    duplicate['release']['links'].append({
        **duplicate['release']['links'][0], 'id':duplicate['next_link'],
    })
    (tmp/'state.json').write_text(json.dumps(duplicate))
    failed_duplicate,after=run(tmp,B)
    assert failed_duplicate.returncode != 0
    unchanged(duplicate,after)
    assert 'duplicate GitLab Release links' in failed_duplicate.stderr

    # API failures must not disappear behind a successful JSON parser;
    # malformed API JSON must also fail before uploads or Release mutation.
    for switch in ('MOCK_FAIL_PACKAGE_READ', 'MOCK_INVALID_RELEASE_JSON'):
        (tmp/'state.json').write_text(json.dumps(new))
        failed_read,after=run(tmp,B,**{switch:'1'})
        assert failed_read.returncode != 0, switch
        assert after == new, switch

    # Simulated interrupt before full package staging cannot touch the Release.
    (tmp/'state.json').write_text(json.dumps(new))
    failed_upload,after=run(tmp,B,MOCK_FAIL_ASSET='server-verify.sh')
    assert failed_upload.returncode != 0
    unchanged(new,after)
    assert not any('promote-marker' in e for e in after['events'][len(new['events']):])

    # No partially staged standalone ZIP may promote a new snapshot.
    (tmp/'state.json').write_text(json.dumps(new))
    failed_zip,after=run(tmp,B,MOCK_FAIL_ASSET='xdrive-backup-windows-amd64.zip')
    assert failed_zip.returncode != 0
    unchanged(new,after)

    # Even if all bytes uploaded, a mismatching remote digest prohibits links.
    (tmp/'state.json').write_text(json.dumps(new))
    failed_digest,after=run(tmp,B,MOCK_CORRUPT_DIGEST='SHA256SUMS.txt')
    assert failed_digest.returncode != 0
    unchanged(new,after)

    # Failure during per-link update uses original URLs to restore old Release.
    (tmp/'state.json').write_text(json.dumps(new))
    failed_link,after=run(tmp,B,MOCK_FAIL_LINK='server-backup.sh')
    assert failed_link.returncode != 0, failed_link.stdout+failed_link.stderr
    unchanged(new,after)

    # A completed publish advances commit marker LAST, never deletes old package.
    (tmp/'state.json').write_text(json.dumps(new))
    update,next_state=run(tmp,B)
    check('existing',update)
    assert 'XDRIVE_RELEASE_COMMIT='+B in next_state['release']['description']
    assert set(next_state['packages'])=={'sha-'+A,'sha-'+B}
    assert len(next_state['release']['links'])==len(FILES)
    assert all('sha-'+B in link['url'] for link in next_state['release']['links'])
    assert next_state['events'][-1]=='promote-marker'

    # Old/delayed publisher must never roll the Release back to a prior commit.
    (tmp/'state.json').write_text(json.dumps(next_state))
    stale,last=run(tmp,A,MOCK_STALE='1')
    assert stale.returncode != 0
    unchanged(next_state,last)

print('GitLab staged rolling Release: new/replay/pagination/later-page-errors/rollback/duplicates/API-errors/fail-upload/fail-digest/fail-link/advance/stale: passed'
      + (' (real glab + loopback HTTP)' if api_server else ' (offline CLI model)'))
