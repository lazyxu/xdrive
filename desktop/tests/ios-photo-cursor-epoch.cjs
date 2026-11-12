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
  const windowFence = functionBody.slice(
    functionBody.indexOf('let followingWindow = unchanged'),
    functionBody.indexOf('var recoveryPassRestarted')
  )
  assert.match(windowFence, /let followingWindow = unchanged\s*\?\s*XDriveIOSPhotoAutoSchedulePolicy\.nextWindow\(/)
  assert.match(windowFence, /needsReview: pending/)
  assert.match(windowFence, /\)\s*:\s*0/)
  assert.match(windowFence, /state\.windowIndex = followingWindow/)
  assert.ok(windowFence.indexOf('let followingWindow = unchanged') < windowFence.indexOf('state.windowIndex = followingWindow'))
  assert.ok(functionBody.indexOf('state.windowIndex = followingWindow') < functionBody.indexOf('try persist(state, owner: owner)'))
  assert.match(functionBody, /state\.libraryChangeEpoch = epoch\.serialized/)
  assert.doesNotMatch(functionBody, /progress\.uploaded == 0.*state\.windowIndex/)
  assert.match(policy, /previousAuthorization == currentAuthorization/)
})

test('existing emergency all-Owner stop also deletes opaque generation with its scoped schedule', () => {
  const emergency = store.slice(store.indexOf('func disableAllOnThisDevice()'), store.indexOf('/// Persist the next due time'))
  assert.match(emergency, /localStopGeneration &\+= 1/)
  assert.match(emergency, /UserDefaults\.standard\.removeObject\(forKey: key\)/)
  assert.match(emergency, /suffix\.utf8\.count == 64/)
  const freshStart = store.indexOf('let state = State(')
  const fresh = store.slice(freshStart, store.indexOf('try persist(state, owner: owner)', freshStart))
  assert.match(fresh, /libraryChangeEpoch: nil,/)
  assert.match(fresh, /libraryAuthorizationRaw: nil,/)
  const exact = store.slice(store.indexOf('func resumeAfterTrustedReview('),
    store.indexOf('func pausePreservingPrevious('))
  assert.doesNotMatch(exact, /libraryChangeEpoch =|libraryAuthorizationRaw =/)
})
test('PhotoKit native fetches avoid unsupported localIdentifier sort and fence ambiguous backup offsets', () => {
  const scanner = read('ios/XDriveIOS/PhotoKitBoundedSnapshotScanner.swift')
  const backup = read('ios/XDriveIOS/ForegroundPhotoBackupMVP.swift')
  const start = scanner.slice(scanner.indexOf('func start(atOffset'),
    scanner.indexOf('func nextPage()'))
  const primary = 'NSSortDescriptor(key: "creationDate", ascending: false)'
  const secondary = 'NSSortDescriptor(key: "modificationDate", ascending: false)'
  assert.ok(start.includes(primary), 'newest-first primary sort must remain')
  assert.ok(start.includes(secondary), 'secondary sort must be a PhotoKit-supported date')
  assert.ok(start.indexOf(primary) < start.indexOf(secondary),
    'creation date must precede the supported modification date')
  assert.ok(start.indexOf(secondary) < start.indexOf('PHAsset.fetchAssets(with: options)'),
    'sort order must apply to the actual PhotoKit fetch')
  assert.match(start, /if requireStableResume \{/)
  assert.match(start, /XDrivePhotoBackupScanWindow\.maxItems/)
  assert.match(start, /Self\.stableBackupBoundaryIndices\(/)
  assert.match(start, /observer\.currentVersion\(\) == beginVersion/)
  assert.match(scanner, /for boundary in Set\(\[windowStart, windowEnd\]\)\.sorted\(\)/)
  assert.match(scanner, /sameSortKeys\(before, after\)/)
  assert.match(scanner, /XDrivePhotoBackupTieBoundaryPolicy\.maximumGroupSize/)
  assert.match(scanner, /XDrivePhotoBackupTieBoundaryPolicy\.mappingForGroup\(/)
  assert.match(scanner, /throw XDrivePhotoKitScanFailure\.snapshotChanged/)
  assert.match(scanner, /stableBoundaryPhysicalIndices\[index\] \?\? index/)
  assert.match(scanner, /stableBoundaryPhysicalIndices\.removeAll\(\)/)
  assert.match(backup, /scanner\.start\(\s*atOffset: startOffset, requireStableResume: true/)
  assert.match(scanner, /static let pageSize = 64/)
  assert.match(scanner, /observer\.currentVersion\(\) == changeVersion/)
  assert.match(scanner, /nextOffset = min\(requestedOffset, snapshot\.count\)/)
  // Photos can throw NSInvalidArgumentException before Swift catch blocks run.
  // Gate every compiled native Swift source, not only the backup scanner.
  const nativeDir = path.join(root, 'ios/XDriveIOS')
  for (const file of fs.readdirSync(nativeDir).filter(f => f.endsWith('.swift'))) {
    const nativeSource = fs.readFileSync(path.join(nativeDir, file), 'utf8')
    assert.doesNotMatch(nativeSource, /NSSortDescriptor\s*\(\s*key:\s*["']localIdentifier["']/,
      file + ' must not use the unsupported PhotoKit sort key')
  }
  // The pure deterministic tie mapping test covers 257/4096 identifiers,
  // duplicate IDs and overflow. Actual PhotoKit ordering is still covered
  // by the unchanged persistent-generation + authorization fences.
  assert.doesNotMatch(scanner, /UserDefaults|JSONEncoder|SecItemAdd|localStorage/,
    'scanner must not persist or expose PhotoKit identities')
})
