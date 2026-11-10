'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const local = read('ios/XDriveIOS/NativeLocalContinuousGallery.swift')
const files = read('ios/XDriveIOS/NativeCloudFilesBrowser.swift')
const frame = read('ios/scripts/capture-navigation-smoke-frames.py')
const ui = read('ios/UITests/XDriveIOSGalleryFilesFrameContinuityUITests.swift')
const ipa = read('.github/workflows/ios-unsigned-ipa.yml')
const between = (source, first, last) => {
  const from = source.indexOf(first)
  const to = source.indexOf(last, from + first.length)
  assert.ok(from >= 0 && to > from, 'Missing real Swift lifecycle: ' + first)
  return source.slice(from, to)
}
test('01 interrupted first PhotoKit scan cannot commit an unverified completed marker', () => {
  const reload = between(local, '    private func reload() {', '    private func invalidate(with message:')
  assert.doesNotMatch(reload.slice(0, reload.indexOf('scanTask = Task')), /hasCompletedInitialRead = true/)
  assert.match(reload, /total = count\s*\/\/ A genuine successful empty PhotoKit library is also a\s*\/\/ completed read\. Only now may tab returns skip rescanning\.\s*hasCompletedInitialRead = true/)
})
test('02 cancelled first PhotoKit scan retries on next visible Gallery mount', () => {
  assert.match(local, /if authorized && selected == nil && !loading &&\s*!hasCompletedInitialRead \{ reload\(\) \}/)
  assert.match(local, /private func suspendForCoveredNavigation\(\) \{\s*scanTask\?\.cancel\(\)\s*scanTask = nil\s*loading = false/)
  assert.match(local, /catch is CancellationError \{\s*\} catch/)
})
test('03 successful EMPTY PhotoKit library counts as a completed scan', () => {
  const reload = between(local, '    private func reload() {', '    private func invalidate(with message:')
  assert.match(reload, /total = count[\s\S]*?hasCompletedInitialRead = true/)
  assert.doesNotMatch(reload, /guard count > 0/)
})
test('04 genuine PhotoKit change, permission loss and explicit reload still invalidate cached pages', () => {
  const invalidate = local.slice(local.indexOf('    private func invalidate(with message:'))
  assert.match(invalidate, /navigationReturnPage = nil/)
  assert.match(invalidate, /navigationReturnGeneration = nil/)
  assert.match(invalidate, /hasCompletedInitialRead = false/)
  assert.match(local, /if freshGrant != permission \{ invalidate\(with: nil\) \}/)
})
test('05 interrupted first Files Home favorites read re-arms the initial fetch once', () => {
  const lifecycle = between(files, 'private func filesForegroundLifecycle(', 'private func filesOwnerLifecycle(')
  assert.match(lifecycle, /if homeReadAttempted && favoriteShortcuts\.loading &&\s*!favoriteShortcuts\.verified && favoriteShortcuts\.error == nil \{\s*homeReadAttempted = false\s*\}\s*favoriteShortcuts\.suspendForNavigation\(\)/)
  assert.match(lifecycle, /if !homeReadAttempted \{\s*homeReadAttempted = true\s*reload\(\)/)
})
test('06 verified Favorites rows and terminal errors are not turned into reload loops', () => {
  const lifecycle = between(files, 'private func filesForegroundLifecycle(', 'private func filesOwnerLifecycle(')
  assert.match(lifecycle, /!favoriteShortcuts\.verified && favoriteShortcuts\.error == nil/)
  assert.match(lifecycle, /favoriteShortcuts\.matches\(login\.owner, kind: \.favorites\) &&\s*quickAccess\.matches\(login\.owner\)/)
  assert.match(files, /favoriteShortcuts\.load\(\s*\.favorites, login: login, preserveVerifiedRows: sameOwner/)
})
test('07 all FOUR local PhotoKit native UI journeys produce tap-adjacent simulator captures', () => {
  for (const name of [
    'testLocalPhotoGalleryFilesRoundTripsKeepRealNativePixels',
    'testLocalPhotoGalleryForegroundAndFilesReturnRemainNonBlank',
    'testLocalPhotoTimelineDateSheetDismissThenFilesReturnKeepsContent',
    'testLocalPhotoWithFilesQuickSectionsPreservesLocalChild',
  ]) {
    assert.ok(frame.includes('"' + name + '"'), 'unwatched native route ' + name)
    assert.ok(ui.includes('func ' + name + '()'), 'uncompiled native test ' + name)
  }
  assert.match(frame, /TARGETS\.update\(NAV_TARGETS\)/)
})
test('08 frame watcher samples LATE taps on repeated 8+ Gallery/Files switches', () => {
  assert.match(frame, /TAP_CAPTURE_NUMBERS = frozenset\(\(1, 2, 4, 8, 12, 16\)\)/)
  assert.match(frame, /count = tap_counts\.get\(current_case, 0\) \+ 1\s*tap_counts\[current_case\] = count\s*if count in TAP_CAPTURE_NUMBERS/)
  assert.doesNotMatch(frame, /if count < 3:/)
})
test('09 sub-150ms tap capture has a fine-grained polling cadence', () => {
  assert.match(frame, /TAP_FRAME_OFFSETS_SECONDS = \(0\.15, 0\.55\)/)
  assert.match(frame, /time\.sleep\(0\.075\)/)
  assert.match(frame, /if key not in active:\s*continue/)
  assert.match(frame, /"capture_mode": "tap-adjacent"/)
})
test('10 native UI asserts the ACTUAL PhotoKit child and explicit grant state, not only bottom tabs', () => {
  assert.match(ui, /private func assertLocalPhotoContent\(_ app: XCUIApplication\)/)
  assert.match(ui, /native-ios-local-timeline-open/)
  assert.match(ui, /native-ios-local-gallery-media-filter/)
  assert.match(ui, /authorized \|\| requesting \|\| denied/)
  assert.match(ui, /assertLocalPhotoContent\(app\)/)
})
test('11 XCTest diagnostic route strings interpolate real cycle indices', () => {
  const slash = String.fromCharCode(92)
  assert.ok(ui.includes('route: "Files after local Photos ' + slash + '(index)"'))
  assert.ok(ui.includes('route: "Local Photos after Files ' + slash + '(index)"'))
  assert.ok(!ui.includes('route: "Files after local Photos ' + slash + slash + '(index)"'))
  assert.ok(!ui.includes('route: "Local Photos after Files ' + slash + slash + '(index)"'))
})
test('12 source tests are required by unsigned IPA and real native UI journeys are in candidate suite', () => {
  assert.match(ipa, /node --test desktop\/tests\/ios-native-gallery-files-cold-return-20261110\.cjs/)
  const runtime = read('.github/workflows/ios-native-navigation-runtime.yml')
  assert.match(runtime, /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSGalleryFilesFrameContinuityUITests/)
  assert.match(runtime, /capture-navigation-smoke-frames\.py/)
})
