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
test('12 all 68 native Gallery/Files route tests are registered with Simulator screenshot observer', () => {
  const a = read('ios/UITests/XDriveIOSGalleryFilesStabilityUITests.swift')
  const names = [...a.matchAll(/func (test\w+)\(\)/g), ...ui.matchAll(/func (test\w+)\(\)/g)]
    .map(x => x[1])
  const registered = new Set([...watcher.matchAll(/"(test\w+)"/g)].map(x => x[1]))
  assert.equal(names.length, 68)
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
  assert.match(helper, /let list = app\.tables\.firstMatch\.exists \? app\.tables\.firstMatch :\s*app\.scrollViews\.firstMatch/)
  assert.match(helper, /for _ in 0\.\.<6 \{\s*if action\.isHittable \{ break \}\s*list\.swipeUp\(\)/)
  assert.match(helper, /action\.waitForExistence\(timeout: 10\)/)
  assert.match(helper, /XCTAssertTrue\(action\.isHittable/)
  assert.match(helper, /action\.tap\(\)/)
  const history = ui.slice(ui.indexOf('func testFilesOperationHistorySheetDenialThenGalleryRetainsNativePages()'),
    ui.indexOf('func testRapidGalleryFilesAlternationKeepsBothNativeShellsAndPixels()'))
  assert.equal((history.match(/openFilesOperationHistoryFromBrowse\(app\)/g) || []).length, 2)
  assert.doesNotMatch(history, /tap\("native-ios-files-open-operations", app: app\)/)
})
