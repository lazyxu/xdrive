'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = p => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8')
const files = read('ios/XDriveIOS/NativeCloudFilesBrowser.swift')
const location = read('ios/XDriveIOS/NativeFilesLocationPolicy.swift')
const locate = read('ios/XDriveIOS/NativeFilesSearchLocation.swift')
const window = read('ios/XDriveIOS/NativeFilesContinuousWindowPolicy.swift')
const operations = read('ios/XDriveIOS/NativeFilesOperationHistory.swift')
const upload = read('ios/XDriveIOS/NativeFilesManualUpload.swift')
const panel = read('ios/XDriveIOS/NativeFilesManagementPanel.swift')
const ui = read('ios/UITests/XDriveIOSNavigationRuntimeUITests.swift')
const stability = read('ios/UITests/XDriveIOSGalleryFilesStabilityUITests.swift')

test('P0 actual Simulator child recoveries are independent of the Files virtual List', () => {
  assert.match(files, /native-ios-files-error-page/)
  assert.match(files, /native-ios-files-error-return/)
  assert.match(stability, /XCTAttachment\(screenshot:/)
  assert.match(ui, /testFilesHomeInlineEditKeepsBrowseShellAndRestoresDone/)
})

test('P1 location menu is Owner-bound, exact-revision and reverified before navigation', () => {
  assert.match(location, /static func directoryBreadcrumbs\(/)
  assert.match(location, /parent\(of: selected, at: location, ownerRootID: ownerRootID\) != nil/)
  assert.match(locate, /func verifiedDirectoryBreadcrumbs\(/)
  assert.match(locate, /guard after == selected/)
  assert.match(files, /native-ios-files-path-dropdown/)
  assert.match(files, /found\.contains\(crumb\), found\.last\?\.id == folder\.id/)
})

test('P1 compact Home supports direct inline pin editing without a second sheet', () => {
  assert.match(files, /native-ios-files-home-edit-toggle/)
  assert.match(files, /native-ios-files-pinned-inline-unpin-/)
  assert.match(files, /ForEach\(Array\(quickAccess\.items\.prefix\(isHomeEditing/)
  assert.match(files, /Section\("整理"\)/)
})

test('P1 remote ordinal jumps use one bounded verified page and reanchor scroll', () => {
  assert.match(window, /static func pageContaining\(itemNumber: Int, total: Int\)/)
  assert.match(window, /itemNumber > 0, itemNumber <= total/)
  assert.match(files, /native-ios-files-jump-to-index/)
  assert.match(files, /pendingJumpIndex = number - 1/)
  assert.match(files, /returnScroll\.scrollTo\(node\.id, anchor: \.center\)/)
})

test('P1 Undo/Redo is a one-shot operation with explicit Owner and confirmation', () => {
  assert.match(files, /native-ios-files-undo-shortcut/)
  assert.match(files, /native-ios-files-redo-shortcut/)
  assert.match(files, /operationShortcuts\.matches\(login\.owner\)/)
  assert.match(files, /operationShortcuts\.submit\(/)
  assert.match(operations, /结果尚未确认。请先刷新操作历史核对，不要重复提交。/)
})

test('P1 batch attributes are explicit and never invent recursive folder sizes', () => {
  assert.match(files, /native-ios-files-batch-properties-sheet/)
  assert.match(files, /只统计所选文件，不包含文件夹内未加载内容/)
  assert.match(files, /XDriveIOSNativeFilesSelectionPolicy\.validItems/)
})

test('P1 folder upload only resumes proven pre-POST staging failures', () => {
  assert.match(upload, /if error is XDriveManualDocumentStageError/)
  assert.match(upload, /prior\.keys == steps\.map\(\\\.key\)/)
  assert.match(upload, /prior\.pickedPath == folderURL\.standardizedFileURL\.path/)
  assert.match(upload, /proof\.requireCommitted\(/)
  assert.match(upload, /proof\.requireCreatedDirectory\(/)
  assert.match(upload, /completedAll \? \.confirmed/)
  assert.match(upload, /folderCheckpoint = nil/)
  assert.match(panel, /native-ios-files-folder-resume/)
  assert.match(panel, /native-ios-files-folder-upload-progress/)
})
