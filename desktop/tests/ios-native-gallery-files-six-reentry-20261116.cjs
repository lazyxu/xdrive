const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "../..")
const browser = fs.readFileSync(
  path.join(root, "ios/XDriveIOS/NativeCloudFilesBrowser.swift"), "utf8")
const navigation = fs.readFileSync(
  path.join(root, "ios/UITests/XDriveIOSGalleryFilesFrameContinuityUITests.swift"), "utf8")
const video = fs.readFileSync(
  path.join(root, "ios/scripts/files_ui_transition_video.py"), "utf8")

test("Files More shows the real organizer action before large picker menus", () => {
  const menuStart = browser.indexOf(
    "ToolbarItem(placement: .navigationBarTrailing) {\n                if !selecting {\n                    Menu {")
  assert.ok(menuStart >= 0, "real Files More toolbar must exist")
  const menu = browser.slice(menuStart, browser.indexOf(
    '.accessibilityIdentifier("native-ios-files-more-options")', menuStart))
  const organizer = menu.indexOf(
    '.accessibilityIdentifier("native-ios-files-toolbar-organize-home")')
  const picker = menu.indexOf('Picker("显示方式"')
  assert.ok(organizer >= 0 && picker >= 0 && organizer < picker,
    "Home organizer must precede nested sort/view/group pickers")
  assert.match(menu, /Button \{ presentOrganizeHome\(\) \} label:/)
  assert.equal((menu.match(/native-ios-files-toolbar-organize-home/g) || []).length, 1)
})

test("six new native Gallery/Files child paths are executed and video-audited", () => {
  const names = [
    "testFilesSavedSearchesRepeatedDismissalAndGalleryRoundTrips",
    "testFilesOperationHistoryThenSavedSearchesKeepsBothSheetsIndependent",
    "testFilesCloudDenialThenQuickSectionsKeepNativeContent",
    "testLocalPhotoTimelineSheetRepeatedAfterFilesReturns",
    "testGalleryPeopleRepeatedBackAndFilesReentryKeepsContent",
    "testGallerySourceFilterAndOriginalsRepeatedFilesReturn",
  ]
  for (const name of names) {
    assert.ok(navigation.includes("func " + name + "()"), name + " XCTest missing")
    assert.ok(video.includes('"' + name + '"'), name + " real H264 target missing")
  }
  const start = navigation.indexOf("private func openFilesSavedSearchesFromBrowse")
  assert.ok(start > 0)
  const helper = navigation.slice(start, navigation.indexOf(
    "func testFilesSavedSearchesRepeated", start))
  assert.match(helper, /action\.isHittable/)
  assert.match(helper, /IOS_NATIVE_NAV_TAP_START route=native-ios-files-open-saved-searches/)
  for (const name of names) {
    const pos = navigation.indexOf("func " + name + "()")
    const next = navigation.indexOf("\n    func test", pos + 4)
    const body = navigation.slice(pos, next >= 0 ? next : undefined)
    assert.match(body, /waitForRealH264RecordingPrelude\(\)/)
    assert.match(body, /assertVisiblePixels\(app,/)
  }
})

test("Both Files Home sheet helpers use the real Browse and target row, not an offscreen root", () => {
  const helpers = [
    ["openFilesOperationHistoryFromBrowse",
     "testFilesOperationHistorySheetDenialThenGalleryRetainsNativePages"],
    ["openFilesSavedSearchesFromBrowse",
     "testFilesSavedSearchesRepeatedDismissalAndGalleryRoundTrips"],
  ]
  for (const [method, nextTest] of helpers) {
    const start = navigation.indexOf("private func " + method + "(")
    const end = navigation.indexOf("func " + nextTest + "()", start)
    assert.ok(start >= 0 && end > start, method + " must exist")
    const body = navigation.slice(start, end)
    const browse = body.indexOf('tap("native-ios-files-section-browse", app: app)')
    const row = body.indexOf('let action = target("native-ios-files-open-')
    assert.ok(browse >= 0 && row > browse,
              method + " must tap real Browse and locate a genuine Home action")
    assert.doesNotMatch(body, /target\("native-ios-files-open-root-location"/,
                        "An unmounted Cloud root sibling is not proof of Browse navigation")
    assert.match(body, /if action\.exists && action\.isHittable/)
    assert.match(body, /\.swipeUp\(\)/)
    assert.match(body, /\.swipeDown\(\)/)
    assert.match(body, /XCTAssertTrue\(action\.isHittable/)
    assert.match(body, /action\.tap\(\)/)
  }
  assert.match(browser, /accessibilityIdentifier\("native-ios-files-open-root-location"\)/)
})

test("six additional executable Gallery and Files child lifecycle journeys", () => {
  const names = [
    "testSavedSearchesAfterFavoritesRecentThenGallery",
    "testOperationHistoryForegroundFromRecentKeepsSheet",
    "testCloudDenialSavedSearchesReturnDoesNotResurrectError",
    "testGalleryPeopleRotationFilesGalleryKeepsPage",
    "testOriginalsHelpFilesHistoryThenOriginals",
    "testLocalPhotoDateSheetForegroundFilesThenLocal",
  ]
  for (const name of names) {
    const start = navigation.indexOf("func " + name + "()")
    assert.ok(start > 0, name + " real XCTest missing")
    const next = navigation.indexOf("\n    func test", start + 6)
    const body = navigation.slice(start, next < 0 ? undefined : next)
    assert.match(body, /assertVisiblePixels\(app,/)
    assert.match(body, /waitForExistence\(timeout: 15\)/)
  }
  const frame = navigation.slice(navigation.indexOf("private func assertVisiblePixels("),
    navigation.indexOf("private func openLocalPhotoSource("))
  assert.match(frame, /let width = 96, height = 64/)
  assert.match(frame, /image\.cropping\(to: contentRegion\)/)
  assert.match(frame, /context\.draw\(content,/)
  assert.match(navigation, /XCUIDevice\.shared\.orientation = \.portrait/)
})


test("six additional Gallery Files error and lifecycle stress cases are executed", () => {
  const names = [
    "testCloudTrashDenialsAlbumsOriginalsUnifiedAreReadable",
    "testSavedSearchHistoryForegroundAfterReverseSheetSequence",
    "testPeopleLocalPhotoKitFilesQuickSectionsPreserveLocalWall",
    "testGalleryFilterCancelThenCloudDenialKeepsNoGhostSheet",
    "testFilesHistoryRotationOriginalsForegroundPreservesChild",
    "testLocalPhotoDateThenTrashDenialRestoresPhotoKit",
  ]
  const watcher = fs.readFileSync(
    path.join(root, "ios/scripts/capture-navigation-smoke-frames.py"), "utf8")
  for (const name of names) {
    const pos = navigation.indexOf("func " + name + "()")
    assert.ok(pos >= 0, name + " real XCTest missing")
    const end = navigation.indexOf("\n    func test", pos + 5)
    const body = navigation.slice(pos, end >= 0 ? end : undefined)
    assert.match(body, /waitForExistence\(timeout: 15\)/)
    assert.match(body, /assertVisiblePixels\(app,/)
    assert.ok(watcher.includes('"' + name + '"'), name + " live recording registration missing")
  }
  const stability = fs.readFileSync(
    path.join(root, "ios/UITests/XDriveIOSGalleryFilesStabilityUITests.swift"), "utf8")
  const check = stability.slice(stability.indexOf("private func assertNotSolidScreen("),
    stability.indexOf("func testGalleryFilesAlternationRetainsNonBlankSettledFrames"))
  assert.match(check, /let width = 96, height = 64/)
  assert.match(check, /image\.cropping\(to: contentRect\)/)
  assert.match(check, /context\.draw\(content,/)
  assert.match(stability, /XCUIDevice\.shared\.orientation = \.portrait/)
})

test("PhotoKit date-sheet foreground uses stable real close ID, not unrelated nav bar", () => {
  const localTimeline = fs.readFileSync(
    path.join(root, "ios/XDriveIOS/NativePhotoTimelineBrowser.swift"), "utf8")
  assert.match(localTimeline,
    /Button\("完成"\) \{ showingDates = false \}[\s\S]*?accessibilityIdentifier\("native-ios-local-timeline-done"\)/)
  const start = navigation.indexOf("func testLocalPhotoDateSheetForegroundFilesThenLocal()")
  const end = navigation.indexOf("\n    func test", start + 5)
  const body = navigation.slice(start, end > start ? end : undefined)
  assert.ok(start > 0 && end > start)
  assert.match(body, /target\("native-ios-local-timeline-done", app: app\)/)
  assert.match(body, /XCUIDevice\.shared\.press\(\.home\)/)
  assert.match(body, /LOCAL_PHOTOKIT_DATE_FOREGROUND_MISSING/)
  assert.match(body, /XCTAssertTrue\(done\.exists,/)
  assert.match(body, /done\.tap\(\)/)
})


// The genuine iOS 18.5 Simulator failure was AXScrollToVisibleAction on
// an already visible bottom tab (real frame x=231.9, y=764.5), not a
// missing gallery/file destination. Require strict on-window frame checks
// and a real coordinate tap, not test-only navigation injection.
test("native Gallery-Files bottom tabs use real on-screen frames on AX scroll failure", () => {
  const start = navigation.indexOf("private func tap(_ id: String, app: XCUIApplication)")
  const end = navigation.indexOf("private func assertGallery(", start)
  assert.ok(start >= 0 && end > start)
  const body = navigation.slice(start, end)
  assert.match(body, /element\.waitForExistence\(timeout: 15\)/)
  assert.match(body, /\["native-ios-tab-files", "native-ios-tab-gallery"\]\.contains\(id\)/)
  assert.match(body, /XCTAssertTrue\(window\.exists/)
  assert.match(body, /XCTAssertFalse\(tabFrame\.isEmpty/)
  assert.match(body, /XCTAssertTrue\(windowFrame\.contains\(midpoint\)/)
  assert.match(body, /XCTAssertGreaterThan\(midpoint\.y,/)
  assert.match(body, /window\.coordinate\([\s\S]*?withOffset\(CGVector\(/)
  assert.match(body, /navigationTap\.tap\(\)/)
  assert.match(body, /\} else \{\s*element\.tap\(\)/)
  assert.match(body, /XCTAssertEqual\(app\.state, \.runningForeground/)
  // Keep downstream real destination/screenshot assertions in the tests.
  assert.match(navigation, /func testGallerySourceFilterAndOriginalsRepeatedFilesReturn\(\)/)
  assert.match(navigation, /assertFiles\(app\)/)
  assert.match(navigation, /assertGallery\(app\)/)
})
