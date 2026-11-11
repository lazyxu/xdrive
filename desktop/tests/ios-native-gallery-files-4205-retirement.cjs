'use strict'
// Reviewed legacy #4205 protection intent on the CURRENT Gallery/Files UI.
// Old no-Session retry/AutoPop internals were deliberately retired; do not
// reinstate them or weaken current Owner/PhotoKit admission to satisfy tests.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const files = read('ios/XDriveIOS/NativeCloudFilesBrowser.swift')
const album = read('ios/XDriveIOS/NativePhotoAlbumBrowser.swift')
const local = read('ios/XDriveIOS/NativeLocalContinuousGallery.swift')
const filesUI = read('ios/UITests/XDriveIOSFilesSessionRecoveryUITests.swift')
const galleryUI = read('ios/UITests/XDriveIOSGalleryFilesStabilityUITests.swift')
const frame = read('ios/scripts/capture-navigation-smoke-frames.py')
function region(source, from, to) {
  const start = source.indexOf(from)
  assert.ok(start >= 0, 'missing verified source boundary: ' + from)
  const end = to ? source.indexOf(to, start + from.length) : source.length
  assert.ok(end > start, 'missing end of verified boundary: ' + String(to))
  return source.slice(start, end)
}

test('retired #4205: missing Session uses only bounded Back-only Files denial, never a protected Reader or retry', () => {
  const denied = region(files, 'struct XDriveIOSNativeFilesNoSessionRoute: View')
  assert.match(denied, /enum Kind \{ case cloud, trash, recent, favorites \}/)
  assert.match(denied, /Button\s*\{\s*dismiss\(\)/)
  assert.doesNotMatch(denied, /native-ios-files-(?:trash-|recent-|favorites-)?retry/)
  assert.match(files, /if folder != nil && !login\.hasLocalOwnerSession\s*\{\s*XDriveIOSNativeFilesNoSessionRoute\(kind: \.cloud\)/)
  for (const kind of ['recent', 'favorites']) {
    assert.ok(files.includes('XDriveIOSNativeFilesNoSessionRoute(kind: .' + kind + ')'))
  }
  assert.match(filesUI, /func testCloudFolderNoSessionIsSmallNativeRecoveryInsteadOfFilesList\(/)
  assert.match(filesUI, /func testRecentlyDeletedNoSessionDoesNotMountDestructiveRows\(/)
  assert.match(filesUI, /func testRecentFavoritesRepeatedDenialsNeverRetainOldScope\(/)
  assert.match(filesUI, /func testNoSessionCloudTrashRapidBackDoesNotRepushOldChild\(/)
})

test('retired #4205: PhotoKit album reload has one authorized invalidation, with denial retiring the tile', () => {
  const reload = region(album, '    private func reload() {', '    private func load(offset:')
  const load = region(album, '    private func load(offset:', '    private func suspendForViewer()')
  assert.match(reload, /guard permission == \.authorized \|\| permission == \.limited else \{/)
  assert.equal((reload.match(/^\s*invalidate\(\)/gm) || []).length, 1)
  assert.match(reload, /clearViewerTileAnchor\(\)/)
  assert.match(reload, /load\(offset: savedOffset\)/)
  assert.equal((load.match(/^\s*invalidate\(\)/gm) || []).length, 1)
  assert.match(load, /let ticket = epoch/)
  assert.match(load, /epoch == ticket, phase == \.active/)
  assert.match(load, /XDriveIOSNativePhotoVirtualPagePolicy\.normalizedAnchor/)
  assert.match(album, /let sameVerifiedPage = page != nil && total != nil && !loading/)
  assert.match(album, /pageRevision == libraryMonitor\.revision/)
  assert.match(album, /freshGrant == permission/)
})

test('retired #4205: a PhotoKit page hands off only exact 64-slot generation and invalidates stale work', () => {
  const leave = region(local, '            let verifiedEpoch = retainedGeneration',
    '            onPageHidden(offset, verifiedEpoch, verifiedPage)')
  assert.match(leave, /verifiedEpoch == generation &&/)
  assert.match(leave, /page\?\.startOffset == offset/)
  assert.match(leave, /page\?\.totalAccessibleAssets == expectedTotal/)
  assert.match(leave, /if !retainWhileCovered \{[\s\S]*?page = nil[\s\S]*?retainedGeneration = nil/)
  assert.match(leave, /badgeReadEpoch = UUID\(\)/)
  assert.match(leave, /scanner = nil/)
  assert.match(local, /onPageHidden\(offset, verifiedEpoch, verifiedPage\)/)
  assert.match(local, /navigationRetainedPage: XDrivePhotoKitScanPage\?/)
})

test('retired #4205: real native Gallery and Files denial journeys remain executable', () => {
  const testMethods = source =>
    new Set([...source.matchAll(/\bfunc\s+(test\w+)\s*\(/g)].map(match => match[1]))
  const gallery = testMethods(galleryUI)
  const recovery = testMethods(filesUI)
  assert.ok(gallery.size >= 38, 'do not shrink the original 38-case Gallery/Files coverage')
  assert.ok(recovery.size >= 20, 'keep bounded no-Session route coverage')
  for (const name of [
    'testRapidGalleryFilesTabOscillationPreservesBothShells',
    'testGalleryBackgroundResumeKeepsNativeSourceAndPixels',
  ]) assert.ok(gallery.has(name), 'missing executable Gallery case: ' + name)
  for (const name of [
    'testCloudFolderNoSessionIsSmallNativeRecoveryInsteadOfFilesList',
    'testRecentlyDeletedNoSessionDoesNotMountDestructiveRows',
    'testRecentFavoritesRepeatedDenialsNeverRetainOldScope',
    'testNoSessionCloudTrashRapidBackDoesNotRepushOldChild',
  ]) assert.ok(recovery.has(name), 'missing executable protected Files case: ' + name)
})

test('retired #4205: frame sampling is case/tap scoped and never attributed to the next native XCTest', () => {
  assert.match(frame, /FRAME_OFFSETS_SECONDS/)
  assert.match(frame, /active\.discard\(key\)/)
  assert.match(frame, /if key not in active:/)
  assert.match(frame, /TAP_FRAME_OFFSETS_SECONDS/)
  assert.match(frame, /TAP_CAPTURE_NUMBERS/)
})
