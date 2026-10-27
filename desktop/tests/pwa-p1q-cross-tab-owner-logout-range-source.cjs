'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const d=read('desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs')
test('P1Q authentic second Owner window invokes real Logout and cancels first signed Range',()=>{
  for(const text of [
    "process.env.XD_PWA_P1Q_CROSS_TAB_LOGOUT_VIDEO_RANGE === '1'",
    'p1ViewerVideoAbortMode && p0c2SPAMode',
    'await bootOriginalAuthenticatedApp(auditor,base)',
    "await switchActualApp(auditor,'文件','files')",
    "await switchActualApp(win,'图库','gallery')",
    'const warmJPEG=await p1MeasureRealViewerBack(win)',
    'const warmH264=await p1MeasureRealH264ViewerMotion(win)',
    "visibleButtonCenter(auditor,'打开应用导航')",
    "second window mounted real account navigation drawer",
    'p1OriginalSignedVideoElement.toString()',
    'p1VisibleH264Tile.toString()',
    "await fetch(base+'/__perf/viewer-video-range-mark'",
    'sendActualPointer(auditor,logout)',
    'browser.loginMounted','!browser.hasOwnerSession',
    'stable.started===after.started',
    'stable.emitted_bytes===mark.mark_emitted_bytes',
  ])assert.ok(d.includes(text),'missing real Owner lifecycle contract: '+text)
  const p1qStart=d.indexOf('async function p1MeasureRealCrossTabViewerLogout')
  const p1qEnd=d.indexOf('async function sampleOnce',p1qStart)
  const p1q=d.slice(p1qStart,p1qEnd)
  assert.ok(p1qStart>0&&p1qEnd>p1qStart)
  assert.ok(p1q.indexOf('const warmJPEG=await p1MeasureRealViewerBack(win)') <
    p1q.indexOf('const warmH264=await p1MeasureRealH264ViewerMotion(win)'))
  assert.ok(p1q.indexOf('const warmH264=await p1MeasureRealH264ViewerMotion(win)') <
    p1q.indexOf("await fetch(base+'/__perf/viewer-video-range-enable'"),
    'genuine deep JPEG/H264 frame and return anchor must precede the Go Range probe')
  assert.doesNotMatch(p1q,/p1RestoreDeepVideoViewport\.toString\(\)/,
    'P1Q must not discard the real H264 Viewer Back scroll anchor')
  assert.match(d,/p1QAccountButtonPoint\.toString\(\)/)
  assert.match(d,/after\.max_cancel_us<=160000/)
  assert.match(d,/after\.active===0/)
  assert.match(d,/after\.emitted_bytes===mark\.mark_emitted_bytes/)
  assert.doesNotMatch(d,/BroadcastChannel\('xdrive\.auth\.events'\)\.postMessage/)
  const app=read('web/src/App.tsx')
  assert.match(app,/broadcastXDriveAuthEvent\('logout', username\)/)
  assert.match(app,/clearSession\('另一窗口已退出登录。'\)/)
  const menu=read('ui/shared/src/mui/AccountChrome.tsx')
  assert.match(menu,/aria-label="账户菜单"/)
  assert.match(menu,/logoutLabel = '退出登录'/)
  assert.match(read('internal/api/pwa_p1_viewer_video_range_cancel_fixture_test.go'),/ctx\.Done\(\)/)
})
test('P1Q is opt-in; P1D Back/160ms and independent P1P physical data remain intact',()=>{
  assert.match(d,/!p1CrossTabLogoutMode \|\| \(p1ViewerVideoAbortMode && p0c2SPAMode &&/)
  assert.match(d,/p1CrossTabLogoutMode \? 'pwa-p1q-cross-tab-owner-logout-range-results'/)
  assert.match(d,/if\(p1CrossTabLogoutMode\)\{\s*const ownerLogout=/)
  assert.match(d,/const p1ViewerRangeAbort = p1ViewerVideoAbortMode \? await p1MeasureRealViewerRangeAbort/)
  assert.match(d,/if \(physicalP1Mode\) \{\s*const median = key =>/)
  assert.match(d,/rows\.length===3&&rows\.every/)
  assert.match(d,/causalConclusion:'NOT_ESTABLISHED'/)
  assert.match(d,/actualServerRevocationVerified:false,realIOSSafari:false/)
})
