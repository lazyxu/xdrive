'use strict'
const {test} = require('node:test')
const assert = require('node:assert/strict')
const {readFileSync} = require('node:fs')
const {join} = require('node:path')
const root = join(__dirname, '../..')
const ui = readFileSync(join(root, 'ios/XDriveIOS/NativePhotosDashboard.swift'), 'utf8')
const suite = readFileSync(join(root, 'ios/UITests/XDriveIOSNativeSubpagePerformanceUITests.swift'), 'utf8')

// Reproduced from iOS 18.5 Simulator #43337504476: all five Gallery
// backup routes failed with a 49x15.3pt Menu AX box, hit point {-1,-1}.
test('Gallery backup Menu exposes a real 44pt touch target', () => {
  const a = ui.indexOf('private var galleryStatusRow:')
  const b = ui.indexOf('private var backupMenuItems:', a)
  assert.ok(a >= 0 && b > a)
  const header = ui.slice(a, b)
  assert.match(header, /Menu \{ backupMenuItems \} label: \{[\s\S]*?Label\("备份", systemImage: "icloud\.and\.arrow\.up"\)[\s\S]*?\.frame\(minWidth: 64, minHeight: 44\)[\s\S]*?\.contentShape\(Rectangle\(\)\)/)
  assert.match(header, /\.accessibilityIdentifier\("native-ios-gallery-backup-settings"\)/)
})

test('real UI performance checks fail closed on a collapsed or covered menu', () => {
  const start = suite.indexOf('private func tapVisibleGalleryBackup(')
  const end = suite.indexOf('private func reveal(', start)
  assert.ok(start >= 0 && end > start)
  const helper = suite.slice(start, end)
  assert.match(helper, /control\.waitForExistence\(timeout: 15\)/)
  assert.match(helper, /XCTAssertGreaterThanOrEqual\(control\.frame\.height, 43/)
  assert.match(helper, /XCTAssertTrue\(control\.isHittable/)
  assert.match(helper, /control\.coordinate\(withNormalizedOffset:[\s\S]*?\.tap\(\)/)
  assert.doesNotMatch(helper, /XCTSkip|if !control\.isHittable/)
})

test('all five previously failing Gallery backup paths remain mandatory', () => {
  for (const [name, route] of [
    ['GalleryBackupQueue', 'gallery.backup.queue'],
    ['GalleryBackupFocused', 'gallery.backup.focused'],
    ['GalleryBackupSettings', 'gallery.backup.settings'],
    ['GalleryBackupAudit', 'gallery.backup.audit'],
    ['GalleryCacheSheet', 'gallery.cache.sheet'],
  ]) {
    assert.ok(suite.includes(`func testSubpage${name}() { run("${route}") }`), `missing ${route}`)
  }
  assert.match(suite, /XCTCPUMetric\(application: app\)/)
  assert.match(suite, /XCTMemoryMetric\(application: app\)/)
})
