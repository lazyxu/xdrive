'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { compareRealVideoFirstFrames } = require('../scripts/viewer-first-frame-compare.cjs')

const root = path.join(__dirname, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
function evidence(values, optionalTTFB = null) {
  return {
    passed: true, firstFrameBenchMode: true, sampleCount: 3,
    samples: values.map(value => ({
      p1H264Frames: {
        passed: true,
        firstFrame: {
          ready: true, actualSignedVideo: true,
          firstFrameMs: value, urlMs: value / 3,
          metadataMs: value / 2,
          loadedDataMs: value * 0.8,
          rangeTTFBMs: optionalTTFB,
          navigationVisible: true,
          videoWidth: 320, videoHeight: 180,
          presentedFrames: 2,
        },
      },
    })),
  }
}
test('n3/n3 pair compares real first-frame medians and does not invent a causal speedup', () => {
  const result = compareRealVideoFirstFrames(
    evidence([900, 600, 300]), evidence([590, 520, 470]),
    { baselineCommit: 'a'.repeat(40), candidateCommit: 'b'.repeat(40) },
  )
  assert.equal(result.validated, true)
  assert.equal(result.sampleCountEach, 3)
  assert.equal(result.metrics.firstFrameMs.baselineP50Ms, 600)
  assert.equal(result.metrics.firstFrameMs.candidateP50Ms, 520)
  assert.equal(result.metrics.firstFrameMs.deltaP50Ms, -80)
  assert.equal(result.observedFirstFrameDirection, 'candidate-faster-observed')
  assert.equal(result.statisticallyEstablishedSpeedup, false)
  assert.equal(result.metrics.rangeTTFBMs.measured, false,
    'missing browser Range timing cannot be treated as zero')
  assert.equal(result.metrics.rangeTTFBMs.deltaP50Ms, null)
  const slower = compareRealVideoFirstFrames(evidence([300, 400, 500]), evidence([700, 800, 900]))
  assert.equal(slower.observedFirstFrameDirection, 'candidate-slower-observed')
  assert.equal(slower.metrics.firstFrameMs.deltaP50Ms, 400)
})
test('paired H264 result rejects missing frames, wrong Owner proof, and incomplete n3', () => {
  const before = evidence([120, 180, 250])
  const after = evidence([130, 160, 190])
  before.samples[1].p1H264Frames.firstFrame.actualSignedVideo = false
  assert.throws(() => compareRealVideoFirstFrames(before, after), /sample 1 invalid/)
  before.samples[1].p1H264Frames.firstFrame.actualSignedVideo = true
  before.samples[0].p1H264Frames.firstFrame.firstFrameMs = 0
  assert.throws(() => compareRealVideoFirstFrames(before, after), /sample 0 invalid/)
  before.samples.shift()
  assert.throws(() => compareRealVideoFirstFrames(before, after), /n3 gate missing/)
})
test('actual Chromium probe is injected before original H264 viewer click, without signed ticket retention', () => {
  const probe = read('desktop/scripts/viewer-first-frame-probe.cjs')
  const runner = read('desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs')
  const fixture = read('internal/api/gallery_real_web_cold_performance_integration_test.go')
  const tlsProxy = read('desktop/scripts/viewer-first-frame-https-proxy.cjs')
  const h264 = read('internal/api/pwa_p1_viewer_video_range_cancel_fixture_test.go')
  for (const marker of [
    'requestVideoFrameCallback',
    'metadata.presentedFrames > 0',
    'metadata.width > 0',
    'video.isConnected',
    "url.searchParams.has('ticket')",
    'loadedmetadata', 'loadeddata',
    "performance.getEntriesByType('resource')",
    'return snapshot',
  ]) assert.ok(probe.includes(marker), 'missing real video timing verification: ' + marker)
  for (const marker of [
    'xDriveStartViewerFirstFrameProbe.toString()',
    'sendActualPointer(win,tile)',
    'p1ObserveAdvancingVideoFrames.toString()',
    'xDriveReadViewerFirstFrameProbe.toString()',
    'row.p1H264Frames.firstFrame.firstFrameMs',
    'videoFirstFrameMode',
    'XD_VIEWER_FF_DIST',
    'startViewerFirstFrameHTTPSProxy',
    'installPinnedViewerFixtureCertificate',
    'httpsFixture ? httpsFixture.origin : fixture.config.url',
  ]) assert.ok(runner.includes(marker), 'runtime benchmark not integrated: ' + marker)
  assert.ok(runner.indexOf('xDriveStartViewerFirstFrameProbe.toString()') <
    runner.indexOf('sendActualPointer(win,tile)'), 'probe must mount BEFORE the genuine Viewer click')
  assert.match(fixture, /galleryFirstVisibleSeedObjects/)
  assert.match(h264, /galleryFirstVisibleVideoMP4Base64/)
  assert.ok(tlsProxy.includes('setCertificateVerifyProc') &&
    tlsProxy.includes('request.hostname === url.hostname') &&
    tlsProxy.includes("new X509Certificate(presented).fingerprint256") &&
    !tlsProxy.includes("new X509Certificate(certificate).fingerprint.toLowerCase()") &&
    tlsProxy.includes("fingerprint === fixture.fingerprint") &&
    !tlsProxy.includes('ignore-certificate-errors'),
    'test HTTPS cert trust must be pinned, never globally disabled')
  assert.ok(!probe.includes('fetch('), 'timing must not open a duplicate signed media download')
  assert.ok(!probe.includes('console.log('), 'never log signed original URLs from Renderer')
  assert.ok(!probe.includes('currentSrc:'), 'a private signed URL must not be serialized in results')
})
test('paired workflow compiles both real production builds against the same Go/PG17 signed-video fixture', () => {
  const flow = read('.github/workflows/viewer-first-frame-paired-h264.yml')
  for (const marker of [
    'postgres:17-alpine',
    'github.event.pull_request.head.sha',
    'github.event.pull_request.base.sha',
    'git merge-base',
    'git worktree add --detach',
    'npm --prefix desktop install --no-audit --no-fund',
    'node --test desktop/tests/viewer-first-frame-benchmark-contract.cjs desktop/tests/viewer-first-frame-https-proxy.cjs desktop/tests/viewer-video-stable-loading.cjs',
    'sudo apt-get install -y xvfb openssl',
    'npm --prefix web ci',
    'npm --prefix "$VIEWER_BASE_DIR/web" ci',
    'VITE_XDRIVE_GALLERY_REAL_COLD_PERF=1',
    'go test -c -o desktop/viewer-first-frame-go/api.test',
    "XD_PWA_P1_H264_VIEWER_FRAME: '1'",
    "XD_VIEWER_FIRST_FRAME_BENCH: '1'",
    'XD_VIEWER_FF_DIST="$VIEWER_BASE_DIR/web/dist"',
    'XD_VIEWER_FF_DIST="$GITHUB_WORKSPACE/web/dist"',
    'xvfb-run',
    'viewer-first-frame-compare.cjs',
    'if: always()',
    'cancel-in-progress: false',
  ]) assert.ok(flow.includes(marker), 'paired before/after workflow missing: ' + marker)
  const candidateRun = flow.indexOf('export XD_VIEWER_FF_DIST="$GITHUB_WORKSPACE/web/dist"')
  const baselineRun = flow.indexOf('export XD_VIEWER_FF_DIST="$VIEWER_BASE_DIR/web/dist"')
  assert.ok(candidateRun >= 0 && baselineRun > candidateRun,
    'candidate real signed video n3 must run before a potentially broken historical baseline')
  assert.ok(flow.indexOf('viewer-first-frame-compare.cjs') > baselineRun,
    'do not claim n3/n3 comparison until both actual Web builds were measured')
  assert.ok(flow.includes('set -euo pipefail'),
    'candidate failure and baseline failure must still fail the paired workflow')
  assert.ok(!flow.includes('|| true'), 'a failed real sample must not become a success')
  assert.ok(!flow.includes('npm --prefix desktop ci'),
    'Desktop has no package-lock; CI must not attempt npm ci for it')
  assert.ok(!flow.includes('continue-on-error'), 'benchmark must fail closed')
  const desktop = JSON.parse(read('desktop/package.json'))
  assert.equal(desktop.overrides?.rollup, '4.68.0',
    'Desktop must pin the published Rollup release instead of resolving nonexistent 4.68.2')
})
