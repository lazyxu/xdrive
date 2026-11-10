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


test('release-c83 runtime fallback taps observed AX labels, never guessed screen coordinates', () => {
  const testSource = src('ios/UITests/XDriveIOSNavigationRuntimeUITests.swift')
  assert.match(testSource, /private func legacyControl\(/)
  assert.match(testSource, /app\.buttons\.matching\(identifier: "native-ios-five-slot-bar"\)/)
  assert.match(testSource, /app\.buttons\.matching\(identifier: "native-ios-files-quick-rail"\)/)
  assert.match(testSource, /"files": "文件"/)
  assert.match(testSource, /"recent": "最近", "browse": "浏览", "favorites": "收藏"/)
  assert.match(testSource, /legacy\.waitForExistence\(timeout: 5\)/)
  assert.match(testSource, /app\.state, \.runningForeground/)
  assert.doesNotMatch(testSource, /normalizedCoordinate|coordinate\(withNormalizedOffset:/)
})

test('real Simulator smoke is triggered by Files/Gallery subroute edits, not only Browser', () => {
  const workflow = src('.github/workflows/ios-native-navigation-runtime.yml')
  const watched = workflow.split('  workflow_dispatch:')[0]
  assert.match(watched, /^on:\s*pull_request:\s*paths:/m)
  const routes = [
    'ios/XDriveIOS/NativeCloudFilesBrowser.swift',
    'ios/XDriveIOS/NativeFilesViewer.swift',
    'ios/XDriveIOS/NativeFilesSearchLocation.swift',
    'ios/XDriveIOS/NativeFilesVersionHistory.swift',
    'ios/XDriveIOS/NativeFilesCollections.swift',
    'ios/XDriveIOS/NativeFilesManagementPanel.swift',
    'ios/XDriveIOS/NativePhotosDashboard.swift',
    'ios/XDriveIOS/NativeUnifiedPhotoGallery.swift',
    'ios/XDriveIOS/NativePhotoAlbumBrowser.swift',
    'ios/XDriveIOS/NativeLocalPhotoGallery.swift',
  ]
  for (const route of routes) {
    assert.ok(watched.includes("      - '" + route + "'"),
      'Native subroute changes must trigger the real Simulator smoke: ' + route)
  }
  assert.doesNotMatch(watched, /-\s*'ios\/\*\*'/,
    'Do not make unrelated iOS modules consume two expensive Simulator jobs')
  assert.match(workflow, /xcodebuild test/)
  assert.match(workflow, /source:\s*\[release-c83,\s*candidate-navigation,\s*candidate-gallery-files,\s*candidate-no-session\]/)
  // A real release baseline is informational; both candidate suites are hard
  // gates, never waived because a stale c83 build or older PR was green.
  assert.match(workflow, /candidate-navigation\)[\s\S]*?XDriveIOSNavigationRuntimeUITests/)
  assert.match(workflow, /candidate-gallery-files\)[\s\S]*?XDriveIOSGalleryFilesStabilityUITests/)
  assert.match(workflow, /continue-on-error:.*matrix\.source == 'release-c83'/)
  // A no-token smoke only validates mounting/return and process survival;
  // it is not proof of logged-in Owner data or real audio/video playback.
  const fixture = src('ios/scripts/prepare-navigation-runtime-smoke.py')
  assert.match(fixture, /Deliberately no active Session\/token/)
})
