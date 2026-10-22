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
function runWith(indexedDB) {
  const sent = [], api = {}
  class Channel {
    constructor(name) { assert.equal(name, 'xdrive-pwa-offline-purge') }
    postMessage(value) { sent.push(value) }
    close() {}
  }
  const window = { isSecureContext: true, location: { origin: owner.origin }, indexedDB }
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
