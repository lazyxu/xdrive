const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const directorySource = fs.readFileSync(path.resolve(__dirname, '../src/pwaOfflineDirectory.ts'), 'utf8')
const browserSource = fs.readFileSync(path.resolve(__dirname, '../src/PwaOfflineDirectoryBrowser.tsx'), 'utf8')
const appSource = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf8')
const sectionSource = fs.readFileSync(path.resolve(__dirname, '../src/PwaOfflineDirectorySection.tsx'), 'utf8')
const js = ts.transpileModule(directorySource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const exported = {}
vm.runInNewContext(js, {
  exports: exported, TextEncoder, Set, Date, Number, Array, Error, JSON, Promise,
}, { filename: 'pwaOfflineDirectory.ts' })

const owner = {
  origin: 'https://drive.example.test', userID: 17, username: 'original',
  instanceID: '11111111-1111-4111-8111-111111111111',
}

test('P1-B2 identity revalidation requires same durable Server, Owner, username and password state', () => {
  const match = exported.xDrivePwaVerifiedIdentityMatches
  const me = {
    id: owner.userID, username: owner.username,
    pwa_offline_instance_id: owner.instanceID, must_change_password: false,
  }
  assert.equal(match(owner, me), true)
  assert.equal(match(owner, { ...me, id: me.id + 1 }), false)
  assert.equal(match(owner, { ...me, username: 'different' }), false)
  assert.equal(match(owner, { ...me, pwa_offline_instance_id: '22222222-2222-4222-8222-222222222222' }), false)
  assert.equal(match(owner, { ...me, must_change_password: true }), false)
  assert.equal(match(owner, { ...me, pwa_offline_instance_id: '' }), false)
})

test('offline history is a separate, actionless browser, not a privileged FileExplorer', () => {
  assert.match(browserSource, /xDrivePwaReadRelaunchOwner/)
  assert.match(browserSource, /revalidated === false/)
  assert.match(browserSource, /xDrivePwaVerifiedIdentityMatches\(owner, me\)/)
  assert.match(browserSource, /await api\.me\(controller\.signal\)/)
  assert.match(browserSource, /await api\.node\(selected\.id, controller\.signal\)/)
  assert.match(browserSource, /await api\.listRange\(selected\.id, 0, 1/)
  const apiSource = fs.readFileSync(path.resolve(__dirname, '../src/api.ts'), 'utf8')
  assert.match(apiSource, /me\(signal\?: AbortSignal\)/)
  assert.match(apiSource, /node\(id: number, signal\?: AbortSignal\)/)
  assert.match(apiSource, /return this\.request<MeResult>\('\/api\/v1\/me', \{ signal \}\)/)
  assert.match(apiSource, /return this\.request<Node>\(`\/api\/v1\/nodes\/\$\{id\}`, \{ signal \}\)/)
  assert.match(browserSource, /error\.status === 403/)
  assert.match(browserSource, /xDrivePwaClearOfflineMetadata/)
  assert.match(browserSource, /data-xdrive-pwa-offline-historical/)
  assert.doesNotMatch(browserSource, /\.download\(|mediaThumbnail\(|mediaLivePhoto|\.upload\(|\.createShare\(/)
  assert.doesNotMatch(browserSource, /cachedNode\s+as\s+Node|<WebFileExplorer/)
})

test('cold restart entry stays explicit and no local metadata is mistaken for authentication', () => {
  assert.match(appSource, /window\.location\.hash === '#\/offline\/files'/)
  assert.match(appSource, /if \(offlineSnapshotRoute\)/)
  assert.match(appSource, /hasSession=\{Boolean\(session\.accessToken\)\}/)
  assert.match(appSource, /data-xdrive-pwa-offline-login-entry/)
  assert.match(appSource, /data-xdrive-pwa-offline-profile-fallback/)
  assert.match(appSource, /xDriveHasPendingBrowserUpload\(webTransferStore\.snapshot\(\)\)/)
  assert.match(appSource, /xDriveHasPendingBrowserDownload\(webTransferStore\.snapshot\(\)\)/)
  assert.match(sectionSource, /xDriveHasPendingBrowserUpload\(tasks\)/)
  assert.match(appSource, /window\.addEventListener\('online', refreshProfile\)/)
  assert.match(sectionSource, /data-xdrive-pwa-offline-open-history/)
  assert.doesNotMatch(directorySource, /localStorage\.setItem\(|caches\.open\(|skipWaiting\(/)
})

test('offline owner pointer and identity are opt-in and same-transaction only', () => {
  assert.match(directorySource, /store\.put\(\{\s*key: RELAUNCH_HINT_KEY/)
  assert.match(directorySource, /const recordRead = store\.get\(scope\)/)
  assert.match(directorySource, /record\.consented === true/)
  assert.match(directorySource, /store\.delete\(RELAUNCH_HINT_KEY\)/)
  assert.match(directorySource, /xDrivePwaBroadcastOfflinePurge\(\)/)
  assert.match(directorySource, /slice\(0, XDRIVE_PWA_OFFLINE_MAX_DIRECTORIES\)/)
  assert.match(directorySource, /xDrivePwaNormalizeVisitedDirectory\(/)
})
