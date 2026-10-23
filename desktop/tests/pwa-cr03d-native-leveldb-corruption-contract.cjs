'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const source=read('desktop/scripts/pwa-cr03d-native-leveldb-corruption.cjs')
const flow=read('.github/workflows/pwa-cr03d-native-leveldb-corruption.yml')
const product=read('web/src/pwaOfflineDirectory.ts')
const offline=read('web/src/PwaOfflineDirectoryBrowser.tsx')
test('CR03d makes true OS LevelDB manifest-pointer file corrupt only after Chrome closes',()=>{
 for(const k of ['chromium.launchPersistentContext(profile',
  'report.allProcessesClosedDuringCorruption=true','fs.lstatSync(current)',
  "fs.openSync(current,'r+')",'fs.fsyncSync(fd)',
  'report.realLevelDBCurrentCorrupted=true',
  'fs.rmSync(tmp,{recursive:true,force:true})'])
  assert(source.includes(k),k)
 assert(!/context\.route\(|route\.fulfill\(|new DOMException\(|Storage\.overrideQuotaForOrigin/.test(source))
})
test('CR03d requires positive native cold-reopen control before real corruption',()=>{
 for(const k of ['await store.xDrivePwaSetOfflineConsent(owner,true)',
  'await store.xDrivePwaCaptureVisitedDirectory(owner',
  'await store.xDrivePwaCaptureAlbumSummaries(owner',
  'report.positiveColdRestart=true',
  "['historical','empty'].includes(report.corruptionOutcome)",
  "anonymous:!(localStorage.getItem('xdrive.access_token')||'')",
  'report.offlineHistoryNeverAuthorized=damaged.noLive&&damaged.anonymous',
  'report.secondCorruptColdLaunch=true'])
  assert(source.includes(k),k)
 assert(product.includes('openDatabase(): Promise<IDBDatabase>'))
 assert(offline.includes('未经当前权限验证'))
 assert(offline.includes("setVerification('unavailable')"))
})
test('CR03d CI is 4 real browser processes, exact-head and never exports the profile',()=>{
 for(const k of ['test/pwa-cr03d-native-leveldb-corrupt-20261023',
  'github.event.pull_request.head.sha',
  'playwright-core@1.56.1',
  'node --check desktop/scripts/pwa-cr03d-native-leveldb-corruption.cjs',
  'node --test desktop/tests/pwa-cr03d-native-leveldb-corruption-contract.cjs',
  'XDRIVE_BROWSER_EXECUTABLE',
  'actions/upload-artifact@v4',
  'desktop/pwa-cr03d-results/summary.json'])
  assert(flow.includes(k),k)
 assert(!flow.includes('continue-on-error:'))
 assert(!flow.includes('workflow_dispatch:'))
 assert(!flow.includes('private-profile'))
})
