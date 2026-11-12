'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = name => fs.readFileSync(path.join(__dirname, '../..', name), 'utf8')

test('Files no-session UI tests enter the persisted Browse selection rather than just locating its rail', () => {
  const tests = read('ios/UITests/XDriveIOSFilesSessionRecoveryUITests.swift')
  const ui = read('ios/XDriveIOS/NativeCloudFilesBrowser.swift')
  const helper = tests.slice(tests.indexOf('private func files(_ app:'), tests.indexOf('private func expect(_ id:'))
  assert.match(helper, /browse\.value as\? String/)
  assert.match(helper, /tap\("native-ios-files-section-browse", app\)/)
  assert.match(helper, /XCTAssertEqual\(browse\.value as\? String, "已选择"/)
  assert.match(helper, /native-ios-files-home-list/)
  assert.match(ui, /accessibilityIdentifier\(isHome \? "native-ios-files-home-list"/)
  assert.doesNotMatch(helper, /if browse\.exists \{ return \}/)
})

test('Home short cuts require hittable real rows and tests isolate portrait at launch', () => {
  const tests = read('ios/UITests/XDriveIOSFilesSessionRecoveryUITests.swift')
  assert.match(tests, /XCUIDevice\.shared\.orientation = \.portrait/)
  assert.match(tests, /if !item\.exists \|\| !item\.isHittable \{/)
  assert.match(tests, /let list = element\("native-ios-files-home-list", app\)/)
  assert.match(tests, /list\.swipeUp\(\)/)
  assert.match(tests, /list\.swipeDown\(\)/)
  assert.match(tests, /func testOrganizeHomeRotationGalleryFilesRoundtrip\(\)/)
})

test('landscape screenshot guard resolves real UI text rather than removing the blank-frame assertion', () => {
  const tests = read('ios/UITests/XDriveIOSFilesSessionRecoveryUITests.swift')
  const start = tests.indexOf('private func assertNonuniformFrame(')
  const end = tests.indexOf('func testCloudFolderNoSession', start)
  const snippet = tests.slice(start, end)
  assert.match(snippet, /let width = 96, height = 64/)
  assert.match(snippet, /XCTAssertGreaterThan\(colors\.count, 8/)
  assert.match(snippet, /app\.screenshot\(\)/)
})

test('dynamic tab checks real selected feature or Map shortcut, not a nonexistent MapKit child', () => {
  const source = read('ios/UITests/XDriveIOSAllPagesCrashUITests.swift')
  const suite = source.slice(source.indexOf('func testFiveTabsWithForegroundReturnDoNotCrash'), source.indexOf('func testDynamicRecentPicker'))
  for (const id of ['native-ios-backup-overview', 'ios-clipboard-status', 'native-ios-transfer-overview', '笔记来源', '打开地图']) {
    assert.ok(suite.includes(id), 'Missing actual dynamic destination ' + id)
  }
  assert.doesNotMatch(suite, /native-ios-map-source-selector/)
  assert.match(suite, /app\.activate\(\)/)
})

test('startup readiness re-arms after visible login restore state changes', () => {
  const source = read('ios/XDriveIOS/NativeOwnerLoginScreen.swift')
  const app = read('ios/XDriveIOS/XDriveIOSApp.swift')
  const recovery = read('ios/UITests/XDriveIOSB9ReleaseCrashUITests.swift')
  assert.match(source, /\.onChange\(of: restoreFinished\) \{ finished in\s*if finished \{ armReadinessAfterMount\(\) \}/)
  assert.match(source, /XDriveIOSNativeLaunchCheckpoint\.mayFinishStartup\(/)
  assert.match(source, /XDriveIOSNativeLaunchCheckpoint\.mark\(\.ready\)/)
  assert.match(app, /native-ios-startup-recovery/)
  assert.match(recovery, /testPublishedB9RealColdStartAndRestart/)
  assert.match(recovery, /Normal restart entered recovery or failed to mount/)
})
