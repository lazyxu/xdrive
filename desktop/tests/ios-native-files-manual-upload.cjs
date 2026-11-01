'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const s = read('ios/XDriveIOS/NativeFilesManualUpload.swift');
const view = read('ios/XDriveIOS/NativeCloudFilesBrowser.swift');
const transport = read('ios/XDriveIOS/NativeUploadSessionTransport.swift');
const stage = read('ios/XDriveIOS/NativeManualDocumentStage.swift');
const api = read('internal/api/router.go');

test('native Files-picker uploads reuse one verified foreground Server UploadSession writer', () => {
  assert.match(view, /import UniformTypeIdentifiers/);
  assert.match(view, /\.fileImporter\(isPresented: \$showingFileImporter,/);
  assert.match(view, /allowedContentTypes: \[\.item\]/);
  assert.match(s, /XDriveManualDocumentStager\.stage\(fileURL\)/);
  assert.match(s, /defer \{ staged\.delete\(\) \}/);
  assert.match(s, /XDriveNativeUploadSessionTransport\(/);
  assert.match(s, /\.uploadOnce\(\s*from: staged\.fileURL, name: staged\.originalName, parentID: parentID/);
  assert.match(s, /XDriveIOSOriginalRunGate\.shared\.acquire\(\)/);
  assert.match(s, /XDriveIOSOriginalRunGate\.shared\.release\(gate\)/);
  assert.match(transport, /path: "\/api\/v1\/uploads"/);
  assert.match(api, /POST\("\/uploads", s\.createUpload\)/);
  assert.match(stage, /static let maxFirstFileBytes: Int64 = 128 \* 1_048_576/);
  assert.doesNotMatch(s, /WKWebView\s*\(|document\.cookie|backgroundGrant:/);
});

test('nested-folder identity and original receipts are reverified, without blind retry after ACK uncertainty', () => {
  assert.match(s, /login\.verifiedAuthorization\(\)/);
  assert.match(s, /requireDestination\(parentID, expectedName: expectedFolderName\)/);
  assert.match(s, /requireCommitted\(receipt, parentID: parentID,/);
  assert.match(s, /XDriveIOSNativeFilesUploadConfirmationPolicy\.matches\(/);
  assert.match(s, /let node = try await getNode\(parentID\)/);
  assert.match(s, /node\.type == "dir", node\.revision > 0,/);
  assert.match(s, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)/);
  assert.match(s, /请刷新目录核对，不要盲目重复提交/);
  assert.match(view, /\.onDisappear \{\s*uploader\.invalidate\(\)/);
  assert.match(view, /Label\("上传文件", systemImage: "square.and.arrow.up"\)/);
});
