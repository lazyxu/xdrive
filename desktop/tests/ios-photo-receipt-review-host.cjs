'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const filename = path.join(root, 'web/src/iosPhotoHostAdapter.ts')
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((compiled.diagnostics || [])
  .filter(d => d.category === ts.DiagnosticCategory.Error)
  .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
const loaded = { exports: {} }
new Function('module', 'exports', compiled.outputText)(loaded, loaded.exports)
const createHost = loaded.exports.xDriveCreateIOSPhotoBackupHost
assert.equal(typeof createHost, 'function')

function nativeHarness(enabled = true) {
  const previous = global.window, listeners = new Map(), timers = new Map(), sent = []
  let seq = 0
  const add = (event, callback) => {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event).add(callback)
  }
  const emit = (event, detail) => {
    for (const callback of [...(listeners.get(event) || [])]) callback({ detail })
  }
  const window = {
    location: { protocol: 'https:' },
    crypto: { randomUUID: () =>
      '00000000-0000-4000-8000-' + String(++seq).padStart(12, '0') },
    addEventListener: add,
    removeEventListener: (event, callback) => listeners.get(event)?.delete(callback),
    setTimeout: (callback, ms) => {
      const id = seq + 10000
      timers.set(id, { callback, ms })
      return id
    },
    clearTimeout: id => timers.delete(id),
  }
  if (enabled) window.webkit = { messageHandlers: { xdriveIOSHost: {
    postMessage: message => sent.push(message),
  } }
  }
  global.window = window
  return {
    window, sent, emit,
    reply(message, data, ok = true) {
      emit('xdrive-ios-host-response', {
        id: message.id, ok, ...(ok ? { data } : { error: data }),
      })
    },
    pendingListeners: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
    pendingTimers: () => timers.size,
    restore() {
      if (previous === undefined) delete global.window
      else global.window = previous
    },
  }
}
async function negotiate(host, native, flags) {
  const started = host.capabilities()
  const msg = native.sent.at(-1)
  assert.equal(msg.method, 'capabilities')
  assert.equal(msg.version, 1)
  native.reply(msg, {
    protocolVersion: 1, platform: 'ios', photoKit: true,
    foregroundStillBackup: true, ...flags,
  })
  assert.equal(await started, true)
}
const owner = {
  username: 'verified-owner', ownerID: 41, accessToken: 'short-lived-web-token',
}
const review = {
  pending: 2, checked: 1, confirmed: 0, activeUnverified: 1,
  missing: 0, expired: 0, ambiguous: 0, stage: '只读核对',
}

test('normal browser and insecure origin do not expose a native receipt Host', () => {
  const native = nativeHarness(false)
  try {
    assert.equal(createHost(), null)
    native.window.location.protocol = 'http:'
    native.window.webkit = { messageHandlers: { xdriveIOSHost: {
      postMessage() { throw Error('must not run') },
    } } }
    assert.equal(createHost(), null)
    assert.equal(native.sent.length, 0)
  } finally { native.restore() }
})

test('old IPA rejects receipt operations before calling native code', async () => {
  const native = nativeHarness()
  try {
    const host = createHost()
    assert.ok(host)
    await negotiate(host, native, { scanWindows: true })
    assert.equal(host.receiptReviewSupported, false)
    const before = native.sent.length
    await assert.rejects(host.reviewStatus(owner), /不支持本地收据核对/)
    await assert.rejects(host.reviewPending(owner, () => {}), /不支持本地收据核对/)
    assert.equal(native.sent.length, before)
    assert.equal(native.pendingListeners(), 0)
    assert.equal(native.pendingTimers(), 0)
  } finally { native.restore() }
})

test('current Owner receipt status, bounded progress and cancellation share one native bridge', async () => {
  const native = nativeHarness()
  try {
    const host = createHost()
    await negotiate(host, native, { scanWindows: true, receiptReview: true })
    assert.equal(host.receiptReviewSupported, true)
    const status = host.reviewStatus(owner), statusMsg = native.sent.at(-1)
    assert.equal(statusMsg.method, 'photos.reconcile.status')
    assert.deepEqual(statusMsg.params, owner)
    native.reply(statusMsg, { pending: 2, maxPerRun: 20 })
    assert.deepEqual(await status, { pending: 2, maxPerRun: 20 })
    const observed = []
    const pending = host.reviewPending(owner, value => observed.push(value))
    const msg = native.sent.at(-1)
    assert.equal(msg.method, 'photos.reconcile.start')
    assert.deepEqual(msg.params, owner)
    assert.notEqual(msg.id, statusMsg.id)
    native.emit('xdrive-ios-host-progress', { id: statusMsg.id, data: review })
    assert.equal(observed.length, 0, 'stale request cannot paint Owner progress')
    native.emit('xdrive-ios-host-progress', { id: msg.id, data: review })
    assert.deepEqual(observed, [review])
    native.reply(msg, review)
    assert.deepEqual(await pending, review)
    const cancel = host.cancel(), cancelMsg = native.sent.at(-1)
    assert.equal(cancelMsg.method, 'photos.backup.cancel')
    native.reply(cancelMsg, { cancelRequested: true })
    await cancel
    assert.equal(native.sent.some(x => x.method === 'photos.backup.start'), false)
    assert.equal(native.pendingListeners(), 0)
    assert.equal(native.pendingTimers(), 0)
  } finally { native.restore() }
})

test('native review reuses verified Owner, existing ledger and at most 20 read-only reconciliations', () => {
  const bridge = fs.readFileSync(
    path.join(root, 'ios/XDriveIOS/IOSPhotoHostBridge.swift'), 'utf8')
  const from = bridge.indexOf('case "photos.reconcile.start":')
  const to = bridge.indexOf('case "photos.backup.cancel":', from)
  assert.ok(from > 0 && to > from)
  const block = bridge.slice(from, to)
  for (const expression of [
    /verifiedOwner\(source\)/,
    /existingLocalScope\(owner: owner\)/,
    /pendingReceiptSnapshot\(\s*scope: scope, limit: Self\.maxReceiptReviewPerRun\s*\)/,
    /let batch = snapshot\.batch/,
    /Task\.checkCancellation\(\)/,
    /XDriveIOSPhotoBackupUncertainReceiptRecovery\(/,
  ]) assert.match(block, expression)
  assert.match(bridge, /private static let maxReceiptReviewPerRun = 20/)
  assert.doesNotMatch(block, /XDriveIOSForegroundPhotoBackupMVP\(|PHAsset\.fetchAssets/)
  assert.match(bridge, /activeBackup == nil && activeReview == nil/)
  assert.match(bridge, /activeReview\?\.cancel\(\)/)
  const identity = fs.readFileSync(
    path.join(root, 'ios/XDriveIOS/ForegroundPhotoBackupIdentity.swift'), 'utf8')
  const start = identity.indexOf('func existingLocalScope(')
  const end = identity.indexOf('private func makeScope(', start)
  assert.ok(start > 0 && end > start)
  const read = identity.slice(start, end)
  assert.match(read, /if status == errSecItemNotFound \{ return nil \}/)
  assert.doesNotMatch(read, /installationKey\(\)|SecItemAdd\(|SecRandomCopyBytes\(/)
})
