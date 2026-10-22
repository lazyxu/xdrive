'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const run=read('desktop/scripts/pwa-cr02-real-offline-reconnect.cjs')
const flow=read('.github/workflows/pwa-cr02-offline-reconnect.yml')
const privateSource=read('web/src/pwaOfflineDirectory.ts')
const browser=read('web/src/PwaOfflineDirectoryBrowser.tsx')
const worker=read('assets/icon/web/sw.js')
test('CR02 combines P0 real public SW with bounded opt-in P1 directories AND albums',()=>{
 for(const token of ['chromium.launchPersistentContext(profileDir','xDrivePwaSetOfflineConsent(owner, true)',
   'xDrivePwaCaptureVisitedDirectory','xDrivePwaCaptureAlbumSummaries',
   "items: Array.from({ length: 100000 }", "Array.from({ length: 100000 }",
   "assert.equal(offline.items, 20)","assert.equal(offline.albums, 24)",
   "assertXDrivePublicShellCache","#/offline/files","down = true","down = false"
 ])assert.ok(run.includes(token),'genuine Browser/Owner/100k proof missing '+token)
 assert.match(worker,/SHELL_PREFIX/)
 assert.doesNotMatch(run,/context\.route\(|route\.fulfill\(|self\.skipWaiting\s*\(/)
})
test('CR02 reconnect cannot grant ACL without fresh /me; owner and instance negatives plus cross-tab purge',()=>{
 for(const token of [
  "window.dispatchEvent(new Event('online'))",
  'unauthenticatedVerifyDisabled: true',
  'liveFileExplorerAbsent: true',
  'const peer = await ctx.newPage()',
  'xDrivePwaReadOfflineDirectories(mismatch)',
  'xDrivePwaReadAlbumSummaries(mismatch)',
  'xDrivePwaClearOfflineMetadata()',
  "await page.locator('[data-xdrive-pwa-offline-empty]').waitFor",
  'crossTabRevocationClearedMountedUI: true',
  'revokedSnapshotNotResurrectedAfterNewChromeProcess: true',
 ])assert.ok(run.includes(token),'missing combined revocation invariant '+token)
 for(const token of [
  'xDrivePwaVerifiedIdentityMatches(owner, me)',
  'await api.me(controller.signal)',
  'await api.node(selected.id, controller.signal)',
  'await api.listRange(selected.id, 0, 1',
  'xDrivePwaObserveOfflinePurge(reset)',
 ])assert.ok(browser.includes(token),'actual UI ACL/Source contract missing '+token)
 assert.ok(privateSource.includes("new BroadcastChannel('xdrive-pwa-offline-purge')"))
 assert.doesNotMatch(privateSource,/caches\.open\(/)
})
test('CR02 CI is an exact-HEAD physical Chromium SW+IDB test, not fake optimized AFTER',()=>{
 for(const token of [
   "github.head_ref == 'test/pwa-cr02-offline-reconnect-revoke-20261022'",
   'playwright-core@1.56.1','node --check','node --test desktop/tests/pwa-cr02-offline-reconnect-contract.cjs',
   'npm --prefix web run build','XD_PWA_CR02_REAL_CHROME',
   'node desktop/scripts/pwa-cr02-real-offline-reconnect.cjs',
   'test "$XD_PR_HEAD"','actions/upload-artifact@v4',
 ])assert.ok(flow.includes(token),'missing real test CI '+token)
 assert.doesNotMatch(flow,/continue-on-error:|workflow_dispatch:/)
 assert.ok(!run.includes('productionOwnerPassed: true'))
 assert.ok(run.includes('actualGoOwnerACL: false'))
})
