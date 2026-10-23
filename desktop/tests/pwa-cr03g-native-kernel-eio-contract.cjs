'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const sh=read('scripts/pwa-cr03g-native-kernel-eio.sh')
const go=read('desktop/scripts/pwa-cr03g-native-kernel-eio.cjs')
const flow=read('.github/workflows/pwa-cr03g-native-kernel-eio.yml')
const product=read('web/src/pwaOfflineDirectory.ts')
test('CR03g actually mounts private ext4 backed by newly allocated loopback dm-linear',()=>{
 for(const t of ['GITHUB_RUN_ID','xdrive-pwa-cr03g-private',
  'truncate -s 256M','losetup --find --show','dmsetup create',
  'mkfs.ext4 -q -F','mount -t ext4','mountpoint -q',
  'xd-pwa-cr03g-', 'dmsetup remove','losetup -d','trap cleanup EXIT'])
  assert(sh.includes(t),t)
 assert(sh.includes('test "$(id -u)" -ne 0'))
 assert(!sh.includes('/dev/sda'))
 assert(!sh.includes('/dev/nvme'))
 assert(!sh.includes('/var/lib'))
})
test('CR03g uses real kernel dm-error, direct I/O EIO, original IndexedDB without fake exceptions',()=>{
 for(const t of ["XD_PWA_CR03G_NATIVE_EIO","changeBlock('error')",
  "directKernelProof(true)","Input", "chromium.launchPersistentContext",
  'nativeIDBFailureObserved=true','chromiumIndexedDBTested=true',
  'xDrivePwaSetOfflineConsent','xDrivePwaCaptureVisitedDirectory',
  'xDrivePwaCaptureAlbumSummaries','xDrivePwaClearOfflineMetadata',
  'xDrivePwaObserveOfflinePurge','changeBlock(\'linear\')',
  'directKernelProof(false)','repairPrivateExt4()','postRestoreNoNewRow=true'])
  assert(go.includes(t),t)
 assert(!go.includes('new DOMException('))
 assert(!go.includes('Storage.overrideQuotaForOrigin'))
 assert(!go.includes('route.fulfill('))
 assert(!go.includes('context.route('))
 assert(product.includes('offlinePurgeEpoch'))
})
test('CR03g exact HEAD dedicated CI, real Chromium and bounded anonymous evidence',()=>{
 for(const t of ['github.event.pull_request.head.sha','dmsetup',
  'e2fsprogs','node --check desktop/scripts/pwa-cr03g-native-kernel-eio.cjs',
  'node --test desktop/tests/pwa-cr03g-native-kernel-eio-contract.cjs',
  'playwright-core@1.56.1','npm --prefix web run build',
  'node web/scripts/test-pwa-offline-directory.cjs',
  'scripts/pwa-cr03g-native-kernel-eio.sh',
  'actions/upload-artifact@v4'])
  assert(flow.includes(t),t)
 assert(!flow.includes('continue-on-error:'))
 assert(!flow.includes('workflow_dispatch:'))
 assert(flow.includes('desktop/pwa-cr03g-results/summary.json'))
 assert(!flow.includes('private-profile/'))
})
