import assert from 'node:assert/strict'
import test from 'node:test'
import { xDriveReleaseBundleDownloadSources } from '../../ui/shared/src/release-bundles.ts'

const commit = 'a'.repeat(40)
const digest = 'b'.repeat(64)
function fixture(filename, cached = true) {
  const encoded = encodeURIComponent(filename)
  const gitlab = 'http://gitlab.t-fluid.com:1080/api/v4/projects/xuliang%2Fxdrive/packages/generic/xdrive-build-packages/sha-' + commit + '/' + encoded
  const github = 'https://github.com/lazyxu/xdrive/releases/download/bundle-' + commit + '/' + encoded
  const local = '/api/v1/release-bundles/current/artifacts/' + encoded
  return {
    platform: 'android', filename, build_commit: commit,
    sha256: digest, size: 1200, cached, install_mode: 'manual',
    cache_status: cached ? 'verified' : 'unavailable',
    download_urls: cached ? [local, gitlab, github] : [gitlab, github],
  }
}

test('canonical + suffix URLs agree with Python generated immutable manifest', () => {
  const item = fixture('xdrive-android-12-0.1.3+build.apk')
  assert.equal(item.download_urls[0].endsWith('0.1.3%2Bbuild.apk'), true)
  assert.deepEqual(xDriveReleaseBundleDownloadSources(item), item.download_urls)
  const uncached = fixture(item.filename, false)
  assert.deepEqual(xDriveReleaseBundleDownloadSources(uncached), uncached.download_urls)
})

test('reject alternate URL escaping, stale commit, changed digest and inconsistent cache flags', () => {
  for (const tamper of [
    (x) => { x.download_urls[1] = x.download_urls[1].replace('%2B', '+') },
    (x) => { x.download_urls[2] = x.download_urls[2].replace(commit, 'c'.repeat(40)) },
    (x) => { x.build_commit = 'd'.repeat(40) },
    (x) => { x.sha256 = 'not-a-digest' },
    (x) => { x.cached = false },
    (x) => { x.size = Number.NaN },
  ]) {
    const item = fixture('xdrive-android-12-0.1.3+build.apk')
    tamper(item)
    assert.deepEqual(xDriveReleaseBundleDownloadSources(item), [])
  }
})
