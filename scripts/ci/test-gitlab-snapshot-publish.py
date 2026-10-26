#!/usr/bin/env python3
"""Offline runtime regression for GitLab snapshot stage/verify/promote semantics."""
import copy
import hashlib
import io
import shutil
import tarfile
import json
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap

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
    'xdrive.env.example', 'SHA256SUMS.txt',
)

MOCK_GLAB = r'''#!/usr/bin/python3
import hashlib
import json
import os
from pathlib import Path
import sys

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
filter_expr = ''
endpoint = ''
i = 0
while i < len(args):
    a = args[i]
    if a in ('--method','-X'):
        method=args[i+1];i+=2
    elif a == '--input':
        input_file=args[i+1];i+=2
    elif a in ('--header','-H'):
        i+=2
    elif a == '--jq':
        filter_expr=args[i+1];i+=2
    elif a in ('-f','--raw-field'):
        k,v=args[i+1].split('=',1);fields[k]=v;i+=2
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
    version=endpoint.split('package_version=',1)[1].split('&',1)[0]
    print('123' if version in state['packages'] else '')
    sys.exit(0)
if endpoint.startswith('projects/42/packages/123/package_files?'):
    # --jq produces precisely the TAB-delimited name/hash pairs expected by
    # the production script, as GitLab's package_files metadata does.
    assert filter_expr
    version=next(reversed(state['packages']))
    for name,sha in state['packages'][version].items():
        if os.getenv('MOCK_CORRUPT_DIGEST') == name:
            sha='0'*64
        print(name+'\t'+sha)
    sys.exit(0)

if endpoint == 'projects/42/releases/snapshot':
    if method == 'GET':
        if state['release'] is None:
            fail('404 Not Found')
        if filter_expr == '.description':
            print(state['release']['description'])
        else:
            print(json.dumps(state['release']))
        sys.exit(0)
    if method == 'PUT':
        state['release']['name'] = fields['name']
        state['release']['description'] = fields['description']
        state['events'].append('promote-marker')
        persist()
        print(json.dumps(state['release']))
        sys.exit(0)

if endpoint == 'projects/42/releases/snapshot/assets/links':
    if method == 'GET':
        for link in state['release']['links']:
            print(link['name']+'\t'+str(link['id'])+'\t'+link['url'])
        sys.exit(0)
    if method == 'POST':
        if os.getenv('MOCK_FAIL_LINK') == fields.get('name'):
            fail('simulated link failure')
        state['next_link'] += 1
        link={'id':state['next_link'], 'name':fields['name'], 'url':fields['url']}
        state['release']['links'].append(link)
        state['events'].append('create-link-'+fields['name'])
        persist()
        print(str(link['id']))
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
echo "unexpected git command: $*" >&2
exit 2
'''


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
    for key in ('MOCK_FAIL_ASSET','MOCK_CORRUPT_DIGEST','MOCK_FAIL_LINK','MOCK_STALE'):
        env.pop(key,None)
    env.update(switches)
    result=subprocess.run(['sh',str(PUBLISHER)],cwd=tmp,env=env,capture_output=True,text=True,timeout=22)
    return result,json.loads(state_path.read_text())


def check(label,proc):
    if proc.returncode:
        raise AssertionError(f'{label}: unexpected failure {proc.returncode}\n{proc.stdout}\n{proc.stderr}')


def unchanged(before,after):
    assert after['release'] == before['release'], (before['release'],after['release'])


with tempfile.TemporaryDirectory(prefix='xdrive-gitlab-snapshot-') as temp:
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
                b'arch="armada38x"\nos_min_ver="7.0-40759"\n')
    with tarfile.open(spk_path, 'w') as archive:
        member = tarfile.TarInfo('./INFO')
        member.size = len(spk_info)
        archive.addfile(member, io.BytesIO(spk_info))
    (tmp/'release'/(SPK_NAME + '.sha256')).write_text(
        f'{hashlib.sha256(spk_path.read_bytes()).hexdigest()}  {SPK_NAME}\n')
    (tmp/'bin').mkdir()
    for name,content in [('glab',MOCK_GLAB),('git',MOCK_GIT)]:
        binary=tmp/'bin'/name
        binary.write_text(content)
        binary.chmod(0o755)
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

print('GitLab staged rolling Release: new/replay/fail-upload/fail-digest/fail-link/advance/stale: passed')
