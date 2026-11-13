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
test('Gallery has one 44pt backup Menu in its native navigation toolbar', () => {
  const nav = ui.slice(ui.indexOf('var body: some View'), ui.indexOf('private var nativeBottomBar:'))
  assert.match(nav, /\.navigationTitle\("图库"\)[\s\S]*?ToolbarItem\(placement: \.navigationBarTrailing\)[\s\S]*?galleryCompactBackupAction/)
  const a = ui.indexOf('private var galleryStatusRow:')
  const b = ui.indexOf('private var backupMenuItems:', a)
  assert.ok(a >= 0 && b > a)
  assert.doesNotMatch(ui.slice(a, b), /Menu \{ backupMenuItems \}/)
  const m = ui.slice(ui.indexOf('private var galleryCompactBackupAction:'),
                     ui.indexOf('private var gallery: some View'))
  assert.match(m, /Menu \{ backupMenuItems \} label: \{[\s\S]*?Label\("备份", systemImage:/)
  assert.match(m, /\.frame\(minWidth: 64, minHeight: 44\)[\s\S]*?\.contentShape\(Rectangle\(\)\)/)
  assert.match(m, /\.accessibilityIdentifier\("native-ios-gallery-backup-settings"\)/)
  assert.equal((ui.match(/\.accessibilityIdentifier\("native-ios-gallery-backup-settings"\)/g) || []).length, 1)
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
