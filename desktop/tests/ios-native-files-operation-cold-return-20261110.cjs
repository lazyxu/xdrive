'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const op = read('ios/XDriveIOS/NativeFilesOperationHistory.swift')
const files = read('ios/XDriveIOS/NativeCloudFilesBrowser.swift')
const ui = read('ios/UITests/XDriveIOSGalleryFilesFrameContinuityUITests.swift')
const watcher = read('ios/scripts/capture-navigation-smoke-frames.py')
const ipa = read('.github/workflows/ios-unsigned-ipa.yml')
const part = (s, start, end) => {
  const a = s.indexOf(start)
  const b = s.indexOf(end, a + start.length)
  assert.ok(a >= 0 && b > a, 'scope missing: ' + start)
  return s.slice(a, b)
}
const model = part(op, 'final class XDriveIOSNativeFilesOperationsModel:', '/// Native historical Server Operations')
const foreground = part(files, 'private func filesForegroundLifecycle(', 'private func filesOwnerLifecycle(')
const owner = part(files, 'private func filesOwnerLifecycle(', 'private func filesNavigationLifecycle(')

test('01 cancellation of hidden optional operation-history read invalidates pending epoch', () => {
  assert.match(model, /func suspendReadForNavigation\(\) \{\s*guard !busy else \{ return \}\s*epoch = UUID\(\)\s*job\?\.cancel\(\)\s*job = nil\s*loading = false/)
})
test('02 in-flight Undo/Redo server POST is never canceled by a tab cover', () => {
  const suspend = part(model, 'func suspendReadForNavigation()', 'func load(login:')
  assert.match(suspend, /guard !busy else \{ return \}/)
  assert.doesNotMatch(suspend, /busy = false|verified = false|items = \[\]/)
  assert.match(model, /func submit\(_ action:/)
  assert.match(op, /\.interactiveDismissDisabled\(model.busy\)/)
})
test('03 already verified same-Owner operation quick rows survive a covered read cancellation', () => {
  const suspend = part(model, 'func suspendReadForNavigation()', 'func load(login:')
  assert.doesNotMatch(suspend, /items = \[\]|verified = false|expected = nil|status = nil/)
  assert.match(model, /return verified && XDriveIOSNativePhotoOwnerScope.matches\(current, expected\)/)
})
test('04 interrupted first Files operation GET is rearmed only when not verified and without terminal error', () => {
  assert.match(foreground, /if quickHistoryReadAttempted && operationShortcuts.loading &&\s*!operationShortcuts.verified && operationShortcuts.status == nil \{\s*quickHistoryReadAttempted = false\s*\}\s*operationShortcuts.suspendReadForNavigation\(\)/)
  assert.match(foreground, /if phase == \.active, let owner = login.owner,\s*!quickHistoryReadAttempted \{\s*quickHistoryReadAttempted = true/)
})
test('05 genuine terminal GET failure cannot start an invisible retry loop', () => {
  const disappear = part(foreground, '.onDisappear {\n            filesViewVisible = false', '.onChange(of: phase)')
  assert.match(disappear, /operationShortcuts.status == nil/)
  assert.match(model, /self.status = "无法验证文件操作历史，请检查网络后重试。"/)
})
test('06 Files screen visibility is measured from actual parent route, not inferred from login', () => {
  assert.match(files, /@State private var filesViewVisible = false/)
  assert.match(foreground, /\.onAppear \{\s*filesViewVisible = true/)
  assert.match(foreground, /\.onDisappear \{\s*filesViewVisible = false/)
})
test('07 background scene retires optional GET and re-arms on a real visible foreground return', () => {
  assert.match(foreground, /\.onChange\(of: phase\) \{ next in\s*if next != \.active \{[\s\S]*?operationShortcuts.suspendReadForNavigation\(\)/)
  assert.match(foreground, /\} else if filesViewVisible, !quickHistoryReadAttempted,\s*let owner = login.owner \{\s*quickHistoryReadAttempted = true\s*operationShortcuts.updateExpectedOwner\(owner\)\s*operationShortcuts.load\(login: login\)/)
})
test('08 hidden Files tab never requests another login Owners operation history', () => {
  assert.match(owner, /operationShortcuts.invalidate\(\)\s*\/\/ A hidden Files tab must not issue another Owner.s operation[\s\S]*?if filesViewVisible, phase == \.active, let owner = login.owner/)
  assert.match(owner, /quickHistoryReadAttempted = false/)
  assert.match(owner, /model.invalidate\(\)/)
})
test('09 Files tab cover retires operation GET without erasing Home Favorites navigation rows', () => {
  assert.match(foreground, /operationShortcuts.suspendReadForNavigation\(\)[\s\S]*?favoriteShortcuts.suspendForNavigation\(\)/)
  assert.match(foreground, /if homeReadAttempted && favoriteShortcuts.loading &&\s*!favoriteShortcuts.verified && favoriteShortcuts.error == nil/)
})
test('10 no-token real XCUITest opens operation-history child then returns to Gallery', () => {
  assert.match(ui, /func testFilesOperationHistorySheetDenialThenGalleryRetainsNativePages\(\)/)
  assert.match(ui, /openFilesOperationHistoryFromBrowse\(app\)/)
  assert.match(ui, /private func openFilesOperationHistoryFromBrowse\(_ app: XCUIApplication\)/)
  assert.match(ui, /let collection = app\.collectionViews\.firstMatch/)
  assert.match(ui, /var list: XCUIElement = app/)
  assert.match(ui, /else if collection\.exists \{ list = collection \}/)
  assert.match(ui, /for _ in 0\.\.<8 \{[\s\S]*?list\.swipeUp\(\)/)
  assert.match(ui, /XCTAssertTrue\(action\.isHittable/)
  assert.match(ui, /native-ios-files-operation-history-page/)
  assert.match(ui, /native-ios-files-operation-history-done/)
  assert.match(ui, /assertVisiblePixels\(app, route: "Gallery after denied Files operation history"\)/)
})
test('11 native foreground return under operation-history sheet is exercised with no token', () => {
  assert.match(ui, /func testFilesOperationHistoryBackgroundThenFilesGalleryReturn\(\)/)
  assert.match(ui, /XCUIDevice.shared.press\(\.home\)[\s\S]*?app.activate\(\)/)
  assert.match(ui, /assertVisiblePixels\(app, route: "Gallery after operations foreground"\)/)
})
test('12 all native Gallery/Files route tests have registered actual Simulator frame observers', () => {
  const a = read('ios/UITests/XDriveIOSGalleryFilesStabilityUITests.swift')
  const names = [...a.matchAll(/func (test\w+)\(\)/g), ...ui.matchAll(/func (test\w+)\(\)/g)]
    .map(x => x[1])
  const registered = new Set([...watcher.matchAll(/"(test\w+)"/g)].map(x => x[1]))
  // The six added Files size-filter H264 journeys increase 88 -> 94.
  // Treat count as a floor; check every actual method for unique registration
  // so future real additions cannot silently disappear or break CI just
  // because a fixed-size test was left behind.
  assert.ok(names.length >= 94, 'native Gallery/Files route coverage regressed')
  assert.equal(new Set(names).size, names.length)
  const sixRealChildRoutes = [
    "testFilesSavedSearchesRepeatedDismissalAndGalleryRoundTrips",
    "testFilesOperationHistoryThenSavedSearchesKeepsBothSheetsIndependent",
    "testFilesCloudDenialThenQuickSectionsKeepNativeContent",
    "testLocalPhotoTimelineSheetRepeatedAfterFilesReturns",
    "testGalleryPeopleRepeatedBackAndFilesReentryKeepsContent",
    "testGallerySourceFilterAndOriginalsRepeatedFilesReturn",
  ]
  for (const name of sixRealChildRoutes) {
    assert.ok(names.includes(name), name + ' genuine XCTest missing')
    assert.ok(registered.has(name), name + ' live screenshot registration missing')
  }
  assert.deepEqual(names.filter(n => !registered.has(n)), [])
})
test('13 operation-history regression runs in the required unsigned IPA workflow', () => {
  assert.match(ipa, /desktop\/tests\/ios-native-files-operation-cold-return-20261110\.cjs/)
  assert.match(ipa, /node --test desktop\/tests\/ios-native-files-undo-redo\.cjs/)
})

test('14 completed short XCUITest may not silently drop scheduled screenshot evidence', () => {
  assert.match(watcher, /def report_missed\(key, starts, taps\):/)
  assert.match(watcher, /report_missed\(key, missed_starts, missed_taps\)/)
  assert.match(watcher, /"reason": "test_finished_before_capture"/)
  assert.match(watcher, /scheduled = \[event for event in scheduled if event\[1\] != key\]/)
  assert.match(watcher, /tap_scheduled = \[event for event in tap_scheduled if event\[1\] != key\]/)
})
test('15 screenshot capture lag is separately reported rather than misrepresented as 60/120 Hz FPS', () => {
  const audit = read('ios/scripts/audit_navigation_frames.py')
  assert.equal((watcher.match(/"capture_request_lag_seconds":/g) || []).length, 4)
  assert.equal((watcher.match(/"reason": "capture_deadline_missed"/g) || []).length, 2)
  assert.match(watcher, /MAX_CAPTURE_LAG_SECONDS = 0\.75/)
  assert.equal((watcher.match(/"capture_duration_seconds":/g) || []).length, 2)
  assert.equal((watcher.match(/"capture_reliable": ok and/g) || []).length, 2)
  assert.match(watcher, /MAX_CAPTURE_DURATION_SECONDS = 2\.5/)
  assert.match(audit, /'capture_unreliable'/)
  assert.match(audit, /'capture_request_lag': \{/)
  assert.match(audit, /'p50_ms': percentile\(lags, \.50\)/)
  assert.match(audit, /'p95_ms': percentile\(lags, \.95\)/)
  assert.match(audit, /'finished_before_capture': sum\(/)
  assert.match(audit, /'is_fps_measurement': False, 'proves_zero_transient_flicker': False/)
})

test('16 real Simulator failure: offscreen Files Home operation entry is brought into viewport before tap', () => {
  const helper = ui.slice(ui.indexOf('private func openFilesOperationHistoryFromBrowse('),
    ui.indexOf('func testFilesOperationHistorySheetDenialThenGalleryRetainsNativePages()'))
  assert.match(helper, /assertFiles\(app\)/)
  assert.match(helper, /let table = app\.tables\.firstMatch/)
  assert.match(helper, /let collection = app\.collectionViews\.firstMatch/)
  assert.match(helper, /let scroll = app\.scrollViews\.firstMatch/)
  assert.match(helper, /if table\.exists \{ list = table \}/)
  assert.match(helper, /else if collection\.exists \{ list = collection \}/)
  assert.match(helper, /else if scroll\.exists \{ list = scroll \}/)
  assert.match(helper, /for _ in 0\.\.<8 \{\s*if action\.exists && action\.isHittable \{ break \}\s*list\.swipeUp\(\)/)
  assert.match(helper, /for _ in 0\.\.<8 \{\s*if action\.exists && action\.isHittable \{ break \}\s*list\.swipeDown\(\)/)
  assert.match(helper, /action\.waitForExistence\(timeout: 10\)/)
  assert.match(helper, /XCTAssertTrue\(action\.isHittable/)
  assert.match(helper, /action\.tap\(\)/)
  const history = ui.slice(ui.indexOf('func testFilesOperationHistorySheetDenialThenGalleryRetainsNativePages()'),
    ui.indexOf('func testRapidGalleryFilesAlternationKeepsBothNativeShellsAndPixels()'))
  assert.equal((history.match(/openFilesOperationHistoryFromBrowse\(app\)/g) || []).length, 2)
  assert.doesNotMatch(history, /tap\("native-ios-files-open-operations", app: app\)/)
})


test('17 every real Gallery/Files route has one watcher and H264 recording is isolated', () => {
  const wf = read('.github/workflows/ios-native-navigation-runtime.yml')
  const video = read('ios/scripts/files_ui_transition_video.py')
  const stability = read('ios/UITests/XDriveIOSGalleryFilesStabilityUITests.swift')
  const methods = [...stability.matchAll(/func (test\w+)\(\)/g),
                   ...ui.matchAll(/func (test\w+)\(\)/g)].map(m => m[1])
  const registered = new Set([...watcher.matchAll(/"(test\w+)"/g)].map(m => m[1]))
  const targetBlock = video.slice(video.indexOf('TARGETS = frozenset({'),
                                  video.indexOf('})', video.indexOf('TARGETS = frozenset({')))
  const h264 = new Set([...targetBlock.matchAll(/"(test\w+)"/g)].map(m => m[1]))
  assert.ok(methods.length >= 94, 'lost real native Gallery/Files coverage')
  assert.equal(new Set(methods).size, methods.length, 'duplicate native XCTest route')
  assert.ok(h264.size >= 18, 'lost genuine H264 source tests')
  assert.deepEqual(methods.filter(n => !registered.has(n)), [],
    'every real native route requires frame registration')
  assert.deepEqual([...h264].filter(n => !methods.includes(n)), [],
    'every real H264 target must be a genuine native XCTest')
  assert.equal(methods.filter(n => registered.has(n) && !h264.has(n)).length,
               methods.length - h264.size)
  assert.match(watcher, /exclude_h264_targets = len\(sys\.argv\) == 5/)
  assert.match(watcher, /from files_ui_transition_video import TARGETS as H264_TARGETS/)
  assert.match(watcher, /TARGETS\.difference_update\(H264_TARGETS\)/)
  assert.match(wf, /still_args\+=\(--exclude-h264-targets\)/)
  assert.match(wf, /if \[\[ "\$\{\{ matrix\.source \}\}" != "release-c83" \]\]/)
  assert.match(wf, /frame_watcher=\$!/)
  assert.match(wf, /video_watcher=\$!/)
  assert.match(wf, /trap cleanup_native_watchers EXIT/)
  assert.doesNotMatch(wf, /!= "candidate-gallery-files" \]\]; then/)
  const minClipGate = wf.match(/files_ui_transition_video\.py" audit[\s\S]*?--minimum (\d+)/)
  assert.ok(minClipGate, 'real H264 audit must remain mandatory')
  assert.ok(Number(minClipGate[1]) >= h264.size,
    'real H264 audit must cover every actual XCUITest target')
  assert.ok(wf.includes("timeout-minutes: ${{ matrix.source == 'candidate-gallery-files' && 100 || 60 }}"),
    "Gallery/Files 88-suite must not use the former whole-job 60-minute timeout")
})
