'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const src = p => readFileSync(resolve(__dirname, '../..', p), 'utf8')
const native = src('ios/XDriveIOS/NativeCloudFilesBrowser.swift')
const management = src('ios/XDriveIOS/NativeFilesManagementPanel.swift')
const policy = src('ios/XDriveIOS/NativeCloudFilesPolicy.swift')
const pwa = src('web/src/MobileFiles.tsx')

test('P0 Native/PWA Files rail order and 64-file upload text', () => {
  assert.match(native, /case recent,\s*browse,\s*favorites/)
  const nav = pwa.slice(pwa.indexOf("['recent', <HistoryRoundedIcon/>"),
    pwa.indexOf("['recent', <HistoryRoundedIcon/>") + 300)
  assert.match(nav, /\['recent'[\s\S]*\['browse'[\s\S]*\['favorites'/)
  assert.match(native, /上传多个文件（最多 64 项）/)
  assert.doesNotMatch(native, /上传多个文件（最多 8 项）/)
  assert.match(src('ios/XDriveIOS/NativeFilesUploadBatchPolicy.swift'), /static let maximumFiles = 64/)
})

test('P0 Files dock exposes safe direct download/delete plus existing actions', () => {
  const dock = native.split('private var filesSelectionToolbar: some View {')[1]
    .split('private func prepareSelectedExport() {')[0]
  for (const action of ['复制', '移动', '下载', '删除']) {
    assert.ok(dock.includes('selectionDockAction("' + action + '"'), action)
  }
  assert.match(dock, /native-ios-files-batch-direct-download/)
  assert.match(dock, /native-ios-files-batch-direct-trash/)
  assert.match(native, /directDownloadSelected\(\)[\s\S]*?quickAction: \.download\)[\s\S]*?prepareSelectedExport\(\)/)
  assert.match(dock, /showingBatchTrashConfirmation = true/)
})

test('P1 sort/group anchor is Owner and revision verified; view switch retains node', () => {
  assert.match(policy, /enum XDriveIOSNativeFilesReanchorPolicy/)
  assert.match(policy, /position\.revision == node\.revision/)
  assert.match(policy, /found\.id == node\.id && found\.revision == node\.revision/)
  assert.match(native, /private func reloadKeepingArrangementAnchor\(\)/)
  assert.match(native, /XDriveIOSNativeFilesReanchorPolicy\.verifiedDestination\(/)
  assert.match(native, /pendingNavigationReturnNodeID = anchored\.id/)
  assert.match(native, /returnScroll\.scrollTo\(anchor, anchor: \.center\)/)
  assert.match(native, /arrangementTask\?\.cancel\(\)/)
})

test('P1 management-only native tag CRUD never writes an empty tag assignment', () => {
  assert.match(native, /native-ios-files-home-manage-tags/)
  assert.match(native, /native-ios-files-toolbar-manage-tags/)
  assert.match(native, /nodeIDs: \[\], selectionLabel: "管理所有标签"/)
  assert.match(management, /if nodeIDs\.isEmpty \{\s*rows = \[\]/)
  assert.match(management, /func toggle\(_ tagID: UInt64\) \{\s*guard !nodeIDs\.isEmpty/)
  assert.match(management, /if !self\.nodeIDs\.isEmpty \{\s*try await client\.setNodes/)
  assert.match(management, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expectedOwner\)/)
})

test('P0 crash regression is an executable real Simulator test', () => {
  const workflow = src('.github/workflows/ios-native-navigation-runtime.yml')
  const xctest = src('ios/UITests/XDriveIOSNavigationRuntimeUITests.swift')
  assert.match(workflow, /xcodebuild test/)
  assert.match(workflow, /release-c83,\s*candidate/)
  assert.match(xctest, /testFilesFirstOpenAndSixGalleryReturnsDoNotExit/)
  assert.match(xctest, /testFilesRecentBrowseFavoritesRepeatedWithoutCrash/)
})
