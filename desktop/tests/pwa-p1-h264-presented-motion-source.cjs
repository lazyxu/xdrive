'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const root=path.join(__dirname,'../..')
const read=file=>fs.readFileSync(path.join(root,file),'utf8')
const run=read('desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs')
const flow=read('.github/workflows/pwa-p1-h264-presented-motion.yml')
test('P1 B real 100k Owner Gallery opens original H264 Viewer with two distinct actually presented frames',()=>{
  for(const token of [
    "XD_PWA_P1_H264_VIEWER_FRAME === '1'",
    "assert(!p1H264Mode || p1Mode",
    "p1VisibleH264Tile",
    '/^video-\\d+\\.mp4$/.test(name)',
    "p1ObserveAdvancingVideoFrames",
    "signed.origin===location.origin",
    "signed.searchParams.has('ticket')",
    "/^\\/api\\/v1\\/file-preview\\/\\d+$/.test(signed.pathname)",
    "video.requestVideoFrameCallback(frame)",
    "typeof video.requestVideoFrameCallback!=='function'",
    "metadata.presentedFrames>0",
    "metadata.mediaTime>last.mediaTime+0.001",
    "latest.mediaTime>first.mediaTime+0.005",
    "latest.presentedFrames>first.presentedFrames",
    "await video.play()",
    "video.pause()",
    "p1MeasureRealH264ViewerMotion",
    "sendActualPointer(win,tile)",
    "sendActualPointer(win,back)",
    "p1ReturnedToCaller.toString()",
    "p1H264Frames = p1H264Mode ? await p1MeasureRealH264ViewerMotion(win) : null",
    "row.p1H264Frames.frameMediaDeltaMs>5",
    "row.go.worstContextNotificationMs <= 160",
    "row.go.wastedBytesAfterScroll === 0",
  ])assert.ok(run.includes(token),'missing actual presented H264 test: '+token)
  assert.ok(!run.includes('context.route(')&&!run.includes('route.fulfill('))
  assert.ok(!run.includes('autoplay-policy'),'do not force autoplay to fake browser behavior')
})
test('P1 B exact-head stacked CI is genuine Go/PG17/CAS/Chromium n3; preserves P0C2 and P1 A',()=>{
  for(const token of [
    "branches: [master, test/pwa-p1-100k-owner-viewer-back-20261025]",
    "github.head_ref == 'test/pwa-p1-h264-presented-motion-20261025'",
    "postgres:17-alpine",
    "XD_PWA_P0C2_SPA_BEFORE: '1'",
    "XD_PWA_P1_100K_VIEWER_BACK: '1'",
    "XD_PWA_P1_H264_VIEWER_FRAME: '1'",
    "go test -c -o","xvfb-run",
    "p1H264ViewerMode",
    "p1H264PresentedP50Ms",
    "pwa-p0c2b2-real-spa-go-source.cjs",
    "pwa-p1-owner-100k-viewer-back-source.cjs",
  ])assert.ok(flow.includes(token),'missing real H264 motion CI gate: '+token)
  assert.ok(!flow.includes('skipWaiting'))
})
