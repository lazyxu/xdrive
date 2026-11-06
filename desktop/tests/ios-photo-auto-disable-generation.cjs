'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const store = read('ios/XDriveIOS/PhotoAutoScheduleStore.swift')
const controller = read('ios/XDriveIOS/NativePhotoBackupController.swift')

function functionBody(source, signature) {
  const start = source.indexOf(signature)
  assert.ok(start >= 0, 'missing ' + signature)
  const end = source.indexOf('\n    }', start)
  assert.ok(end > start, 'missing function end for ' + signature)
  return source.slice(start, end + 6)
}

test('stopping one Owner invalidates in-flight automatic enable before removing plan', () => {
  const disable = functionBody(store, '    func disable(owner: XDriveNativeOwnerRoot)')
  const bump = disable.indexOf('localStopGeneration &+= 1')
  const removal = disable.indexOf('UserDefaults.standard.removeObject(forKey: key(for: owner))')
  assert.ok(bump >= 0 && removal > bump,
    'stop must invalidate delayed consent before removing this Owner schedule')
  assert.doesNotMatch(disable, /clearLedger|deleteReceipt|revokePendingRequests|UploadSession/)
})

test('automatic configure checks captured stop generation after awaited credentials and target proof', () => {
  const configure = controller.slice(
    controller.indexOf('    func configure('),
    controller.indexOf('    /// Local stop')
  )
  const captured = configure.indexOf('let stopVersion = store.localStopGeneration')
  const first = configure.indexOf('let first = try await login.verifiedAuthorization()')
  const second = configure.indexOf('let second = try await login.verifiedAuthorization()')
  const proof = configure.indexOf('.readExistingForUpload(')
  const persisted = configure.indexOf('schedule = try store.configure(')
  assert.ok(captured >= 0 && first > captured && second > first &&
    proof > second && persisted > proof, 'capture generation before all async proofs')
  const checks = [...configure.matchAll(/store\.localStopGeneration == stopVersion/g)]
  assert.ok(checks.length >= 2, 'both pre- and post-target proof fences must remain')
  assert.ok(checks[0].index > second && checks[0].index < proof,
    'recheck stop generation before target proof')
  assert.ok(checks[checks.length - 1].index > proof &&
    checks[checks.length - 1].index < persisted,
    'recheck stop generation immediately before saving the plan')
})

test('native stop and global emergency stop both invalidate pending consent without erasing receipts', () => {
  const nativeStop = controller.slice(
    controller.indexOf('    func disable(owner:'),
    controller.indexOf('    func startManual(')
  )
  assert.match(nativeStop, /cancel\(\)/)
  assert.match(nativeStop, /XDriveIOSPhotoAutoScheduleStore\.shared\.disable\(owner: owner\)/)
  assert.doesNotMatch(nativeStop, /clearLedger|deleteReceipt|revokePendingRequests/)
  const emergency = functionBody(store, '    func disableAllOnThisDevice()')
  assert.match(emergency, /localStopGeneration &\+= 1/)
  assert.match(emergency, /xdrive\.ios\.photos\.auto\.v1\./)
})
