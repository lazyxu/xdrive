'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const swift = read('ios/XDriveIOS/NativePhotoAlbumBrowser.swift')
const album = swift.slice(
  swift.indexOf('struct XDriveIOSNativeAlbumContentsScreen: View'),
  swift.indexOf('/// Photos-first list of local smart/user albums.')
)
const workflow = read('.github/workflows/ios-native-navigation-runtime.yml')
const monitor = read('ios/scripts/capture-navigation-smoke-frames.py')
const part = (start, end) => {
  const a = album.indexOf(start)
  const b = album.indexOf(end, a + start.length)
  assert.ok(a >= 0 && b > a, 'missing album scope ' + start)
  return album.slice(a, b)
}

test('authorized album reload delegates to load instead of invalidating the same wall twice', () => {
  const reload = part('    private func reload() {', '    private func load(offset:')
  const authorized = reload.slice(reload.indexOf('        load(offset: savedOffset)') - 20)
  assert.match(reload, /guard permission == \.authorized \|\| permission == \.limited else \{/)
  assert.match(authorized, /load\(offset: savedOffset\)/)
  // Only the denied branch is permitted to retire a page in reload().
  const denied = reload.slice(reload.indexOf('else {'), reload.indexOf('        load(offset: savedOffset)'))
  assert.equal((reload.match(/^\s*invalidate\(\)/gm) || []).length, 1)
  assert.match(denied, /invalidate\(\)/)
})

test('the authorized album load owns one invalidation and one bounded asynchronous read', () => {
  const load = part('    private func load(offset:', '    private func suspendForViewer()')
  assert.equal((load.match(/^\s*invalidate\(\)/gm) || []).length, 1)
  assert.match(load, /let ticket = epoch/)
  assert.match(load, /loading = true/)
  assert.match(load, /try await next\.open\(album, sortOrder: sortOrder\)/)
  assert.match(load, /epoch == ticket, phase == \.active/)
  assert.match(load, /savedOffset = XDriveIOSNativePhotoVirtualPagePolicy\.normalizedAnchor/)
})

test('denied PhotoKit access still revokes the page and its return anchor', () => {
  const reload = part('    private func reload() {', '    private func load(offset:')
  assert.match(reload, /else \{[\s\S]*invalidate\(\)[\s\S]*clearViewerTileAnchor\(\)[\s\S]*return/)
})

test('foreground tab return reuses a verified album rather than forcing a second fetch', () => {
  const appears = part('        .onAppear {\n            isContentVisible = true', '        .onChange(of: libraryMonitor.revision)')
  assert.match(appears, /sameVerifiedPage = page != nil && total != nil && !loading/)
  assert.match(appears, /pageRevision == libraryMonitor.revision/)
  assert.match(appears, /freshGrant == permission/)
  assert.match(appears, /selected == nil && !sameVerifiedPage && !loading \{ reload\(\) \}/)
})

test('authorized foreground tab departure keeps the page but background/revocation retires it', () => {
  const leaves = part('        .onDisappear {\n            isContentVisible = false', '    private var albumAuthorized:')
  assert.match(leaves, /phase == \.active && albumAuthorized/)
  assert.match(leaves, /suspendForViewer\(\)/)
  assert.match(leaves, /libraryMonitor\.stop\(\)[\s\S]*invalidate\(\)/)
  const scene = part('        .onChange(of: phase) { state in', '        .onDisappear {\n            isContentVisible = false')
  assert.match(scene, /if state != \.active/)
  assert.match(scene, /clearViewerTileAnchor\(\)[\s\S]*invalidate\(\)/)
})

test('native Simulator invokes exactly one xcodebuild test action per candidate shard', () => {
  assert.match(workflow, /xcodebuild test \\/)
  assert.match(workflow, /"\$\{native_test_args\[@\]\}" \\/)
  assert.doesNotMatch(workflow, /"\$\{native_test_args\[@\]\}" test/)
  for (const shard of ['candidate-navigation', 'candidate-gallery-files', 'candidate-no-session']) {
    assert.ok(workflow.includes(shard), 'missing mandatory native suite: ' + shard)
  }
  assert.match(workflow, /continue-on-error: \$\{\{ matrix\.source == 'release-c83' \}\}/)
})

test('frame observer covers five or more distinct real navigation and recovery journeys', () => {
  for (const name of [
    'testRapidGalleryFilesTabOscillationPreservesBothShells',
    'testFilesQuickRailAlternatingSectionsReturnsToBrowse',
    'testGallerySourcesAlternateWithoutLosingSourceRail',
    'testRepeatedFilterDismissalRestoresSameGallery',
    'testCloudFilesRepeatedOfflineRetryRetainsRecoverableChildPage',
    'testRecentlyDeletedRepeatedOfflineRetryRetainsRecoverableChildPage',
    'testGalleryBackgroundResumeKeepsNativeSourceAndPixels',
    'testFilesBackgroundResumeKeepsQuickRailAndPixels'
  ]) assert.ok(monitor.includes(name), 'missing frame trace for ' + name)
})

test('frame samples are scoped to the active XCTest case; expired captures do not implicate another page', () => {
  assert.match(monitor, /Test Case .*passed\|failed/)
  assert.match(monitor, /active\.discard\(/)
  assert.match(monitor, /if key not in active:/)
  assert.match(monitor, /FRAME_OFFSETS_SECONDS/)
})
