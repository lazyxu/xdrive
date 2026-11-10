'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const gallery = read('ios/XDriveIOS/NativeCloudOriginalGallery.swift')
const dashboard = read('ios/XDriveIOS/NativePhotosDashboard.swift')
const ui = read('ios/UITests/XDriveIOSGalleryFilesFrameContinuityUITests.swift')
const frame = read('ios/scripts/capture-navigation-smoke-frames.py')
const workflow = read('.github/workflows/ios-native-navigation-runtime.yml')
const ipa = read('.github/workflows/ios-unsigned-ipa.yml')
const slice = (start, end) => {
  const a = gallery.indexOf(start)
  const b = gallery.indexOf(end, a + start.length)
  assert.ok(a >= 0 && b > a, 'missing real native scope ' + start)
  return gallery.slice(a, b)
}
const model = slice('@MainActor\nfinal class XDriveIOSNativeCloudOriginalModel', 'struct XDriveIOSNativeCloudOriginalPreview')
const tile = slice('private struct XDriveIOSNativeCloudOriginalTile: View', 'struct XDriveIOSNativeCloudOriginalGallery: View')
const wall = gallery.slice(gallery.indexOf('struct XDriveIOSNativeCloudOriginalGallery: View'))

test('01 Files/Gallery selected tab is passed explicitly only to Originals wall', () => {
  assert.match(dashboard, /XDriveIOSNativeCloudOriginalGallery\(\s*login: login,\s*confirmedOriginalUpdate: backup.confirmedOriginalUpdate,\s*isTabActive: tab == \.gallery/)
  assert.match(wall, /var isTabActive: Bool = true/)
})
test('02 a tab-covered wall retires signed reader without blanking verified rows', () => {
  assert.match(wall, /\.onChange\(of: isTabActive\) \{ active in[\s\S]*?needsTabRevalidation = true\s*model.cancel\(\)/)
  assert.match(wall, /if phase == \.active, !isTabActive,\s*model.matchesOwner\(login.owner\) \{\s*needsTabRevalidation = true\s*model.cancel\(\)\s*\} else \{\s*model.invalidate\(\)/)
  const cancel = slice('    func cancel() {', '    func thumbnail(_ node:')
  assert.match(cancel, /currentReader = nil/)
  assert.doesNotMatch(cancel, /nodes = \[\]|seenNodeIDs\.removeAll\(\)|total = 0|scanned = 0/)
})
test('03 retained Originals are gated by exact Owner before any tile can render', () => {
  assert.match(model, /private var verifiedPageOwner: XDriveNativeOwnerRoot\?/)
  assert.match(model, /func matchesOwner\(_ owner: XDriveNativeOwnerRoot\?\) -> Bool \{[\s\S]*?XDriveIOSNativePhotoOwnerScope.matches\(owner, verifiedPageOwner\)/)
  assert.match(wall, /if model.matchesOwner\(login.owner\) \{\s*ForEach\(model.nodes\)/)
  assert.match(wall, /model.matchesOwner\(owner\),\s*let index = model.nodes.firstIndex/)
})
test('04 first 48 Server items are re-verified before covered rows can be reused', () => {
  const method = slice('    func revalidateCoveredTab(login:', '    func loadNext(login:')
  assert.match(method, /login\.verifiedAuthorization\(\)/)
  assert.match(method, /XDriveIOSNativePhotoOwnerScope.matches\(auth.owner, expected\)/)
  assert.match(method, /let fresh = try await reader.page\(offset: 0\)/)
  assert.match(method, /fresh.nodes != model.verifiedFirstPage/)
  assert.match(model, /if start == 0 \{ model.verifiedFirstPage = reply.nodes \}/)
})
test('05 changed original IDs and revisions atomically replace prior pages', () => {
  assert.match(gallery, /struct XDriveIOSNativeCloudOriginal: Decodable, Identifiable, Equatable/)
  const method = slice('    func revalidateCoveredTab(login:', '    func loadNext(login:')
  assert.match(method, /if fresh.total != model.total \|\|\s*fresh.nodes != model.verifiedFirstPage \{\s*model.nodes = fresh.nodes\s*model.seenNodeIDs = Set\(fresh.nodes.map\(\\\.id\)\)\s*model.total = fresh.total\s*model.scanned = min\(fresh.total, 48\)/)
})
test('06 revoked Owner, malformed range and failed authorization clear stale Originals', () => {
  assert.match(model, /if XDriveIOSNativeCloudOriginalModel.canRetainPage\(after: error\),\s*model.matchesOwner\(login.owner\)/)
  assert.match(model, /\} else \{\s*model.invalidate\(\)\s*model.error = "云端原件授权或内容已变化/)
  assert.match(wall, /\.onChange\(of: login.owner\) \{ _ in[\s\S]*?model.invalidate\(\)/)
  assert.match(model, /verifiedPageOwner = nil\s*verifiedFirstPage = \[\]/)
})
test('07 transient 429/503/network errors retain scoped rows and require Retry', () => {
  const method = slice('    func revalidateCoveredTab(login:', '    func loadNext(login:')
  assert.match(method, /model.coveredRetryRequired = true/)
  assert.match(wall, /if model.coveredRetryRequired \{\s*model.revalidateCoveredTab\(login: login\)\s*\} else \{\s*model.loadNext\(login: login\)/)
})
test('08 thumbnails rearm only after fresh verification and discard old bearer', () => {
  assert.match(model, /model.currentReader = reader\s*model.coveredRetryRequired = false\s*model.error = nil[\s\S]*?model.thumbnailEpoch = UUID\(\)/)
  assert.match(tile, /model.thumbnailEpoch/)
  assert.match(tile, /guard isTabActive, !viewerActive,\s*model.matchesOwner\(login.owner\), thumb == nil/)
})
test('09 thumbnails survive tab covers but not active scroll eviction', () => {
  assert.match(tile, /if !viewerActive && isTabActive \{ thumb = nil \}/)
  assert.match(wall, /isTabActive: isTabActive,\s*model: model, login: login/)
})
test('10 hidden tabs do not auto-start cloud scans or pagination', () => {
  assert.match(wall, /private func activateIfNeeded\(\) \{\s*guard phase == \.active, isTabActive, selected == nil else \{ return \}/)
  assert.match(wall, /guard phase == \.active, isTabActive, selected == nil, scanTailVisible,\s*model.matchesOwner\(login.owner\)/)
  assert.match(wall, /guard needsForegroundReload,\s*isTabActive \|\| selected != nil else \{ return \}/)
})
test('11 background return or new backup receipt forces fresh server read', () => {
  assert.match(wall, /if phase != \.active \|\| !isTabActive \{[\s\S]*?needsForegroundReload = true/)
  assert.match(wall, /if needsForegroundReload \{\s*needsForegroundReload = false\s*needsTabRevalidation = false\s*hasActivated = true\s*model.reload\(login: login\)/)
})
test('12 revision and Owner identity prevent another account reusing decoded tiles', () => {
  assert.match(gallery, /private struct XDriveIOSNativeCloudOriginalTileIdentity: Hashable/)
  for (const name of ['nodeID','revision','origin','ownerID','username','rootNodeID']) {
    assert.ok(gallery.includes('let ' + name + ':'), 'missing tile identity ' + name)
  }
  assert.match(wall, /\.id\(XDriveIOSNativeCloudOriginalTileIdentity\(\s*node: node, owner: login.owner/)
})
test('13 four native Originals routes are registered and assert real child contents', () => {
  for (const name of [
    'testCloudOriginalsFilesRapidReturnKeepsNativeChild',
    'testCloudOriginalsBackgroundFilesReturnKeepsNativeChild',
    'testCloudOriginalsHelpDismissFilesReturnKeepsChild',
    'testCloudOriginalsFilesQuickSectionsReturnKeepsChild',
  ]) {
    assert.ok(ui.includes('func ' + name + '()'), 'missing XCTest ' + name)
    assert.ok(frame.includes('"' + name + '"'), 'unwatched route ' + name)
  }
  assert.match(ui, /private func assertCloudOriginalsChild\(_ app: XCUIApplication\)/)
  assert.match(ui, /XCTAssertFalse\(target\("native-ios-cloud-original-tile", app: app\).exists/)
})
test('14 mandatory XCUITest and unsigned IPA source-contract gates stay wired', () => {
  assert.match(workflow, /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSGalleryFilesFrameContinuityUITests/)
  assert.match(workflow, /capture-navigation-smoke-frames.py/)
  assert.match(ipa, /ios-native-cloud-original-tab-continuity-20261110.cjs/)
})
