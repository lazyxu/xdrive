'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=name=>fs.readFileSync(path.join(root,name),'utf8')
const run=read('desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs')
const flow=read('.github/workflows/pwa-p1-live-motion-hold.yml')
const fixture=read('internal/api/gallery_real_web_cold_performance_integration_test.go')
const seed=read('internal/api/pwa_p1_live_motion_fixture_test.go')
const live=read('ui/shared/src/mui/LivePhotoSurface.tsx')
test('P1-C uses actual existing Owner Live Photo pairs and bounded H264 CAS bytes only in opt-in fixture',()=>{
 for(const k of [
  'XD_PWA_P1_LIVE_MOTION_HOLD',
  'pwaP1SeedLiveMotionForTail',
  'ownerRoot.OwnerID, folder.ID, viewport',
 ])assert.ok(fixture.includes(k))
 for(const k of [
  'galleryFirstVisibleVideoMP4Base64',
  'storage.ContentAddressedKey(hash)',
  'store.Put(t.Context(), key, bytes.NewReader(bytesMP4))',
  'PhotoAssetKindLivePhoto',
  'live-motion-',
  'db.Model(&meta.File{})',
  'db.Model(&meta.MediaMetadata{})',
  'db.Model(&meta.PhotoResource{})',
  '"mime_type": "video/mp4"',
 ])assert.ok(seed.includes(k),'missing real Live CAS: '+k)
})
test('P1-C production shared LivePhotoSurface remains real hold/release/abort and first frame gated',()=>{
 for(const k of [
  'requestVideoFrameCallback',
  'onPointerDown={handlePointerDown}',
  'onPointerUp={handlePointerRelease}',
  'onPointerCancel={cancelTouchGesture}',
  'const beginHold = useCallback',
  'const endHold = useCallback',
  'stopPlayback()',
  'preload={holdActiveRef.current && stillReady',
 ])assert.ok(live.includes(k))
 for(const k of [
  "XD_PWA_P1_LIVE_MOTION_HOLD === '1'",
  'p1VisibleLivePhotoTile',
  'p1StartLiveVideoFrameObservation',
  'p1LiveMotionFrameStatus',
  "signed.origin!==location.origin",
  "signed.searchParams.has('ticket')",
  "media-live-photo-motion",
  'p1LiveReleasedStatus',
  "win.webContents.sendInputEvent({type:'mouseDown'",
  "win.webContents.sendInputEvent({type:'mouseUp'",
  'requestVideoFrameCallback(frame)',
  "metadata.mediaTime>last.time+0.001",
  "surface.getAttribute('aria-pressed')!=='true'",
  "!video.paused",
  "p1LiveMotion = p1LiveMode ? await p1MeasureLivePhotoHold(win) : null",
  'p1LiveMotion.restoredScrollDelta<=2',
  'row.go.worstContextNotificationMs <= 160',
 ])assert.ok(run.includes(k),'missing browser real Live hold: '+k)
 assert.ok(!run.includes('context.route(')&&!run.includes('route.fulfill('))
})
test('P1-C stacked genuine Go/PG17/CAS 390px n3 CI retains P0C2/JPEG/H264 gates',()=>{
 for(const k of [
  'postgres:17-alpine',
  'branches: [master]',
  "XD_PWA_P0C2_SPA_BEFORE: '1'",
  "XD_PWA_P1_100K_VIEWER_BACK: '1'",
  "XD_PWA_P1_H264_VIEWER_FRAME: '1'",
  "XD_PWA_P1_LIVE_MOTION_HOLD: '1'",
  'pwa-p1-owner-100k-viewer-back-source.cjs',
  'pwa-p1-h264-presented-motion-source.cjs',
  'pwa-p1-live-motion-hold-source.cjs',
  'p1LivePresentedP50Ms',
  'go test -c -o',
  'xvfb-run',
 ])assert.ok(flow.includes(k),'missing stacked Live physical CI: '+k)
 assert.ok(!flow.includes('skipWaiting'))
})
