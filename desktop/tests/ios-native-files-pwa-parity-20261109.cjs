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

test('P0 native Files lifecycle is split into bounded SwiftUI view types', () => {
  for (const method of [
    'filesForegroundLifecycle',
    'filesOwnerLifecycle',
    'filesNavigationLifecycle',
    'filesArrangementLifecycle',
    'filesLoadingLifecycle',
  ]) {
    assert.match(files, new RegExp('private func ' + method + '\\(returnScroll: ScrollViewProxy\\) -> some View'))
  }
  assert.match(files, /var body: some View \{\s*ScrollViewReader \{ returnScroll in\s*filesLoadingLifecycle\(returnScroll: returnScroll\)/)
  assert.doesNotMatch(files, /var body: some View \{\s*ScrollViewReader \{ returnScroll in\s*filesModals/)
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

test('P1 direct folder upload delegates to the one Owner-verified native importer', () => {
  assert.match(files, /native-ios-files-quick-folder-upload/)
  assert.match(files, /openManagement\(for: nil, quickAction: \.uploadFolder\)/)
  assert.match(files, /上传文件夹（最多 512 MiB）/)
  assert.match(files, /login\.owner == nil \|\| !activeQuery\.isEmpty/)
  assert.match(panel, /case createFolder, uploadFile, uploadMultiple, uploadFolder/)
  assert.match(panel, /case \.uploadFolder:[\s\S]*?guard file == nil, directory == nil else \{ return \}[\s\S]*?showingFolderImporter = true/)
  assert.match(panel, /allowedContentTypes: \[\.folder\]/)
  assert.match(panel, /uploader\.start\([\s\S]*?folderURL: pickedFolder/)
  assert.match(panel, /前台最多 128 个文件、64 个目录、总计 512 MiB、8 层/)
})

test('P2 list and grid share one verified PWA-style metadata projection', () => {
  assert.match(files, /private func filesDisplayMetadata\(_ entry: XDriveIOSNativeFilesEntry\) -> String\?/)
  assert.match(files, /entry\.path\?\.trimmingCharacters/)
  assert.match(files, /calendar\.dateComponents\(\[\.year, \.month, \.day\]/)
  assert.match(files, /case 0: dateLabel = "今天"/)
  assert.match(files, /case 1: dateLabel = "昨天"/)
  assert.match(files, /case 2: dateLabel = "前天"/)
  assert.match(files, /fromByteCount: entry\.node\.size, countStyle: \.file/)
  assert.match(files, /return \[dateLabel, sizeLabel\]\.compactMap/)
  assert.equal((files.match(/filesDisplayMetadata\(entry\)/g) ?? []).length, 2)
  assert.match(files, /accessibilityValue\(selectedIDs\.contains\(entry\.id\) \? "已选中" : "未选中"\)/)
})

test('P0 existing Files rail, Viewer and Owner fence are preserved without extra app tabs', () => {
  const viewer = read('ios/XDriveIOS/NativeFilesViewer.swift')
  assert.match(files, /private var filesMain: some View/)
  assert.match(files, /native-ios-files-quick-rail/)
  assert.match(files, /resumeStore\.saveSection\(option\.rawValue, owner: owner\)/)
  assert.match(viewer, /private func commitNeighbor\(_ next: XDriveIOSNativeFilesNode\)/)
  assert.match(viewer, /guard !isClosing, authorized, onNavigate\(next\) else \{ return \}/)
  assert.match(viewer, /retire\(\)\s*active = next/)
  assert.match(viewer, /guard generation == attempt, viewed == current, authorized/)
  assert.match(viewer, /player\?\.replaceCurrentItem\(with: nil\)/)
  assert.match(files, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, intent\.owner\)/)
})
