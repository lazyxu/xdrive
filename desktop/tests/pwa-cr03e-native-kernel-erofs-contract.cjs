'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const source=read('desktop/scripts/pwa-cr03e-native-kernel-erofs.cjs')
const ci=read('.github/workflows/pwa-cr03e-native-kernel-erofs.yml')
const store=read('web/src/pwaOfflineDirectory.ts')
test('real kernel EROFS on browser IndexedDB, no simulated storage errors',()=>{
 for(const s of [
  'fs.statSync(profile).dev!==fs.statSync(dbDir).dev',
  "spawnSync('sudo',['mount','-o','remount,'+mode,dbDir]",
  "assert.equal(errno,'EROFS'","chromium.launchPersistentContext(profile",
  'xDrivePwaCaptureVisitedDirectory','xDrivePwaClearOfflineMetadata',
  'window.__eroPeerPurge===true','summary.postRestoreNoNewRow=true'
 ])assert(source.includes(s),s)
 assert(!/new DOMException|Storage\.overrideQuotaForOrigin|route\.fulfill|context\.route|fs\.chmodSync/.test(source))
})
test('P1 rejects failed transactions and broadcasts peer purge even on failure',()=>{
 for(const s of [
  'database.transaction(STORE_NAME, mode)','transaction.onabort = fail',
  "await withStore<void>('readwrite'",'.finally(() => {',
  "new BroadcastChannel('xdrive-pwa-offline-purge')",
  'offlinePurgeEpoch += 1'
 ])assert(store.includes(s),s)
 assert(!store.includes('caches.open('))
})
test('isolated exact-HEAD Linux tmpfs, cleanup and sanitized artifact',()=>{
 for(const s of [
  'test/pwa-cr03e-real-kernel-erofs-20261023',
  'github.event.pull_request.head.sha',
  'sudo mount -t tmpfs -o size=128m,mode=0700,nodev,nosuid',
  'mountpoint -q "$MOUNT"','sudo umount "$MOUNT"',
  'node --check desktop/scripts/pwa-cr03e-native-kernel-erofs.cjs',
  'node --test desktop/tests/pwa-cr03e-native-kernel-erofs-contract.cjs',
  'playwright-core@1.56.1','actions/upload-artifact@v4',
  'pwa-cr03e-results/summary.json'
 ])assert(ci.includes(s),s)
 assert(!/continue-on-error:|workflow_dispatch:/.test(ci))
 assert(!ci.includes('path: $RUNNER_TEMP'))
 assert(source.includes('physicalDiskEIO:false'))
 assert(source.includes('physicalIOS:false'))
})
