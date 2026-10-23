'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const go=read('internal/api/pwa_s2b3_real_gin_auth_integration_test.go')
const browser=read('desktop/scripts/pwa-cr04-inflight-revoke-waiting.cjs')
const workflow=read('.github/workflows/pwa-cr04-inflight-revoke-waiting.yml')
const ui=read('web/src/PwaOfflineDirectoryBrowser.tsx')
const store=read('web/src/pwaOfflineDirectory.ts')
const sw=read('assets/icon/web/sw.js')
test('CR04 original authenticated Go Range body really starts then waits for Context.Done',()=>{
 for(const token of ['XD_PWA_CR04_RANGE_REVOKE','pwaCR01b4PacedWriter','cr04Armed.CompareAndSwap(true, false)',
  'router.ServeHTTP(writer, request)','cr04Probe.cancelled.Load()','cr04Probe.handlerExited.Load()',
  'owner.ID, nodeID, "dir"']) assert(go.includes(token),token)
 assert(browser.includes('Network.dataReceived'))
 assert(browser.includes('rangeChromeBytes>0'))
 assert(browser.includes('genuineGoRangeStillInFlight=true'))
})
test('CR04 same native session uses production P1 peer purge and real waiting SW',()=>{
 for(const token of ['chromium.launchPersistentContext(profile','await ctx.setOffline(true)',
  'await hist.locator(\'[data-xdrive-pwa-offline-verify]\').click()',
  'await peer.getByRole(\'menuitem\',{name:\'退出登录\'}).click()',
  'registration.update()','registration.waiting','await cr04Proof()',
  'await deleteLiveFolder(peer,folder.folderID,folder.folderRevision)',
  'await waitNode404(peer,folder.folderID)',
  'summary.realGoFolderRevokedInFlight=true',
  "await peer.locator('[data-xdrive-mobile-app-navigation-trigger]').click()",
  'summary.thirdColdNoResurrection=true'])assert(browser.includes(token),token)
 for(const token of ['validationController.current?.abort()','xDrivePwaObserveOfflinePurge(reset)',
  'current !== sequence.current','await api.listRange(selected.id, 0, 1'])
  assert(ui.includes(token),token)
 assert(store.includes('offlinePurgeEpoch += 1'))
 assert(!store.includes('caches.open('))
 assert(!sw.includes('self.skipWaiting('))
 assert(!browser.includes('context.route('))
 assert(!browser.includes('route.fulfill('))
})
test('CR04 opt-in only, source-exact CI with actual PG17/CAS/Chrome, no privileged artifacts',()=>{
 for(const token of ['postgres:17-alpine','go test -c','XD_PWA_CR04_RANGE_REVOKE=1',
 'github.event.pull_request.head.sha','node --check desktop/scripts/pwa-cr04-inflight-revoke-waiting.cjs',
 'node --test desktop/tests/pwa-cr04-inflight-revoke-waiting-contract.cjs',
 'playwright-core@1.56.1','pwa-cr04-results/summary.json',
 'actions/upload-artifact@v4'])assert(workflow.includes(token),token)
 assert(!workflow.includes('continue-on-error:'))
 assert(!workflow.includes('workflow_dispatch:'))
 assert(!workflow.includes('private-gin.log\n          if-no-files-found'))
 assert(browser.includes('ownerJWTInArtifact:false'))
 assert(browser.includes('physicalIOS:false'))
 assert(browser.includes('PWA_CR04_SAFE_WATCHDOG'))
})
