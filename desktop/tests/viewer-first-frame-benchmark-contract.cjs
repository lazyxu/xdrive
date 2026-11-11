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
test('real deep Gallery JPEG/H264 tile lookup uses the current accessible photo-wall DOM, never stale .media-name', () => {
  const wall = read('ui/shared/src/mui/MediaGallerySharedTiles.tsx')
  const runner = read('desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs')
  assert.ok(wall.includes('data-xdrive-media-tile'))
  assert.ok(wall.includes('aria-label={`${item.node.name}，${livePhoto ?'),
    'production Gallery tiles must expose the actual file name and type')
  assert.ok(!wall.includes('media-name'),
    'the former child caption is no longer an authoritative tile selector')
  assert.ok(runner.includes("tile.getAttribute('aria-label')"),
    'real H264/JPEG benchmark must inspect a genuine accessible tile')
  assert.ok(runner.includes('/^photo-\\d+\\.jpg，照片$/'))
  assert.ok(runner.includes('/^video-\\d+\\.mp4，视频$/'))
  assert.ok(!runner.includes("tile.querySelector('.media-name')"),
    'do not hang for 30s on an absent legacy caption subnode')
  assert.ok(runner.includes('document.elementFromPoint(x,y)'),
    'keep exact hit-testing of the real mounted tile')
  assert.ok(!runner.includes("location.hash = '#/app/media-viewer'"),
    'do not bypass actual navigational click to fabricate a first frame')
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
  assert.ok(flow.indexOf('node desktop/scripts/viewer-first-frame-compare.cjs', baselineRun) > baselineRun,
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

test('real signed SPA Go/PG fixture migrates and reads both Recent sources before paired H264 UI', () => {
  const go = read('internal/api/gallery_real_web_cold_performance_integration_test.go')
  const meta = read('internal/meta/file_recent.go')
  const workflow = read('.github/workflows/viewer-first-frame-paired-h264.yml')
  assert.ok(go.includes('if desktopFileExplorerMixed || p0c2SPAMode'))
  assert.ok(go.includes('&meta.FileRecentAccess{}') &&
    go.includes('&meta.FileRecentFolderAccess{}'),
    'both production Recent tables are required for real Files navigation')
  assert.ok(meta.includes('func (FileRecentFolderAccess) TableName() string { return "xd_file_recent_folder_access" }'))
  assert.ok(go.includes('"/api/v1/file-recent-folders?limit=8"') &&
    go.includes('token, nil, http.StatusOK'),
    'run the actual authorized Gin/PG Recent-folder read, never a stub')
  assert.ok(workflow.includes("'internal/api/gallery_real_web_cold_performance_integration_test.go'"))
  assert.ok(!workflow.includes('continue-on-error') &&
    !workflow.includes('|| true'), 'do not waive the frozen baseline/real H264 n3 gate')
})

test('historical baseline scroll drift is exposed, never counted as candidate Viewer return success', () => {
  const runner = read('desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs')
  const workflow = read('.github/workflows/viewer-first-frame-paired-h264.yml')
  assert.ok(runner.includes("XD_VIEWER_FF_BASELINE_RETURN_AUDIT === '1'"))
  assert.ok(runner.includes('allowHistoricalBaselineDrift?96:2'),
    'strict candidate anchor tolerance must remain 2 px')
  assert.ok(runner.includes('baselineScrollDrift:measuredScrollDelta>2'))
  assert.ok(runner.includes('passed:returned.scrollRestored===true'),
    'baseline return mismatch must be reported as failed UX')
  assert.ok(runner.includes('historicalReturnEvidence:historicalBaselineReturnAudit'))
  assert.ok(workflow.includes('export XD_VIEWER_FF_BASELINE_RETURN_AUDIT=1'))
  assert.ok(workflow.includes('unset XD_VIEWER_FF_BASELINE_RETURN_AUDIT'))
  const before=evidence([120,180,240])
  const after=evidence([130,170,210])
  before.historicalBaselineReturnAudit=true
  before.viewerReturnsFullyPassed=false
  before.historicalReturnEvidence=Array.from({length:3},()=>({
    jpegScrollDeltaPx:57, jpegRestored:false,
    h264ScrollDeltaPx:57, h264Restored:false,
  }))
  before.samples[1].p1H264Frames.passed=false
  before.samples[1].p1H264Frames.genuinePresentedFrames=true
  before.samples[1].p1H264Frames.baselineReturnDrift=true
  before.samples[1].p1H264Frames.restoredScrollDelta=57
  after.viewerReturnsFullyPassed=true
  const report=compareRealVideoFirstFrames(before,after)
  assert.equal(report.validated,true)
  assert.equal(report.baselineViewerReturnPassed,false)
  assert.equal(report.candidateViewerReturnPassed,true)
  assert.equal(report.baselineReturnEvidence[1].h264ScrollDeltaPx,57)
  after.viewerReturnsFullyPassed=false
  assert.throws(()=>compareRealVideoFirstFrames(before,after), /candidate.*Viewer return failure/)
  after.viewerReturnsFullyPassed=true
  before.samples[1].p1H264Frames.restoredScrollDelta=150
  assert.throws(()=>compareRealVideoFirstFrames(before,after), /sample 1 invalid/)
})


test('real n3 H264 summary persists measured sanitized sample proof for the strict comparator', () => {
  const runner = read('desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs')
  const comparator = read('desktop/scripts/viewer-first-frame-compare.cjs')
  const summaryStart = runner.indexOf('const worst = rows.map(')
  const summaryEnd = runner.indexOf("fs.writeFileSync(path.join(out, 'summary.json')", summaryStart)
  assert.ok(summaryStart >= 0 && summaryEnd > summaryStart)
  const summary = runner.slice(summaryStart, summaryEnd)
  assert.match(summary, /samples: videoFirstFrameMode \? rows\.map\(row => \(\{/)
  for (const field of [
    'passed', 'genuinePresentedFrames', 'baselineReturnDrift', 'restoredScrollDelta',
    'ready', 'actualSignedVideo', 'firstFrameMs', 'urlMs', 'metadataMs',
    'loadedDataMs', 'rangeTTFBMs', 'navigationVisible',
    'videoWidth', 'videoHeight', 'presentedFrames',
  ]) assert.ok(summary.includes(field + ': row.p1H264Frames.'),
    'n3 compositor proof missing: ' + field)
  assert.ok(comparator.includes('Array.isArray(summary.samples)') &&
    comparator.includes('summary.samples.length !== 3'),
    'do not relax the independent n3/n3 benchmark admission')
  assert.ok(!summary.includes('certificatePEM') &&
    !summary.includes('signedURL:') &&
    !summary.includes('currentSrc:'),
    'timing JSON must never persist an Owner-scoped signed media URL')
})

test('paired first-frame summary serializes all three genuine rows, not medians alone', () => {
  const runner = read('desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs')
  const comparator = read('desktop/scripts/viewer-first-frame-compare.cjs')
  assert.ok(runner.includes('samples: videoFirstFrameMode ? rows.map(row => ({'),
    'summary must project genuine H264 measurements into a bounded numeric sample schema')
  // The runner also writes a separate P1P physical workload summary.
  // Audit only the signed first-frame benchmark's own summary object:
  // its raw samples must never leak into the n3/n3 published artifact.
  const summaryStart = runner.indexOf('const worst = rows.map(')
  const summaryEnd = runner.indexOf("fs.writeFileSync(path.join(out, 'summary.json')", summaryStart)
  const summary = runner.slice(summaryStart, summaryEnd)
  assert.ok(!summary.includes('samples:rows') && !summary.includes('samples: rows,'),
    'do not serialize raw workload/process/identity rows into public first-frame artifacts')
  assert.equal((summary.match(/^\s+samples:/gm) || []).length, 1,
    'summary must contain exactly one H264 samples property, with no shadowed raw field')
  assert.ok(runner.includes("fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2)"),
    'the actual persisted summary must contain the same owner-verified samples')
  assert.ok(comparator.includes('summary.samples.length !== 3'),
    'never silently replace missing real samples with p50-only aggregates')
  const complete = evidence([140, 160, 180])
  assert.equal(compareRealVideoFirstFrames(complete, complete).sampleCountEach, 3)
  const aggregateOnly = { ...complete, samples: undefined }
  assert.throws(() => compareRealVideoFirstFrames(aggregateOnly, complete), /baseline: real H264 n3 gate missing/)
  assert.throws(() => compareRealVideoFirstFrames(complete, aggregateOnly), /candidate: real H264 n3 gate missing/)
})
