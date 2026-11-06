'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

const epoch = read('ios/XDriveIOS/PhotoKitLibraryEpoch.swift')
const scanner = read('ios/XDriveIOS/PhotoKitBoundedSnapshotScanner.swift')
const exporter = read('ios/XDriveIOS/PhotoKitOriginalExporter.swift')
const preparer = read('ios/XDriveIOS/PhotoKitStagedIntentPreparer.swift')
const controller = read('ios/XDriveIOS/NativePhotoBackupController.swift')
const bgControls = read('ios/XDriveIOS/NativePhotoBackgroundControls.swift')
const queueSummary = read('ios/XDriveIOS/NativePhotoQueueSummaryModel.swift')
const screen = read('ios/XDriveIOS/NativePhotoBackupScreen.swift')
const priority = read('ios/XDriveIOS/PhotoPriorityBackupSection.swift')

test('PhotoKit backup scans and durable change cursors require all-photos authorization', () => {
  assert.match(epoch, /guard authorization == \.authorized else/)
  assert.doesNotMatch(epoch, /authorization == \.authorized \\|\\| authorization == \.limited/)
  assert.match(scanner, /status == \.authorized \\|\\| \\(!requireStableResume && album == nil && status == \.limited\\)/)
  assert.match(read('ios/XDriveIOS/ForegroundPhotoBackupMVP.swift'),
    /atOffset: startOffset, requireStableResume: true/)
  // Gallery's read-only local timeline can still show the permitted subset.
  assert.match(scanner, /if requireStableResume \\{/)
  assert.match(scanner, /limitedAuthorization: initialAuthorization == \.limited/)
})

test('every original byte export and revision recheck rejects partial Photos access', () => {
  assert.match(exporter, /return status == \.authorized/)
  assert.doesNotMatch(exporter, /return status == \.authorized \\|\\| status == \.limited/)
  assert.match(preparer, /guard authorization == \.authorized,/)
  assert.match(preparer, /guard access == \.authorized,/)
  assert.doesNotMatch(preparer, /authorization == \.authorized \\|\\| authorization == \.limited/)
})

test('auto scheduling, manual/priority starts and BG grant admission use full library scope', () => {
  assert.equal((controller.match(/\\[\\.authorized\\]\\.contains\\(/g) || []).length, 7)
  assert.equal((bgControls.match(/\\[\\.authorized\\]\\.contains\\(/g) || []).length, 5)
  assert.equal((queueSummary.match(/\\[\\.authorized\\]\\.contains\\(/g) || []).length, 2)
  for (const source of [controller, bgControls, queueSummary]) {
    assert.doesNotMatch(source, /\\[\\.authorized, \\.limited\\]\\.contains\\(/)
  }
  assert.match(priority, /PHPhotoLibrary\\.authorizationStatus\\(for: \\.readWrite\\) != \\.authorized/)
  assert.match(priority, /PHPhotoLibrary\\.authorizationStatus\\(for: \\.readWrite\\) == \\.authorized/)
})

test('native Photo Backup UI blocks uploads under Limited while leaving read-only coverage', () => {
  const backupControls = screen.slice(0, screen.indexOf('    @ViewBuilder\\n    private var backupStatusSections'))
  const readOnly = screen.slice(screen.indexOf('    @ViewBuilder\\n    private var backupStatusSections'))
  assert.ok(backupControls.length > 0 && readOnly.length > 0)
  assert.match(backupControls, /仅部分照片授权暂不支持/)
  assert.match(backupControls, /备份需要“所有照片”权限，自动备份已暂停/)
  assert.match(backupControls, /自动备份已暂停：需要“所有照片”权限/)
  assert.doesNotMatch(backupControls, /\\[\\.authorized, \\.limited\\]\\.contains\\(/)
  assert.match(readOnly, /snapshot\\.limitedAuthorization/)
  assert.match(readOnly, /当前为 iOS 部分照片授权/)
  assert.match(screen, /photoAuthorization != \.authorized\\)\\s*\\.accessibilityIdentifier\\("native-ios-photo-background-enable"\\)/)
})
