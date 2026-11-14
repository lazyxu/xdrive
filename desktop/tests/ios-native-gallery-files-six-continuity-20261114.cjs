'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const ui = read('ios/UITests/XDriveIOSGalleryFilesTransitionEdgeUITests.swift')
const watcher = read('ios/scripts/capture-navigation-smoke-frames.py')
const video = read('ios/scripts/navigation_video_probe.py')
const workflow = read('.github/workflows/ios-native-navigation-runtime.yml')
const routes = [
  "testThreeRoundsGalleryFilesSectionsKeepVerifiedWallAndPixels",
  "testSavedSearchesTwoForegroundReturnsThenOriginalsRetiresSheet",
  "testOperationHistoryRotationPeopleReturnDoesNotRepushSheet",
  "testGalleryFilterCancelFilesSearchForegroundDoesNotGhostKeyboard",
  "testLocalPhotoKitDeniedCloudRotationKeepsPhotoChild",
  "testOriginalsHelpTwiceWithDeniedFilesKeepsPanelsRetired"
];

test('six new genuine Gallery/Files XCUITest journeys are registered exactly once for Simulator frames', () => {
  for (const name of routes) {
    assert.equal((ui.match(new RegExp('\\bfunc\\s+' + name + '\\(', 'g')) || []).length, 1, 'missing/duplicate XCTest: ' + name)
    assert.equal(watcher.split('"' + name + '"').length - 1, 1, 'missing/duplicate frame case: ' + name)
    assert.equal(video.split("'" + name + "':").length - 1, 1, 'missing/duplicate real H264 route: ' + name)
  }
  assert.match(workflow, /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSGalleryFilesTransitionEdgeUITests/)
  assert.match(ui, /IOS_NATIVE_NAV_TAP_START route=/)
  assert.match(ui, /assertPixels\(app, /)
  assert.doesNotMatch(ui, /XCTSkip|fakeToken|mockPhotoKit/)
})

test('six new journeys use actual page transitions, safe cloud denial and no fake authenticated Owner', () => {
  const start = ui.indexOf('func ' + routes[0] + '()')
  assert.ok(start >= 0)
  const added = ui.slice(start)
  for (const id of ['native-ios-tab-gallery', 'native-ios-tab-files', 'native-ios-gallery-source-originals', 'native-ios-files-open-root-location', 'native-ios-files-error-return', 'native-ios-local-timeline-open', 'native-ios-files-open-operations', 'native-ios-files-open-saved-searches']) {
    assert.ok(added.includes(id), 'missing native control: ' + id)
  }
  assert.match(added, /for cycle in 0\.\.<3/)
  assert.match(added, /XCTAssertEqual\(wall\.value as\? String, generation/)
  assert.match(added, /dismissRealFilesHomeSheet\(/)
  assert.match(added, /XCUIDevice\.shared\.press\(\.home\)/)
  assert.match(added, /device\.orientation = \.landscapeLeft/)
  assert.match(added, /XCTAssertFalse\(app\.keyboards\.firstMatch\.exists/)
  assert.match(added, /XCTAssertFalse\(target\("native-ios-files-grid", app\)\.exists/)
  assert.doesNotMatch(added, /login\.authenticate\(|POST\s+\/api|XCTSkip/)
})

