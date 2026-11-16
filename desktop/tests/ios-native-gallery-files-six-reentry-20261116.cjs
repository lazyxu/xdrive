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
const timeline = fs.readFileSync(
  path.join(root, "ios/XDriveIOS/NativePhotoTimelineBrowser.swift"), "utf8")
const sixSubpage = fs.readFileSync(
  path.join(root, "ios/UITests/XDriveIOSGalleryFilesSixSubpageUITests.swift"), "utf8")

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

test("Both Files Home sheet helpers use the retained Home List and bidirectional scroll", () => {
  const helpers = [
    ["openFilesOperationHistoryFromBrowse",
     "testFilesOperationHistorySheetDenialThenGalleryRetainsNativePages"],
    ["openFilesSavedSearchesFromBrowse",
     "testFilesSavedSearchesRepeatedDismissalAndGalleryRoundTrips"],
  ]
  for (const [method, nextTest] of helpers) {
    const start = navigation.indexOf("private func " + method + "(")
    const end = navigation.indexOf("func " + nextTest + "()", start)
    assert.ok(start >= 0 && end > start)
    const body = navigation.slice(start, end)
    const browse = body.indexOf('tap("native-ios-files-section-browse", app: app)')
    const home = body.indexOf('target("native-ios-files-home-list", app: app)')
    const action = body.indexOf('let action = target("native-ios-files-open-')
    assert.ok(browse >= 0 && home > browse && action > home)
    assert.match(body, /value == %@/)
    assert.match(body, /home\.waitForExistence\(timeout: 15\)/)
    assert.match(body, /home\.swipeUp\(\)/)
    assert.match(body, /home\.swipeDown\(\)/)
    assert.match(body, /action\.isHittable/)
    assert.doesNotMatch(body, /target\("native-ios-files-open-root-location"/,
      "the first Lazy List row is allowed to remain offscreen")
    assert.doesNotMatch(body, /app\.(?:tables|collectionViews|scrollViews)\.firstMatch/,
      "only the actual mounted Files Home List may be scrolled")
  }
  assert.match(browser, /accessibilityIdentifier\(isHome \? "native-ios-files-home-list" : "native-ios-files-folder-list"\)/)
})


test("six extra child-to-child native H264 journeys verify visible content", () => {
  const names = ["testOriginalsHelpHistoryReturnWithoutGhostAlert","testHistoryForegroundAlbumsReturnWithoutGhostSheet","testLocalPhotoFavoritesRecentDateAfterFilesReturn","testPeopleCloudDenialPeopleReentryKeepsContent","testSavedSearchFilterHistorySheetsStayIndependent","testAlbumsOriginalsFilesSectionRoundTripKeepsSource"]
  for (const name of names) {
    const start = navigation.indexOf("func " + name + "()")
    assert.ok(start >= 0, "missing XCUITest: " + name)
    const next = navigation.indexOf("\n    func test", start + 4)
    const body = navigation.slice(start, next < 0 ? undefined : next)
    assert.ok(body.includes("waitForRealH264RecordingPrelude()"), name + " has no real video prelude")
    assert.ok(body.includes("assertVisiblePixels(app,"), name + " never inspects child pixels")
    assert.ok(body.includes('tap("native-ios-tab-files"'), name + " never visits Files")
    assert.ok(body.includes('tap("native-ios-tab-gallery"'), name + " never revisits Gallery")
    assert.ok(video.includes('"' + name + '"'), name + " was not added to H264 recorder")
  }
  assert.ok(video.includes("fps=30,scale=64:64,crop=64:40"), "30 Hz source capture missing")
  assert.ok(video.includes('"decoded_30hz_samples": len(frames)'), "30 Hz evidence count missing")
})


test("real Local PhotoKit date sheet closes by its own AX id and survives foreground", () => {
  assert.match(timeline,
    /Button\("完成"\) \{ showingDates = false \}\s*\.accessibilityIdentifier\("native-ios-local-timeline-done"\)/)
  const methods = [
    "testLocalPhotoTimelineDateSheetDismissThenFilesReturnKeepsContent",
    "testLocalPhotoTimelineSheetRepeatedAfterFilesReturns",
    "testLocalPhotoFavoritesRecentDateAfterFilesReturn",
  ]
  for (const name of methods) {
    const start = navigation.indexOf("func " + name + "()")
    const next = navigation.indexOf("\n    func test", start + 5)
    assert.ok(start >= 0, "native Local PhotoKit test missing: " + name)
    const body = navigation.slice(start, next < 0 ? undefined : next)
    assert.match(body, /target\("native-ios-local-timeline-done", app: app\)/)
    assert.doesNotMatch(body, /app\.navigationBars\.buttons\["完成"\]/)
    assert.match(body, /done\.tap\(\)/)
  }
  const foregroundStart = navigation.indexOf(
    "func testLocalPhotoTimelineSheetRepeatedAfterFilesReturns()")
  const foregroundEnd = navigation.indexOf("\n    func test", foregroundStart + 5)
  const foreground = navigation.slice(foregroundStart, foregroundEnd < 0 ? undefined : foregroundEnd)
  assert.match(foreground,
    /XCUIDevice\.shared\.press\(\.home\)[\s\S]*?app\.activate\(\)[\s\S]*?done\.waitForExistence\(timeout: 15\)/)
  assert.match(sixSubpage, /control\("native-ios-local-timeline-done", app\)/)
  assert.match(sixSubpage, /testLocalPhotoDateAndFilesSavedSheetReturnKeepsPhotoKitChild/)
})
