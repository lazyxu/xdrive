const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const storeSource = fs.readFileSync(path.resolve(__dirname, '../src/pwaOfflineDirectory.ts'), 'utf8')
const adapterSource = fs.readFileSync(path.resolve(__dirname, '../src/mediaGalleryAdapter.ts'), 'utf8')
const appSource = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf8')
const offlineViewerSource = fs.readFileSync(path.resolve(__dirname, '../src/PwaOfflineDirectoryBrowser.tsx'), 'utf8')
const exportsObject = {}
vm.runInNewContext(ts.transpileModule(storeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exportsObject, TextEncoder, Date, Number, Array, Set, Error, JSON, Promise })

const normalize = exportsObject.xDrivePwaNormalizeAlbumSummaries
const max = exportsObject.XDRIVE_PWA_OFFLINE_MAX_ALBUMS
test('P1-C1 projection whitelists only non-sensitive album summary fields', () => {
  const snapshot = normalize([
    { id: 'album-1', kind: 'manual', name: 'Shared memories', item_count: 120,
      revision: 4, updated_at: '2026-10-22T00:00:00Z',
      cover_node_id: 98765, query: { has_location: true, gps: 'secret' },
      original_url: 'https://hidden', jwt: 'SENSITIVE_JWT', exif: 'SECRET_EXIF' },
    { id: 'album-1', kind: 'manual', name: 'Duplicate', item_count: 3 },
    { id: 'invalid', kind: 'other', name: 'Untrusted type' },
  ])
  assert(snapshot)
  assert.equal(snapshot.partial, true)
  assert.equal(snapshot.totalAtCapture, 3)
  assert.equal(snapshot.albums.length, 1)
  assert.deepEqual(Object.keys(snapshot.albums[0]).sort(), [
    'id', 'kind', 'name', 'item_count', 'revision', 'updated_at',
  ].sort())
  assert.equal(snapshot.albums[0].id, 'album-1')
  assert.equal(snapshot.albums[0].item_count, 120)
  assert(!/SECRET_EXIF|SENSITIVE_JWT|original_url|cover_node_id|has_location|gps|query/.test(
    JSON.stringify(snapshot)))
})

test('100k albums project exactly the first 24 without cloning the collection', () => {
  const huge = Array.from({ length: 100000 }, (_, i) => ({
    id: 'album-' + (i + 1), name: 'album ' + i, kind: 'manual',
    item_count: 100000, cover_node_id: i + 1, private_sha: 'NO_STORE',
  }))
  const t0 = process.hrtime.bigint()
  const snap = normalize(huge)
  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6
  assert.equal(max, 24)
  assert.equal(snap.albums.length, 24)
  assert.equal(snap.totalAtCapture, 100000)
  assert(!JSON.stringify(snap).includes('NO_STORE'))
  assert(elapsedMs < 1000, 'Only a bounded projection should run, not a 100k scan')
})

test('reject invalid metadata rather than trusting raw API or IndexedDB objects', () => {
  assert.equal(normalize(null), null)
  assert.equal(normalize({}), null)
  const snap = normalize([
    { id: '', kind: 'manual', name: 'invalid' },
    { id: 'hidden\u0000ID', kind: 'manual', name: 'invalid' },
    { id: 'valid', kind: 'manual', name: '  OK  ', item_count: -22,
      revision: -55, updated_at: 'not-a-date' },
  ])
  assert.equal(snap.albums.length, 1)
  assert.equal(snap.albums[0].name, 'OK')
  assert.equal(snap.albums[0].item_count, 0)
  assert.equal(snap.albums[0].revision, 0)
  assert(!('updated_at' in snap.albums[0]))
})

test('capture is opt-in, scope transaction fenced, size bounded, no SW/private media', () => {
  assert.match(storeSource, /export async function xDrivePwaCaptureAlbumSummaries/)
  assert.match(storeSource, /existing\.consented !== true/)
  assert.match(storeSource, /XDRIVE_PWA_OFFLINE_MAX_RECORD_BYTES/)
  assert.match(storeSource, /XDRIVE_PWA_OFFLINE_MAX_ALBUM_BYTES/)
  assert.match(storeSource, /XDRIVE_PWA_OFFLINE_MAX_AGE_MS/)
  assert.match(storeSource, /export async function xDrivePwaReadAlbumSummaries/)
  assert.doesNotMatch(storeSource, /caches\.open\(|localStorage\.setItem\(|skipWaiting\(/)
})

test('Gallery reuses its actual authorized list; no independent eager 100k request', () => {
  assert.match(adapterSource, /listAlbums: \(\) => api\.mediaAlbums\(\)\.then\(albums =>/)
  assert.match(adapterSource, /onAuthorizedAlbums\?\.\(albums\)/)
  assert.match(appSource, /onAuthorizedAlbums: albums =>/)
  assert.match(appSource, /context\.api !== api/)
  assert.match(appSource, /context\.app !== 'gallery'/)
  assert.match(appSource, /context\.consent/)
  assert.match(appSource, /xDrivePwaCaptureAlbumSummaries\(context\.owner, albums\)/)
  assert.match(offlineViewerSource, /data-xdrive-pwa-offline-albums/)
  assert.match(offlineViewerSource, /data-xdrive-pwa-offline-reopen-gallery/)
  assert.doesNotMatch(offlineViewerSource, /mediaThumbnail\(|mediaLivePhotoStill|createObjectURL\(/)
})
