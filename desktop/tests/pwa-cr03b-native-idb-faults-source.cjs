'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const base=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(base,p),'utf8')
const driver=read('desktop/scripts/pwa-cr03b-native-idb-faults.cjs')
const workflow=read('.github/workflows/pwa-cr03b-native-idb-faults.yml')
const store=read('web/src/pwaOfflineDirectory.ts')
const sw=read('assets/icon/web/sw.js')
test('native Chromium CDP quota and original P1 write transaction fail closed',()=>{
 for(const t of [
   'chromium.launchPersistentContext(profile',
   "cdp.send('Storage.overrideQuotaForOrigin',{origin,quotaSize:1024})",
   "cdp.send('Storage.getUsageAndQuota',{origin})",
   'quota.overrideActive===true',
   "key:'__cr03b_native_quota_probe_'+index",
   'index<4',
   'summary.nativeQuotaProbeAttempts=nativeProbe.attempts',
   'body:new Uint8Array(16*1024*1024)',
   "assert.equal(nativeProbe.reason,'QuotaExceededError'",
   'summary.quotaEnforcementUnavailable=true',
   'summary.quotaDiagnosticCompleted=true',
   'summary.quotaProbeCleanupCompleted=true',
   'summary.nativeQuotaProbeAborted=nativeProbe.aborted',
   'summary.productCaptureRejected=quotaOutcome.rejected',
   'summary.productCaptureError=',
   "assert(quotaOutcome.rejected,",
   'api.xDrivePwaCaptureVisitedDirectory(owner,',
   'summary.realQuotaExceeded=true',
   'summary.productFailClosedOnQuota=true'
 ]) assert(driver.includes(t),t)
 assert(store.includes('transaction.onabort = fail'))
 assert(store.includes('transaction.onerror = fail'))
 assert(store.includes('await openDatabase()'))
 assert.doesNotMatch(driver,/route\.fulfill\(|context\.route\(|FakeQuotaExceeded|throw new DOMException\(/)
})
test('native IDB aborted write and blocked upgrade cannot resurrect live ACL',()=>{
 for(const t of [
   'tx.abort()','tx.onabort=()=>ok',
   "request.onblocked=()=>{blocked=true",
   'holder.close()',
   "rejected=e?.name==='VersionError'",
   'summary.nativeTransactionAborted=true',
   'summary.priorSnapshotUnaffected=true',
   'summary.nativeUpgradeBlocked=true',
   'summary.productionFutureVersionRejected=true'
 ])assert(driver.includes(t),t)
 assert(driver.includes('summary.realGoOwnerACL')===false)
 assert(driver.includes('realGoOwnerACL:false'))
 assert(driver.includes('performanceAfter:false'))
 assert(!store.includes('caches.open('))
 assert(!sw.includes('self.skipWaiting('))
})
test('exact-source dedicated CI uploads only anonymous boolean summary',()=>{
 for(const t of [
   "github.head_ref == 'test/pwa-cr03b-native-idb-faults-20261022'",
   'playwright-core@1.56.1','node --check desktop/scripts/pwa-cr03b-native-idb-faults.cjs',
   'node --test desktop/tests/pwa-cr03b-native-idb-faults-source.cjs',
   'npm --prefix web run build',
   'desktop/pwa-cr03b-results/summary.json',
   'github.event.pull_request.head.sha'
 ])assert(workflow.includes(t),t)
 assert(!workflow.includes('continue-on-error:'))
 assert(!workflow.includes('browser-profile'))
 assert(!workflow.includes('private-go'))
 assert(!workflow.includes('JWT'))
})
