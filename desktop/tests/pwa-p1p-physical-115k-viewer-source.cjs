'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const driver = read('desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs')
const fixture = read('internal/api/gallery_real_web_cold_performance_integration_test.go')
const corpus = read('internal/api/gallery_physical_mixed_first_visible_100k_performance_test.go')
const workflow = read('.github/workflows/pwa-p1p-physical-115k-viewer.yml')

test('P1P runs genuine authenticated 390px routed Gallery/Viewer/Back on all 115k existing CAS objects', () => {
  for (const marker of [
    "XD_PWA_P1_PHYSICAL_115K_VIEWER === '1'",
    "XD_GALLERY_WEB_PHYSICAL_MIXED_VIEWPORT_100K_PERF: physicalP1Mode ? '1' : '0'",
    "XD_GALLERY_REAL_VIEWPORT_CANCEL_PERF: physicalP1Mode ? '0' : '1'",
    'bootOriginalAuthenticatedApp(win, fixture.config.url)',
    'p1MeasureRealViewerBack(win)',
    'p1MeasureRealH264ViewerMotion(win)',
    'p1MeasureLivePhotoHold(win)',
    'fixture.config.physical_sources, 115000',
    'fixture.config.physical_verified, 12',
    "row.physicalReadbacks===12", "row.physicalOriginals===115000",
    "p50H264PresentedMs", "p50LiveHeldMs",
    "causalConclusion:'NOT_ESTABLISHED'",
    'resources.renderer.rssGrowthBytes<=256*1024*1024',
    "assert(accepted,'actual 115k physical Owner JPEG/H264/Live Viewer lifecycle failed')",
  ]) assert.ok(driver.includes(marker), 'missing P1P physical source gate: '+marker)
  assert.ok(!driver.includes('physicalP1Mode ? \'physical iPhone\''), 'test may not claim installed Safari')
})
test('P1P preserves original physical CAS/Live pairs and keeps old signed Range/160ms test independent', () => {
  for (const marker of [
    'gallerySeedRealPhysicalMixed100K(', 'galleryPhysicalMixedViewportIDs(',
    'headImages, headVideos, headLive = galleryPhysicalMixedViewportIDs(t, earliest.Items)',
    'headImages, headVideos, headLive = galleryFirstVisibleSeedObjects(',
    'physicalReport.LiveMotions != mediaGalleryFirstOpenLivePhotos',
    'P1P_LIVE_PHYSICAL_CAS_READY',
    'XD_PWA_P1_PHYSICAL_115K_VIEWER',
    'physicalViewportMode && os.Getenv("XD_GALLERY_REAL_VIEWPORT_CANCEL_PERF") == "1"',
    'p1ViewerVideoRangeProbe.serve(w, r, router)',
  ]) assert.ok(fixture.includes(marker), 'fixture must protect original semantics: '+marker)
  for (const marker of ['mediaGalleryFirstOpenPhysical','115k','PhotoResource','MotionPairs']) {
    assert.ok(corpus.includes(marker), 'existing physical corpus contract missing: '+marker)
  }
})
test('P1P exact source workflow runs a separate native n3 job, retaining RED failures and private credentials', () => {
  for (const marker of [
    "github.head_ref == 'test/pwa-p1p-physical-115k-viewer-20261027'",
    "XD_PWA_P1_PHYSICAL_115K_VIEWER: '1'",
    "XD_PWA_P0C2_SPA_BEFORE: '1'",
    "XD_PWA_P1_100K_VIEWER_BACK: '1'",
    "XD_PWA_P1_H264_VIEWER_FRAME: '1'",
    "XD_PWA_P1_LIVE_MOTION_HOLD: '1'",
    'postgres:17-alpine', 'go test -c -o', 'xvfb-run',
    "node --test desktop/tests/pwa-p1p-physical-115k-viewer-source.cjs",
    "s.accepted && s.n===3", 'retention-days: 14',
  ]) assert.ok(workflow.includes(marker), 'P1P CI evidence missing: '+marker)
  assert.ok(!workflow.includes('continue-on-error: true'))
})
