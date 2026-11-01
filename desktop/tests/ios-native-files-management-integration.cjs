'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = p => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')
const files = read('ios/XDriveIOS/NativeCloudFilesBrowser.swift')
const viewer = read('ios/XDriveIOS/NativeFilesViewer.swift')
const management = read('ios/XDriveIOS/NativeFilesManagementPanel.swift')
const login = read('ios/XDriveIOS/NativeOwnerLoginModel.swift')

test('Files retains the same independent native L3 Viewer and file-specific action sheet', () => {
  assert.match(files, /\.fullScreenCover\(item: \$selectedFile, onDismiss:/)
  assert.match(files, /XDriveIOSNativeFilesViewer\(/)
  assert.match(files, /selectedOwner = owner[\s\S]*?lastViewedFile = entry\.node[\s\S]*?selectedFile = entry/)
  assert.match(files, /returnScroll\.scrollTo\(target\.id, anchor: \.center\)/)
  assert.match(files, /\.sheet\(item: \$managementIntent, onDismiss:/)
  assert.match(files, /XDriveIOSNativeFilesManagementPanel\(/)
  assert.match(files, /folderID: folder\?\.id \?\? intent\.owner\.rootNodeID/)
  assert.match(files, /guard model\.entries\.contains\(where: \{ \$0\.node == node \}\)/)
  assert.match(files, /managementIntent = nil\s*selectedFile = nil/)
  assert.match(files, /if selectedFile == nil \{ model\.invalidate\(\) \}/)
  assert.match(viewer, /XDriveIOSNativeFilesPreviewReader\(/)
  assert.match(management, /let expectedOwner: XDriveNativeOwnerRoot/)
  assert.match(management, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expectedOwner\)/)
  assert.doesNotMatch(management, /QuickLook|quickLookPreview|WKWebView|URLRequest\(url:.*http:\/\//)
})

test('native file management uses one Owner/root authorization envelope without altering photo writer', () => {
  assert.match(login, /func verifiedAuthorization\(\) async throws/)
  assert.match(management, /\.onChange\(of: login\.owner\) \{ _ in/)
  assert.match(management, /if !verified \{\s*invalidate\(\)\s*dismiss\(\)/)
  for (const action of [
    'XDriveIOSNativeFilesDirectoryCreator',
    'XDriveIOSNativeFilesManualUploadModel',
    'XDriveIOSNativeFilesExportModel',
    'XDriveIOSNativeFilesMutationModel',
    'XDriveIOSNativeFilesDestinationMutationModel',
  ]) {
    assert.ok(management.includes(action), 'missing native action: ' + action)
  }
  assert.match(management, /onConfirmed: finishConfirmed/)
  assert.match(management, /private func finishConfirmed\(\)/)
  assert.doesNotMatch(files, /\/api\/v1\/uploads|\.uploadOnce\(|\.fileImporter\(/)
})
