import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { planSignedAndroidRelease } from './signed-release-plan.mjs';

const sourceSha = 'a'.repeat(40);
const releases = [
  { tag_name: 'snapshot', draft: false, assets: [
    { name: 'xdrive-android-4-0.1.3.apk' },
    { name: 'xdrive-server' },
  ] },
  { tag_name: 'android-v3', draft: false, assets: [
    { name: 'xdrive-android-3-0.1.2.apk' },
  ] },
];

test('exact immutable public Android asset and non-stable release tag', () => {
  const plan = planSignedAndroidRelease({
    versionCode: '5', versionName: '0.1.4', sourceSha, releases,
  });
  assert.deepEqual(plan, {
    versionCode: 5,
    versionName: '0.1.4',
    sourceSha,
    releaseTag: 'android-v5',
    assetName: 'xdrive-android-5-0.1.4.apk',
    highestPublishedCode: 4,
  });
  assert(Object.isFrozen(plan));
});

test('monotonic release rejects reused and older codes and existing tags', () => {
  for (const versionCode of ['1', '3', '4']) {
    assert.throws(() => planSignedAndroidRelease({
      versionCode, versionName: '0.1.4', sourceSha, releases,
    }), /increase|already exists/);
  }
  assert.throws(() => planSignedAndroidRelease({
    versionCode: '5', versionName: '0.1.4', sourceSha,
    releases: [...releases, { tag_name: 'android-v5', draft: true, assets: [] }],
  }), /already exists/);
});

test('injection-shaped user inputs never become release filenames or tags', () => {
  for (const versionCode of ['0', '-1', '01', '2.2', '2100000001', '1;exit 0', '', ' 5']) {
    assert.throws(() => planSignedAndroidRelease({
      versionCode, versionName: '0.1.4', sourceSha, releases,
    }), /Invalid/);
  }
  for (const versionName of ['x/y', 'x;id', 'x a', '..foo', '', 'v'.repeat(65)]) {
    assert.throws(() => planSignedAndroidRelease({
      versionCode: '5', versionName, sourceSha, releases,
    }), /Invalid/);
  }
  assert.throws(() => planSignedAndroidRelease({
    versionCode: '5', versionName: '0.1.4', sourceSha: 'x', releases,
  }), /SHA/);
});

test('malformed release list fails closed; drafts are not published version evidence', () => {
  for (const broken of [null, {}, [{ tag_name: 'snapshot' }]]) {
    assert.throws(() => planSignedAndroidRelease({
      versionCode: '5', versionName: '0.1.4', sourceSha, releases: broken,
    }), /Invalid public release metadata/);
  }
  const draft = [{ tag_name: 'draft-v99', draft: true,
    assets: [{ name: 'xdrive-android-99-1.0.apk' }] }];
  const plan = planSignedAndroidRelease({
    versionCode: '5', versionName: '0.1.4', sourceSha, releases: draft,
  });
  assert.equal(plan.highestPublishedCode, 0);
});

test('manual workflow is gated to master, fixed signing and public release evidence', () => {
  const workflow = readFileSync(fileURLToPath(
    new URL('../../.github/workflows/android-signed-public-release.yml', import.meta.url),
  ), 'utf8');
  assert.match(workflow, /on:\n  workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s+push:/m);
  for (const fragment of [
    "github.ref == 'refs/heads/master'",
    'inputs.confirm_public_release',
    'ANDROID_RELEASE_KEYSTORE_P12_B64',
    'ANDROID_RELEASE_KEYSTORE_PASSWORD',
    'ANDROID_RELEASE_CERT_SHA256',
    'apksigner',
    'update-asset.mjs',
    'gh release create',
    'SHA256SUMS.txt',
    'ref: ' + '$' + '{{ github.sha }}',
  ]) assert(workflow.includes(fragment), 'missing release invariant: ' + fragment);
  const build = workflow.split('  build-and-verify:')[1]?.split('  publish-public-signed-apk:')[0];
  const publish = workflow.split('  publish-public-signed-apk:')[1];
  assert(build && publish, 'require separate signing and publishing jobs');
  assert.match(build, /permissions:\n      contents: read/);
  assert.doesNotMatch(build, /contents: write/);
  assert.match(publish, /needs: build-and-verify/);
  assert.match(publish, /permissions:\n      contents: write\n      actions: read/);
  assert.match(publish, /actions\/download-artifact@v4/);
  assert.match(publish, /sha256sum -c SHA256SUMS.txt/);
  assert.doesNotMatch(publish, /SIGNING_KEY_B64|SIGNING_PASSWORD|assembleRelease/);
  assert.doesNotMatch(workflow, /app-debug\.apk|assembleDebug|--clobber/);
});
