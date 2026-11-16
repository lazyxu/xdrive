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
