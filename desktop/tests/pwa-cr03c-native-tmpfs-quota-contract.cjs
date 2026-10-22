'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
const source=fs.readFileSync(path.join(root,'desktop/scripts/pwa-cr03c-native-tmpfs-quota.cjs'),'utf8')
const workflow=fs.readFileSync(path.join(root,'.github/workflows/pwa-cr03c-native-tmpfs-quota.yml'),'utf8')
test('real Chrome native Origin quota with >=32MiB OS headroom; never fake QuotaExceeded',()=>{
 for(const token of ['chromium.launchPersistentContext(profile','fs.statfsSync(mount)', 'crypto.getRandomValues(result.subarray(',
 'exhaustNativeOriginQuota(page)', 'browserNativeWrite(page,ordinal,bytes)','native.name','QuotaExceededError',
 'xDrivePwaCaptureVisitedDirectory(owner','xDrivePwaReadOfflineDirectories(owner)',
 'summary.productRejected','summary.oldHistoryIntact'])
 assert(source.includes(token),token)
 assert(!/Storage.overrideQuotaForOrigin|new DOMException|route.fulfill|context.route/.test(source))
})
test('bounded native tmpfs GitHub runner must fail RED if quota unsupported',()=>{
 for(const token of ["sudo mount -t tmpfs -o size=2048m,mode=0700,nodev,nosuid",
 'mountpoint -q','sudo umount','github.event.pull_request.head.sha',
 'playwright-core@1.56.1','node desktop/scripts/pwa-cr03c-native-tmpfs-quota.cjs',
 "s.nativeError!=='QuotaExceededError'"])
 assert(workflow.includes(token),token)
 assert(!workflow.includes('continue-on-error:'))
 assert(workflow.includes('summary.json'))
})
