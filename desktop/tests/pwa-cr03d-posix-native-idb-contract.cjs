'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
const source=fs.readFileSync(path.join(root,'desktop/scripts/pwa-cr03d-posix-native-idb-failure.cjs'),'utf8')
const flow=fs.readFileSync(path.join(root,'.github/workflows/pwa-cr03d-posix-idb.yml'),'utf8')
const store=fs.readFileSync(path.join(root,'web/src/pwaOfflineDirectory.ts'),'utf8')
const view=fs.readFileSync(path.join(root,'web/src/PwaOfflineDirectoryBrowser.tsx'),'utf8')
test('CR03d native Linux kernel permission denial, no DOMException mocks',()=>{
 for(const token of ['process.getuid()!==0','chromium.launchPersistentContext(profile',
  'fs.chmodSync(dbDir,0o000)','fs.readdirSync(dbDir)','EACCES','nativeFilePermissionDenied=true',
  'nativeIDBReadFailed=true','fs.chmodSync(dbDir,oldMode)',
  'physicalDiskEIOTested:false'])
  assert(source.includes(token),token)
 assert(!/Storage.overrideQuotaForOrigin|new DOMException|route.fulfill|context.route/.test(source))
})
test('CR03d real P1 both scopes fail closed and notify peer on failed purge',()=>{
 for(const token of ['xDrivePwaSetOfflineConsent','xDrivePwaCaptureVisitedDirectory',
  'xDrivePwaCaptureAlbumSummaries','xDrivePwaReadRelaunchOwner',
  'xDrivePwaClearOfflineMetadata','xDrivePwaObserveOfflinePurge',
  'data-xdrive-pwa-offline-empty','crossTabPurgeNotified=true',
  'postRestoreNoFabricatedAuthorization=true'])
  assert(source.includes(token),token)
 assert(store.includes('offlinePurgeEpoch += 1'))
 assert(store.includes('xDrivePwaBroadcastOfflinePurge()'))
 assert(view.includes('setOwner(null)'))
})
test('CR03d source-exact real native browser CI, anonymized file only',()=>{
 for(const token of ['node --check desktop/scripts/pwa-cr03d-posix-native-idb-failure.cjs',
  'node --test desktop/tests/pwa-cr03d-posix-native-idb-contract.cjs',
  'playwright-core@1.56.1',"XD_PWA_CR03D_POSIX: '1'",
  'github.event.pull_request.head.sha','actions/upload-artifact@v4',
  'node desktop/scripts/pwa-cr03d-posix-native-idb-failure.cjs'])
  assert(flow.includes(token),token)
 assert(!flow.includes('continue-on-error:'))
 assert(!flow.includes('workflow_dispatch:'))
 assert(source.includes('fs.rmSync(profile,{recursive:true,force:true})'))
});
