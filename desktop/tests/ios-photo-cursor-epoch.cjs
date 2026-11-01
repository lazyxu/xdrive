'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const store = read('ios/XDriveIOS/PhotoAutoScheduleStore.swift')
const policy = read('ios/XDriveIOS/PhotoCursorEpochPolicy.swift')

test('only the exact Owner schedule stores an opaque secure PhotoKit generation token', () => {
  assert.match(store, /let scope = owner\.origin\.absoluteString/)
  assert.match(store, /owner\.instanceID/)
  assert.match(store, /owner\.rootNodeID/)
  assert.match(store, /var libraryChangeEpoch: Data\? = nil/)
  assert.match(store, /var libraryAuthorizationRaw: Int\? = nil/)
  const nativeEpoch = read('ios/XDriveIOS/PhotoKitLibraryEpoch.swift')
  assert.match(store, /XDriveIOSPhotoKitLibraryEpoch\.capture\(\)/)
  assert.match(store, /XDriveIOSPhotoKitLibraryEpoch\.matches\(/)
  assert.match(nativeEpoch, /PHPhotoLibrary\.shared\(\)\.currentChangeToken/)
  assert.match(nativeEpoch, /NSKeyedArchiver\.archivedData\(/)
  assert.match(nativeEpoch, /requiringSecureCoding: true/)
  assert.match(nativeEpoch, /NSKeyedUnarchiver\.unarchivedObject\(/)
  assert.match(nativeEpoch, /PHPersistentChangeToken\.self/)
  assert.match(nativeEpoch, /archived\.count <= 65_536/)
  assert.doesNotMatch(store, /\.localIdentifier\b|\"accessToken\"|\"deviceToken\"|\"refreshToken\"/)
  assert.doesNotMatch(policy, /PHAsset|localIdentifier|accessToken|GPS/)
})

test('reserveDue checks persisted generation before authorizing old positional offset', () => {
  const start = store.indexOf('func reserveDue(owner:')
  const end = store.indexOf('func recordResult(owner:', start)
  assert.ok(start > 0 && end > start)
  const functionBody = store.slice(start, end)
  assert.match(functionBody, /let epoch = try XDriveIOSPhotoKitLibraryEpoch\.capture\(\)/)
  assert.match(functionBody, /XDrivePhotoCursorEpochPolicy\.trustedWindow\(/)
  assert.match(functionBody, /tokenUnchanged: XDriveIOSPhotoKitLibraryEpoch\.matches\(/)
  assert.match(functionBody, /state\.libraryChangeEpoch = epoch\.serialized/)
  assert.ok(functionBody.indexOf('state.windowIndex = ') < functionBody.indexOf('try persist(state, owner: owner)'))
})

test('recordResult also fences PhotoKit edits between scan and persisted checkpoint', () => {
  const start = store.indexOf('func recordResult(owner:')
  const end = store.indexOf('private func persist(', start)
  assert.ok(start > 0 && end > start)
  const functionBody = store.slice(start, end)
  assert.match(functionBody, /let epoch = try XDriveIOSPhotoKitLibraryEpoch\.capture\(\)/)
  assert.match(functionBody, /XDrivePhotoCursorEpochPolicy\.canResume\(/)
  assert.match(functionBody, /state\.windowIndex = unchanged/)
  assert.match(functionBody, /\) : 0/)
  assert.match(functionBody, /state\.libraryChangeEpoch = epoch\.serialized/)
  assert.doesNotMatch(functionBody, /progress\.uploaded == 0.*state\.windowIndex/)
  assert.match(policy, /previousAuthorization == currentAuthorization/)
})

test('existing emergency all-Owner stop also deletes opaque generation with its scoped schedule', () => {
  const emergency = store.slice(store.indexOf('func disableAllOnThisDevice()'), store.indexOf('/// Persist the next due time'))
  assert.match(emergency, /localStopGeneration &\+= 1/)
  assert.match(emergency, /UserDefaults\.standard\.removeObject\(forKey: key\)/)
  assert.match(emergency, /suffix\.utf8\.count == 64/)
  assert.match(store, /libraryChangeEpoch: existing\?\.libraryChangeEpoch/)
})
test('PhotoKit backup uses creation date plus unique local ID for stable 256-slot boundaries', () => {
  const scanner = read('ios/XDriveIOS/PhotoKitBoundedSnapshotScanner.swift')
  const start = scanner.slice(scanner.indexOf('func start(atOffset'),
    scanner.indexOf('func nextPage()'))
  const primary = 'NSSortDescriptor(key: "creationDate", ascending: false)'
  const unique = 'NSSortDescriptor(key: "localIdentifier", ascending: true)'
  assert.ok(start.includes(primary), 'newest-first primary sort must remain')
  assert.ok(start.includes(unique), 'a unique, supported PHAsset sort key is required')
  assert.ok(start.indexOf(primary) < start.indexOf(unique),
    'date sort must precede localIdentifier tie-breaker')
  assert.ok(start.indexOf(unique) < start.indexOf('PHAsset.fetchAssets(with: options)'),
    'sort order must be applied to the actual PhotoKit fetch')
  assert.match(scanner, /static let pageSize = 64/)
  assert.match(scanner, /let snapshot = PHAsset\.fetchAssets\(with: options\)/)
  assert.match(scanner, /nextOffset = min\(requestedOffset, snapshot\.count\)/)
  assert.match(scanner, /observer\.currentVersion\(\) == changeVersion/)
  // Model the same date-descending / unique-ID-ascending ordering over a
  // 100k-asset synthetic library. Large equal-date groups cross 256-slot
  // checkpoints; reversing discovery order cannot reorder or omit IDs.
  // This checks ordering logic, not native PhotoKit's runtime implementation.
  const assets = Array.from({ length: 100_000 }, (_, i) => ({
    day: Math.floor(i / 300),
    id: 'asset-' + String(i).padStart(6, '0')
  }))
  const compare = (a, b) => b.day - a.day ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const forward = assets.slice().sort(compare).map(a => a.id)
  const reversed = assets.slice().reverse().sort(compare).map(a => a.id)
  assert.deepEqual(reversed, forward)
  let scanned = 0
  const seen = new Set()
  for (let offset = 0; offset < forward.length; offset += 256) {
    const page = forward.slice(offset, offset + 256)
    assert.ok(page.length <= 256)
    for (const id of page) {
      assert.ok(!seen.has(id), 'one identity must not cross twice')
      seen.add(id)
      scanned++
    }
  }
  assert.equal(scanned, 100_000)
  assert.equal(seen.size, 100_000)
  assert.doesNotMatch(scanner, /UserDefaults|JSONEncoder|SecItemAdd|localStorage/,
    'the scanner must not persist or expose PhotoKit identifiers')
})
