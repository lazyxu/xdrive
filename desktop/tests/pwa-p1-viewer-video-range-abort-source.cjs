'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=x=>fs.readFileSync(path.join(root,x),'utf8')
const script=read('desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs')
const fixture=read('internal/api/gallery_real_web_cold_performance_integration_test.go')
const go=read('internal/api/pwa_p1_viewer_video_range_cancel_fixture_test.go')
const flow=read('.github/workflows/pwa-p1-viewer-video-range-abort.yml')
test('P1-D test fixture adds bounded decodable signed original H264 CAS bytes only for real video nodes',()=>{
  for(const tag of [
    'galleryFirstVisibleVideoMP4Base64',
    '"free"',
    'storage.ContentAddressedKey(digest)',
    'store.Put(t.Context(), key, bytes.NewReader(source))',
    'db.Model(&meta.File{})',
    'db.Model(&meta.MediaMetadata{})',
    'db.Model(&meta.PhotoResource{})',
    'pwaP1ViewerVideoRangeProbe',
    'r.Method != http.MethodGet',
    'r.URL.Query().Has("ticket")',
    'strings.HasPrefix(r.Header.Get("Range"), "bytes=")',
    '"partial_content"',
    '"signed_range"',
    '"signed_no_range"',
    'rangeRequest := strings.HasPrefix(r.Header.Get("Range"), "bytes=")',
    '"context_done"',
    '"max_cancel_us"',
    'w.ctx.Done()',
  ])assert.ok(go.includes(tag),'missing genuine signed original Go fixture: '+tag)
  for(const tag of [
    'XD_PWA_P1_VIEWER_VIDEO_RANGE_CANCEL',
    'pwaP1SeedSlowOriginalH264Videos',
    'p1ViewerVideoRangeProbe.serve(w, r, router)',
    'p1ViewerVideoRangeProbe.matches(r)',
    '/__perf/viewer-video-range-stats',
    '/__perf/viewer-video-range-enable',
    '/__perf/viewer-video-range-mark',
  ])assert.ok(fixture.includes(tag),'missing real authenticated Gin probe: '+tag)
})
test('P1-D uses native existing Viewer Back instead of synthetic cancellation or mocked signed requests',()=>{
  for(const tag of [
    "XD_PWA_P1_VIEWER_VIDEO_RANGE_CANCEL === '1'",
    'p1MeasureRealViewerRangeAbort(win,fixture.config.url)',
    'p1VisibleH264Tile.toString()',
    'p1OriginalSignedVideoElement.toString()',
    'source.searchParams.has(\'ticket\')',
    'p1BackPoint.toString()',
    'p1ReturnedToCaller.toString()',
    'sendActualPointer(win,tile)',
    'sendActualPointer(win,back)',
    'p1ViewerVideoProbeStats(base)',
    'P1D_SANITIZED_RANGE_DIAGNOSTIC',
    'stats.signed_range>=1',
    'after.context_done>=1',
    'after.cancelled>=1',
    'after.max_cancel_us<=160000',
    'after.emitted_bytes===markStats.mark_emitted_bytes',
    'stillActiveAt160Ms:after.active',
    'row.p1ViewerRangeAbort.wastedBytesAfterViewerBack===0',
    'row.go.worstContextNotificationMs <= 160',
  ])assert.ok(script.includes(tag),'missing real Viewer Range Go cancel check: '+tag)
  assert.ok(!script.includes('context.route(')&&!script.includes('route.fulfill('))
  assert.ok(!script.includes('window.location.hash ='))
})
test('P1-D preserves original P0C2, Owner JPEG, signed H264 and real held Live with n3 Go/PG17/Chromium',()=>{
  for(const tag of [
    'postgres:17-alpine',
    "XD_PWA_P0C2_SPA_BEFORE: '1'",
    "XD_PWA_P1_100K_VIEWER_BACK: '1'",
    "XD_PWA_P1_H264_VIEWER_FRAME: '1'",
    "XD_PWA_P1_LIVE_MOTION_HOLD: '1'",
    "XD_PWA_P1_VIEWER_VIDEO_RANGE_CANCEL: '1'",
    "github.head_ref == 'test/pwa-p1-viewer-video-range-abort-20261025'",
    'go test -c -o',
    'xvfb-run',
    'pwa-p0c2b2-real-spa-go-source.cjs',
    'pwa-p1-owner-100k-viewer-back-source.cjs',
    'pwa-p1-h264-presented-motion-source.cjs',
    'pwa-p1-live-motion-hold-source.cjs',
    'pwa-p1-viewer-video-range-abort-source.cjs',
    'p1ViewerVideoAbortMode',
    'p1ViewerRangeGoMaxMs',
    'media-preview-stream-teardown.cjs',
  ])assert.ok(flow.includes(tag),'missing exact-head source CI gate: '+tag)
});
