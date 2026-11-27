'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root,p), 'utf8')
const helper = read('ios/UITests/XDriveIOSNavigationRuntimeUITests.swift')
test('ordinary Gallery and Files tests use only a visible real system Full Access choice', () => {
  assert.match(helper, /static func acceptInitialFullPhotosForNavigation\(in app: XCUIApplication\)/)
  assert.match(helper, /XCUIApplication\(bundleIdentifier: "com\.apple\.springboard"\)/)
  assert.match(helper, /systemAlert\.waitForExistence\(timeout: 5\)/)
  assert.match(helper, /title\.localizedCaseInsensitiveContains\("Photo Library"\)/)
  assert.match(helper, /"Allow Full Access"/)
  assert.match(helper, /"允许完全访问"/)
  assert.match(helper, /button\.exists && button\.isHittable[\s\S]*?button\.tap\(\)/)
  assert.match(helper, /XCTFail\("Real iOS Photos permission has no Full Access action/)
  assert.doesNotMatch(helper, /simctl privacy grant|launchEnvironment\["PhotoKit"|performChanges\(/)
})
test('frame capture, Gallery navigation and timed page tests acknowledge a real prompt before using More', () => {
  const suites = [
    'ios/UITests/XDriveIOSGalleryFilesFrameContinuityUITests.swift',
    'ios/UITests/XDriveIOSGalleryFilesStabilityUITests.swift',
    'ios/UITests/XDriveIOSPagePerformanceUITests.swift'
  ]
  for (const name of suites) {
    const source = read(name)
    const begin = source.indexOf('private func launch(')
    const end = source.indexOf('\n    private func ', begin + 15)
    assert.ok(begin >= 0 && end > begin, name)
    const launching = source.slice(begin,end)
    assert.match(launching, /app\.launch\(\)[\s\S]*?XDriveIOSNativePhotosTestNavigator\.acceptInitialFullPhotosForNavigation\(in: app\)/)
    assert.match(launching, /XCTAssertEqual\(app\.state, \.runningForeground/)
  }
})
test('no-Session security suite still explicitly denies real TCC, not silently Full Access', () => {
  const noSession = read('ios/UITests/XDriveIOSFilesSessionRecoveryUITests.swift')
  assert.match(noSession, /denyRealFirstRunPhotoAlertIfPresent/)
  assert.match(noSession, /"Don’t Allow"/)
  assert.doesNotMatch(noSession, /acceptInitialFullPhotosForNavigation/)
})
