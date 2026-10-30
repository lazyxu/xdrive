'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const controller = read('ios/XDriveIOS/NativePhotoBackupController.swift')
const dashboard = read('ios/XDriveIOS/NativePhotosDashboard.swift')
const gallery = read('ios/XDriveIOS/NativeCloudOriginalGallery.swift')
const authScope = read('ios/XDriveIOS/NativePhotoOwnerScope.swift')

test('only confirmed new Original Node receipts signal UI invalidation', () => {
  assert.match(controller, /struct ConfirmedOriginalUpdate: Equatable/)
  assert.match(controller, /@Published private\(set\) var confirmedOriginalUpdate/)
  assert.match(controller, /if result\.uploaded > 0 \{[\s\S]*confirmedOriginalUpdate = ConfirmedOriginalUpdate\(/)
  const index = controller.indexOf('if result.uploaded > 0')
  assert.ok(index > controller.indexOf('try Task.checkCancellation()', controller.indexOf('let result = try await')))
  assert.ok(index > controller.indexOf('XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected)', controller.indexOf('let result = try await')))
  assert.match(controller, /owner: selected, id: UUID\(\)/)
  assert.doesNotMatch(controller, /NotificationCenter\.default\.post|document\.cookie|WKWebView/)
})

test('Gallery refresh is exact Owner scoped and deferred during full-screen preview', () => {
  assert.match(dashboard, /XDriveIOSNativeCloudOriginalGallery\([\s\S]*login: login,[\s\S]*confirmedOriginalUpdate: backup\.confirmedOriginalUpdate/)
  assert.match(gallery, /\.onChange\(of: confirmedOriginalUpdate\) \{ update in/)
  assert.match(gallery, /XDriveIOSNativePhotoOwnerScope\.matches\(login.owner, update.owner\)/)
  assert.match(gallery, /if selected != nil \{\s*refreshAfterViewer = true\s*\} else \{\s*model\.reload\(login: login\)/)
  assert.match(gallery, /\.fullScreenCover\(item: \$selected, onDismiss: \{[\s\S]*if refreshAfterViewer \{[\s\S]*model\.reload\(login: login\)/)
  assert.match(gallery, /\.onChange\(of: login.owner\) \{ _ in[\s\S]*?refreshAfterViewer = false[\s\S]*?selected = nil\s*model\.invalidate\(\)/)
  assert.match(controller, /!XDriveIOSNativePhotoOwnerScope\.matches\(owner, last.owner\) \{\s*confirmedOriginalUpdate = nil/)
  assert.match(authScope, /current\.instanceID == expected\.instanceID/)
  assert.doesNotMatch(gallery, /UploadSessionTransport|window\.webkit|localStorage/)
})

test('no backup uploader or signed Viewer URL is changed by a read-only refresh event', () => {
  assert.match(controller, /XDriveIOSForegroundPhotoBackupMVP\(/)
  assert.match(controller, /XDriveIOSOriginalRunGate\.shared\.acquire\(\)/)
  assert.match(controller, /XDriveIOSPhotoAutoScheduleStore\.shared\.recordResult/)
  assert.match(gallery, /request\(url, bearer: false\)/)
  assert.match(gallery, /player\?\.pause\(\)[\s\S]*?still = nil[\s\S]*?dismiss\(\)/)
})

test('native cloud originals recheck after scene return without treating BG writes as receipts', () => {
  const wall = gallery.slice(gallery.indexOf('struct XDriveIOSNativeCloudOriginalGallery: View'));
  const model = gallery.slice(gallery.indexOf('final class XDriveIOSNativeCloudOriginalModel'),
    gallery.indexOf('struct XDriveIOSNativeCloudOriginalPreview: View'));
  assert.match(wall, /@Environment\(\\\.scenePhase\) private var phase/);
  assert.match(wall, /@State private var needsForegroundReload = false/);
  assert.match(wall, /\.task \{[\s\S]*?guard phase == \.active else \{[\s\S]*?needsForegroundReload = true/);
  assert.match(wall, /\.onChange\(of: phase\) \{ state in/);
  assert.match(wall, /if state != \.active \{[\s\S]*?needsForegroundReload = true[\s\S]*?model\.cancel\(\)/);
  assert.match(wall, /guard needsForegroundReload else \{ return \}/);
  assert.match(wall, /guard login\.owner != nil else \{[\s\S]*?model\.invalidate\(\)/);
  assert.match(wall, /if selected != nil \{[\s\S]*?refreshAfterViewer = true[\s\S]*?\} else \{[\s\S]*?model\.reload\(login: login\)/);
  assert.match(wall, /if phase != \.active \{[\s\S]*?needsForegroundReload = true[\s\S]*?return/);
  assert.match(wall, /if login\.owner != nil \{[\s\S]*?if phase == \.active \{[\s\S]*?model\.reload\(login: login\)/);
  assert.match(model, /let auth = try await login\.verifiedAuthorization\(\)/);
  assert.match(model, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)/);
  assert.doesNotMatch(wall, /UploadSessionTransport|markUploaded|recordResult\(/);
});
