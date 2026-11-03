'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const cleanup = read('ios/XDriveIOS/PhotoStagingCleanup.swift')
const exporter = read('ios/XDriveIOS/PhotoKitOriginalExporter.swift')
const swiftTest = read('ios/tests/PhotoStagingCleanupChecks.swift')

test('only exporter-generated UUID temporary folders can be reaped, not Owner receipts', () => {
  assert.match(cleanup, /static let folderPrefix = "xdrive-photo-export-"/)
  assert.match(cleanup, /uuid\.uuidString == suffix/)
  assert.match(cleanup, /attrs\.isDirectory == true, attrs\.isSymbolicLink != true/)
  assert.match(cleanup, /minimumAge: TimeInterval = 48 \* 60 \* 60/)
  assert.match(cleanup, /maximumPerPass = 16/)
  assert.match(cleanup, /now\.timeIntervalSince\(touched\) > minimumAge/)
  assert.match(cleanup, /children\.count <= 3/)
  assert.match(cleanup, /childName == "resource-0"/)
  assert.match(cleanup, /childName == "resource-1"/)
  assert.match(cleanup, /childName == "original-live-pair.zip"/)
  assert.match(cleanup, /values\.isRegularFile == true/)
  assert.match(cleanup, /values\.isSymbolicLink != true/)
  assert.doesNotMatch(cleanup, /clearLocalRecords|Keychain|PhotoAsset|UploadSession|ServerAddress|URLSession|\.removePersistentDomain/)
})

test('cleanup is best-effort and is invoked BEFORE new staging directory creation', () => {
  const stage = exporter.slice(exporter.indexOf('static func stage('),
    exporter.indexOf('private static func writeResource('))
  assert.ok(stage)
  assert.match(stage, /XDriveIOSPhotoStagingCleanup\.removeOrphans\(/)
  assert.ok(stage.indexOf('removeOrphans(') < stage.indexOf('FileManager.default.createDirectory('))
  assert.match(exporter, /defer \{ try\? handle\.close\(\) \}/)
  assert.match(exporter, /try\? FileManager.default.removeItem\(at: folder\)/)
  assert.match(swiftTest, /limit: 1/)
  assert.match(swiftTest, /"do-not-delete"/)
  assert.match(swiftTest, /createSymbolicLink\(/)
  assert.match(swiftTest, /PhotoStagingCleanup\.removeOrphans/)
})

test('local staging disk failures abort the whole backup window rather than advancing past files', () => {
  const runner = read('ios/XDriveIOS/ForegroundPhotoBackupMVP.swift')
  const gate = exporter.slice(exporter.indexOf('private final class PhotoKitRequestGate'),
    exporter.indexOf('enum XDrivePhotoKitOriginalExporter'))
  const stage = exporter.slice(exporter.indexOf('static func stage('),
    exporter.indexOf('private static func writeResource('))
  const copy = exporter.slice(exporter.indexOf('private static func writeResource('))

  // A failed disk write can be received on a PhotoKit callback queue.
  // It must cancel the resource request and enter the global abort branch.
  assert.match(gate, /try handle\.write\(contentsOf: data\)/)
  assert.match(gate, /catch \{[\s\S]*?failure = XDrivePhotoKitExportFailure\.storageUnavailable\s*toCancel = requestID/)
  assert.match(gate, /if let toCancel \{ manager\.cancelDataRequest\(toCancel\) \}/)
  assert.match(gate, /let error = failure \?\? photoError/)
  assert.match(stage, /do \{\s*try FileManager\.default\.createDirectory\(/)
  assert.match(stage, /catch \{[\s\S]*?throw XDrivePhotoKitExportFailure\.storageUnavailable\s*\}\s*var staged:/)
  assert.match(stage, /else \{ throw XDrivePhotoKitExportFailure\.storageUnavailable \}/)
  assert.match(stage, /catch \{\s*try\? FileManager\.default\.removeItem\(at: folder\)\s*throw error/)
  assert.match(copy, /do \{\s*handle = try FileHandle\(forWritingTo: url\)\s*\} catch \{\s*throw XDrivePhotoKitExportFailure\.storageUnavailable/)
  assert.match(copy, /try Task\.checkCancellation\(\)\s*do \{\s*try handle\.synchronize\(\)\s*\} catch \{[\s\S]*?throw XDrivePhotoKitExportFailure\.storageUnavailable/)
  assert.match(runner, /case \.storageUnavailable = source \{\s*return true/)
  assert.match(runner, /if Self\.isTransientConfirmedReadbackFailure\(error\) \|\|\s*Self\.mustAbortRun\(after: error\) \{ throw error \}/)

  // iCloud-only, unsupported and oversize resources remain distinct
  // per-item outcomes; no new upload writer or background credential.
  assert.match(exporter, /case originalResourceMissing/)
  assert.match(exporter, /case incompleteLivePair/)
  assert.match(exporter, /case resourceTooLarge/)
  assert.doesNotMatch(exporter, /UploadSession|UserDefaults|kSecAttrAccessible|WKWebView/)
});
