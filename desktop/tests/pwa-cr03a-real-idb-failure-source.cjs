'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const read=p=>fs.readFileSync(path.resolve(__dirname,'../..',p),'utf8')
const driver=read('desktop/scripts/pwa-cr03a-real-idb-failure.cjs')
const workflow=read('.github/workflows/pwa-cr03a-real-idb-failure.yml')
const product=read('web/src/pwaOfflineDirectory.ts')
const worker=read('assets/icon/web/sw.js')
test('CR03a uses native browser, real IDB, production SW and explicit non-Go limits',()=>{
 for(const token of [
   'chromium.launchPersistentContext(profile','await navigator.serviceWorker.ready',
   'indexedDB.open(','indexedDB.deleteDatabase(',
   'xDrivePwaCaptureVisitedDirectory','xDrivePwaCaptureAlbumSummaries',
   "await page.goto(origin+'/#/offline/files'",
   'summary.expiredSnapshotRejected=true','summary.corruptSchemaRejected=true',
   'summary.evictionClearedHistory=true','summary.crossProcessNoResurrection=true',
   'summary.publicSWPrivateCacheAbsent=true'
 ]) assert(driver.includes(token),token)
 assert(driver.includes('actualGoACL:false'))
 assert(driver.includes('quotaExceededTested:false'))
 assert(driver.includes('actualNetwork429503Tested:false'))
 assert.doesNotMatch(driver,/route\.fulfill|context\.route|skipWaiting\(\)/)
 assert(product.includes('XDRIVE_PWA_OFFLINE_MAX_AGE_MS'))
 assert(product.includes("new BroadcastChannel('xdrive-pwa-offline-purge')"))
 assert(!/caches\.open\(/.test(product))
 assert(!/self\.skipWaiting\s*\(/.test(worker))
})
test('source-exact dedicated CI and anonymous results only',()=>{
 for(const token of [
   "github.head_ref == 'test/pwa-cr03a-real-idb-failures-20261022'",
   'github.event.pull_request.head.sha',
   'playwright-core@1.56.1','npm --prefix web run build',
   'node --test desktop/tests/pwa-cr03a-real-idb-failure-source.cjs',
   'desktop/scripts/pwa-cr03a-real-idb-failure.cjs',
   'desktop/pwa-cr03a-results/summary.json'
 ]) assert(workflow.includes(token),token)
 assert(!workflow.includes('continue-on-error:'))
 assert(!workflow.includes('private-go-A.log'))
 assert(!workflow.includes('browser-profile'))
 assert(driver.includes('performanceAfter:false'))
})
