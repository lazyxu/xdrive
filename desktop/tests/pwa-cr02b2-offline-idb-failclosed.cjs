'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'web/src/pwaOfflineDirectory.ts'), 'utf8')
const view = fs.readFileSync(path.join(root, 'web/src/PwaOfflineDirectoryBrowser.tsx'), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText
const owner = { origin: 'https://offline.test', userID: 2, username: 'fixture-user',
  instanceID: '01234567-89ab-4cde-8abc-0123456789ab' }
function runWith(indexedDB, { channelFailure = null } = {}) {
  const sent = [], api = {}
  class Channel {
    constructor(name) {
      assert.equal(name, 'xdrive-pwa-offline-purge')
      if (channelFailure === 'constructor') throw new Error('restricted BroadcastChannel constructor')
    }
    postMessage(value) {
      if (channelFailure === 'send') throw new Error('restricted BroadcastChannel send')
      sent.push(value)
    }
    close() {
      if (channelFailure === 'close') throw new Error('restricted BroadcastChannel close')
    }
  }
  const window = { isSecureContext: true, location: { origin: owner.origin } }
  if (indexedDB !== undefined) window.indexedDB = indexedDB
  new Function('exports', 'window', 'BroadcastChannel', js)(api, window, Channel)
  return { api, sent }
}
function failingDisk() {
  let closes = 0
  return {
    get closes() { return closes },
    open() {
      const db = {
        close() { closes++ },
        transaction() {
          return {
            error: new Error('disk unavailable'),
            objectStore() { return {
              clear() { throw new Error('disk write rejected') },
              delete() { throw new Error('disk write rejected') },
            } },
            abort() { throw new Error('already inactive') },
          }
        },
      }
      const request = { result: db }
      queueMicrotask(() => request.onsuccess?.())
      return request
    },
  }
}
test('CR02b2 blocked IndexedDB open later succeeds without leaking a connection', async () => {
  let closes = 0
  const { api } = runWith({ open() {
    const request = { result: { close() { closes++ } } }
    queueMicrotask(() => request.onblocked?.())
    setTimeout(() => request.onsuccess?.(), 5)
    return request
  } })
  await assert.rejects(api.xDrivePwaReadOfflineDirectories(owner), /upgrade blocked/)
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(closes, 1)
})
test('CR02b2 inactive abort preserves failure and broadcasts peer purge', async () => {
  const disk = failingDisk()
  const { api, sent } = runWith(disk)
  await assert.rejects(api.xDrivePwaClearOfflineMetadata(), /disk write rejected/)
  assert.equal(disk.closes, 1)
  assert.deepEqual(sent, [{ kind: 'xdrive-pwa-offline-purge' }])
})
test('CR02b2 failed opt-out still notifies other tabs', async () => {
  const disk = failingDisk()
  const { api, sent } = runWith(disk)
  await assert.rejects(api.xDrivePwaSetOfflineConsent(owner, false), /disk write rejected/)
  assert.equal(disk.closes, 1)
  assert.deepEqual(sent, [{ kind: 'xdrive-pwa-offline-purge' }])
})
test('CR02b2 revoked UI clears directory AND album without stale initialization', () => {
  assert.match(view, /active && readSequence === sequence\.current\) setVerification\('unavailable'\)/)
  assert.equal([...view.matchAll(/setOwner\(null\)\s+setSaved\(null\)\s+setAlbumSaved\(null\)\s+setSelectedID\(null\)/g)].length, 7)
})
test('CR02b2 public Service Worker never owns private metadata', () => {
  const sw = fs.readFileSync(path.join(root, 'assets/icon/web/sw.js'), 'utf8')
  assert.doesNotMatch(sw, /self\.skipWaiting\s*\(/)
  assert.doesNotMatch(source, /caches\.open\s*\(/)
})

test('CR02b2 restricted Safari peer channel cannot block local sign-out or offline unmount', async () => {
  const { api, sent } = runWith(undefined, { channelFailure: 'constructor' })
  const dispose = api.xDrivePwaObserveOfflinePurge(() => {
    throw new Error('must not subscribe when the channel is denied')
  })
  assert.equal(typeof dispose, 'function')
  assert.doesNotThrow(dispose)
  await assert.doesNotReject(api.xDrivePwaClearOfflineMetadata())
  assert.deepEqual(sent, [])
})

test('CR02b2 rejected peer send or close cannot mask local cleanup results', async () => {
  for (const channelFailure of ['send', 'close']) {
    const { api } = runWith(undefined, { channelFailure })
    assert.doesNotThrow(() => api.xDrivePwaObserveOfflinePurge(() => {})())
    await assert.doesNotReject(api.xDrivePwaClearOfflineMetadata())
  }
})

test('CR02b2 failed disk cleanup preserves its original error when peer channel is denied', async () => {
  for (const channelFailure of ['constructor', 'send', 'close']) {
    const disk = failingDisk()
    const { api } = runWith(disk, { channelFailure })
    await assert.rejects(api.xDrivePwaClearOfflineMetadata(), /disk write rejected/,
      'the original storage failure must remain observable to the caller')
    await assert.rejects(api.xDrivePwaSetOfflineConsent(owner, false), /disk write rejected/,
      'failed consent revocation must not become a successful purge')
    assert.equal(disk.closes, 2)
  }
})

test('CR02b2 available peer still delivers exactly one anonymous purge notification', async () => {
  const { api, sent } = runWith(undefined)
  await assert.doesNotReject(api.xDrivePwaClearOfflineMetadata())
  assert.deepEqual(sent, [{ kind: 'xdrive-pwa-offline-purge' }])
  assert.doesNotMatch(JSON.stringify(sent), /token|cookie|username|file|owner_id/i)
})
