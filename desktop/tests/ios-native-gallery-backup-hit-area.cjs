'use strict'
const {test} = require('node:test')
const assert = require('node:assert/strict')
const {readFileSync} = require('node:fs')
const {join} = require('node:path')
const root = join(__dirname, '../..')
const ui = readFileSync(join(root, 'ios/XDriveIOS/NativePhotosDashboard.swift'), 'utf8')
const suite = readFileSync(join(root, 'ios/UITests/XDriveIOSNativeSubpagePerformanceUITests.swift'), 'utf8')

// Real Simulator run #43367128606: 5/20 routes failed because the
// full-height content-row Menu still lacked a valid AX hit point.
test('Gallery status row exposes one bounded real backup Menu and AX hit surface', () => {
  const a = ui.indexOf('private var galleryStatusRow:')
  const b = ui.indexOf('private var backupMenuItems:', a)
  assert.ok(a >= 0 && b > a)
  const status = ui.slice(a, b)
  assert.ok(status.includes('Menu { backupMenuItems } label: {'))
  assert.ok(status.includes('.frame(minWidth: 60, minHeight: 44)'))
  assert.ok(status.includes('.fixedSize(horizontal: true, vertical: false)'))
  assert.ok(status.includes('.contentShape(Rectangle())'))
  assert.ok(status.includes('.accessibilityIdentifier("native-ios-gallery-backup-settings")'))
  assert.equal(ui.split('.accessibilityIdentifier("native-ios-gallery-backup-settings")').length - 1, 1)
})

test('real UI performance checks fail closed on a hidden or covered Menu', () => {
  const start = suite.indexOf('private func tapVisibleGalleryBackup(')
  const end = suite.indexOf('private func reveal(', start)
  assert.ok(start >= 0 && end > start)
  const helper = suite.slice(start, end)
  assert.match(helper, /control\.waitForExistence\(timeout: 15\)/)
  assert.match(helper, /XCTAssertGreaterThanOrEqual\(control\.frame\.height, 43/)
  assert.match(helper, /XCTAssertGreaterThanOrEqual\(control\.frame\.width, 43/)
  assert.match(helper, /XCTAssertEqual\(controls\.count, 1/)
  assert.match(helper, /XCTAssertTrue\(control\.isHittable/)
  assert.match(helper, /control\.tap\(\)/)
  assert.doesNotMatch(helper, /XCTSkip|if !control\.isHittable[\s\S]*?return/)
})

test('all five previously failing Gallery backup paths remain mandatory', () => {
  for (const [name, route] of [
    ['GalleryBackupQueue', 'gallery.backup.queue'],
    ['GalleryBackupFocused', 'gallery.backup.focused'],
    ['GalleryBackupSettings', 'gallery.backup.settings'],
    ['GalleryBackupAudit', 'gallery.backup.audit'],
    ['GalleryCacheSheet', 'gallery.cache.sheet'],
  ]) {
    assert.ok(suite.includes('func testSubpage' + name + '() { run("' + route + '") }'), 'missing ' + route)
  }
  assert.match(suite, /XCTCPUMetric\(application: app\)/)
  assert.match(suite, /XCTMemoryMetric\(application: app\)/)
})
