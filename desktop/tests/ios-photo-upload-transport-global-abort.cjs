'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const runner = read('ios/XDriveIOS/ForegroundPhotoBackupMVP.swift')
const transport = read('ios/XDriveIOS/NativeUploadSessionTransport.swift')
const writer = read('ios/XDriveIOS/IOSJournaledOriginalUpload.swift')

test('UploadSession errors that affect all originals must abort auto and BG windows before cursor advancement', () => {
  const abort = runner.slice(runner.indexOf('private static func mustAbortRun('),
    runner.indexOf('private enum StillOutcome'))
  const run = runner.slice(runner.indexOf('func run('),
    runner.indexOf('    /// Explicit one-photo priority upload.'))
  assert.match(transport, /enum XDriveNativeUploadError: Error/)
  assert.match(transport, /case unauthorizedOrRejected\(Int\)/)
  assert.match(transport, /case invalidServerResponse/)
  assert.match(transport, /case uncertainCommit/)
  assert.match(transport, /case localStorageUnavailable/)
  assert.match(abort, /if let upload = error as\? XDriveNativeUploadError \{/)
  assert.match(abort, /case \.unauthorizedOrRejected\(_\), \.invalidServerResponse,\s*\.uncertainCommit, \.localStorageUnavailable:\s*return true/)
  assert.match(abort, /case \.invalidLocalFile:\s*\/\/ A staged file/)
  assert.match(run, /if Self\.isTransientConfirmedReadbackFailure\(error\) \|\|\s*Self\.mustAbortRun\(after: error\) \{ throw error \}/)
  assert.match(writer, /guard let current, current\.state == \.prepared else \{/)
  assert.match(writer, /throw error/)
})

test('invalidLocalFile remains an item-local failure only after the journal proves it never wrote', () => {
  const abort = runner.slice(runner.indexOf('private static func mustAbortRun('),
    runner.indexOf('private enum StillOutcome'))
  assert.match(abort, /case \.invalidLocalFile:[\s\S]*?break/)
  assert.doesNotMatch(abort, /case \.invalidLocalFile:\s*return true/)
  assert.match(writer, /last\.state != \.prepared, last\.state != \.confirmed/)
  assert.match(transport, /if let expectedSHA256, expectedSHA256 != hashes\.full \{/)
  assert.match(transport, /throw XDriveNativeUploadError\.invalidLocalFile/)
})

test('lost server ACK still pauses for explicit reconciliation instead of blind original retry', () => {
  const run = runner.slice(runner.indexOf('private func uploadOrVerifyOriginal('))
  assert.match(run, /case \.creating, \.uploading, \.finalizing, \.needsReconciliation:/)
  assert.match(run, /return \.requiresReview/)
  assert.match(run, /current\.state == \.prepared else \{/)
  assert.match(run, /throw error/)
  assert.match(transport, /throw XDriveNativeUploadError\.uncertainCommit/)
})
