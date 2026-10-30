'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const repo = path.resolve(__dirname, '..', '..')
const cloud = fs.readFileSync(path.join(repo, 'ios/XDriveIOS/NativeCloudOriginalGallery.swift'), 'utf8')
const preview = cloud.slice(cloud.indexOf('struct XDriveIOSNativeCloudOriginalPreview: View'),
  cloud.indexOf('/// Only visible native cells'))

test('cloud Viewer never retains a signed video URL or still across scene background', () => {
  assert.match(preview, /@Environment\(\\\.scenePhase\) private var phase/)
  assert.match(preview, /@State private var previewRequestID = UUID\(\)/)
  assert.match(preview, /\.onChange\(of: phase\) \{ state in/)
  const lifecycle = preview.slice(preview.indexOf('.onChange(of: phase)'),
    preview.indexOf('.onChange(of: login.owner)'))
  assert.match(lifecycle, /if state != \.active \{/)
  assert.match(lifecycle, /player\?\.pause\(\)[\s\S]*?player = nil[\s\S]*?still = nil[\s\S]*?error = nil/)
  assert.match(lifecycle, /previewRequestID = UUID\(\)/)
})

test('scene reentry obtains a fresh current-Owner signed preview, not stale ticket', () => {
  assert.match(preview, /\.task\(id: previewRequestID\)/)
  assert.match(preview, /guard !node\.isLiveArchive, phase == \.active/)
  assert.match(preview, /login\.verifiedAuthorization\(\)/)
  assert.match(preview, /XDriveIOSNativeCloudOriginalReader\(/)
  assert.match(preview, /\.preview\(node\)/)
  assert.match(preview, /try Task\.checkCancellation\(\)/)
  assert.match(preview, /guard phase == \.active,/)
  assert.match(preview, /XDriveIOSNativePhotoOwnerScope\.matches\(login.owner, before\)/)
  assert.match(preview, /catch is CancellationError \{/)
  assert.match(preview, /!Task\.isCancelled/)
})

test('Owner switch and disappearance still retire player and image, no extra uploader', () => {
  assert.match(preview, /\.onChange\(of: login\.owner\) \{ _ in[\s\S]*?player\?\.pause\(\)[\s\S]*?still = nil[\s\S]*?dismiss\(\)/)
  assert.match(preview, /\.onDisappear \{[\s\S]*?player\?\.pause\(\)[\s\S]*?still = nil/)
  assert.doesNotMatch(preview, /UploadSessionTransport|SecItemAdd\(|document\.cookie|WKWebView/)
})

test('backup-original Viewer Retry starts one new Owner-verified ticket, not old pixels', () => {
  assert.match(preview, /else if let error \{[\s\S]*?Button\("重试"\) \{ retryPreview\(\) \}/)
  assert.match(preview, /native-ios-original-viewer-retry/)
  assert.match(preview, /let requestID = previewRequestID/)
  assert.match(preview, /previewRequestID == requestID/)
  assert.match(preview, /guard !node\.isLiveArchive, phase == \.active, login\.owner != nil/)
  assert.match(preview, /private func retryPreview\(\)[\s\S]*?player\?\.pause\(\)[\s\S]*?still = nil[\s\S]*?error = nil[\s\S]*?previewRequestID = UUID\(\)/)
  assert.match(preview, /\.task\(id: previewRequestID\)[\s\S]*?login\.verifiedAuthorization\(\)/)
  assert.doesNotMatch(preview, /UploadSessionTransport|SecItemAdd\(|document\.cookie|WKWebView/)
})
