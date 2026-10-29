'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const filename = path.resolve(__dirname, '../../web/src/pwaOfflineDirectory.ts')
const source = fs.readFileSync(filename, 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, removeComments: true },
})
assert.deepEqual((compiled.diagnostics || [])
  .filter(x => x.category === ts.DiagnosticCategory.Error)
  .map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [])
const owner = {
  origin: 'https://pwa-test.invalid', userID: 42, username: 'fixture',
  instanceID: '11111111-1111-4111-8111-111111111111',
}
const hintKey = 'xdrive:pwa:offline-relaunch-owner:v1'

function fixture() {
  const opens = [], gets = [], txs = [], channels = [], records = new Map()
  const db = {
    close() {},
    transaction(_name, _mode) {
      const tx = {
        onabort: null, onerror: null, oncomplete: null, error: null,
        abort() { tx.onabort?.() },
        objectStore() {
          return {
            get(key) { const request = { onsuccess: null, result: undefined }; gets.push({ key, request }); return request },
          }
        },
      }
      txs.push(tx)
      return tx
    },
  }
  const win = {
    isSecureContext: true, location: { origin: owner.origin },
    indexedDB: { open() { const request = { onsuccess: null, result: db }; opens.push(request); return request } },
  }
  class Channel {
    constructor(name) {
      assert.equal(name, 'xdrive-pwa-offline-purge')
      channels.push(this)
    }
    close() {}
    postMessage() {}
  }
  const mod = { exports: {} }
  new Function('module', 'exports', 'window', 'BroadcastChannel',
    'TextEncoder', compiled.outputText)(
    mod, mod.exports, win, Channel, TextEncoder,
  )
  const api = mod.exports
  const scope = api.xDrivePwaOfflineScopeKey(owner)
  const now = Date.now()
  records.set(scope, {
    key: scope, version: 1, consented: true,
    directories: [{
      id: 5, name: 'personal', totalCount: 1, capturedCount: 1,
      capturedAt: now, partial: true,
      items: [{ id: 7, name: 'private.jpg', type: 'file', size: 24, revision: 2 }],
    }],
    albumSnapshot: {
      capturedAt: now, partial: true, totalAtCapture: 1,
      albums: [{ id: 'album-1', name: 'personal album', kind: 'manual', item_count: 1, revision: 2 }],
    },
  })
  records.set(hintKey, { key: hintKey, version: 1, savedAt: now, owner: { ...owner } })
  const stop = api.xDrivePwaObserveOfflinePurge(() => {})
  const peer = channels.find(channel => typeof channel.onmessage === 'function')
  assert.ok(peer, 'peer notification must be present')
  async function open() {
    const request = opens.shift()
    assert.ok(request, 'expected pending IndexedDB open')
    request.onsuccess()
    for (let i = 0; i < 4; i++) await Promise.resolve()
  }
  function get() {
    const item = gets.shift()
    assert.ok(item, 'expected pending IndexedDB get')
    item.request.result = records.get(item.key)
    item.request.onsuccess()
    return item.key
  }
  function complete() {
    const tx = txs.shift()
    assert.ok(tx, 'expected IndexedDB transaction')
    tx.oncomplete()
  }
  function revoke() { peer.onmessage({ data: { kind: 'xdrive-pwa-offline-purge' } }) }
  return { api, records, gets, opens, open, get, complete, revoke, stop, scope }
}

for (const [name, load, verify] of [
  ['directories', api => api.xDrivePwaReadOfflineDirectories(owner),
    output => assert.deepEqual(output, { consented: false, revalidated: false, directories: [] })],
  ['albums', api => api.xDrivePwaReadAlbumSummaries(owner),
    output => assert.deepEqual(output, { consented: false, revalidated: false, snapshot: null })],
]) {
  test('peer revoke before IndexedDB open rejects stale ' + name + ' metadata', async () => {
    const f = fixture()
    const pending = load(f.api)
    assert.equal(f.opens.length, 1)
    f.revoke()
    await f.open()
    assert.equal(f.gets.length, 0, 'do not read old Owner records after a known purge')
    f.complete()
    verify(await pending)
    f.stop()
  })
  test('peer revoke while IndexedDB request is pending rejects stale ' + name, async () => {
    const f = fixture()
    const pending = load(f.api)
    await f.open()
    assert.equal(f.gets.length, 1)
    f.revoke()
    f.get()
    f.complete()
    verify(await pending)
    f.stop()
  })
}

test('relaunch owner hint cannot resurrect a revoked account after either IDB hop', async () => {
  const first = fixture()
  const pending = first.api.xDrivePwaReadRelaunchOwner()
  first.revoke()
  await first.open()
  assert.equal(first.gets.length, 0)
  first.complete()
  assert.equal(await pending, null)
  first.stop()

  const second = fixture()
  const late = second.api.xDrivePwaReadRelaunchOwner()
  await second.open()
  assert.equal(second.get(), hintKey)
  assert.equal(second.gets.length, 1, 'valid old hint should normally check its consented scope')
  second.revoke()
  assert.equal(second.get(), second.scope)
  second.complete()
  assert.equal(await late, null)
  second.stop()
})

test('unrevoked opted-in history remains available but never revalidated as live Owner ACL', async () => {
  const f = fixture()
  const directory = f.api.xDrivePwaReadOfflineDirectories(owner)
  await f.open()
  assert.equal(f.get(), f.scope)
  f.complete()
  const d = await directory
  assert.equal(d.consented, true)
  assert.equal(d.revalidated, false)
  assert.deepEqual(d.directories.map(x => x.id), [5])
  assert.deepEqual(d.directories[0].items.map(x => x.id), [7])

  const album = f.api.xDrivePwaReadAlbumSummaries(owner)
  await f.open()
  assert.equal(f.get(), f.scope)
  f.complete()
  const a = await album
  assert.equal(a.consented, true)
  assert.equal(a.revalidated, false)
  assert.deepEqual(a.snapshot.albums.map(x => x.id), ['album-1'])

  const relaunch = f.api.xDrivePwaReadRelaunchOwner()
  await f.open()
  assert.equal(f.get(), hintKey)
  assert.equal(f.get(), f.scope)
  f.complete()
  assert.deepEqual(await relaunch, owner)
  f.stop()
})

test('read fences do not persist or cache private media bytes', () => {
  assert.equal((source.match(/const readEpoch = offlinePurgeEpoch/g) || []).length, 3)
  // Check transpiled executable code: the source's security-policy comment
  // mentions CacheStorage, but no runtime path may access it or localStorage.
  assert.doesNotMatch(compiled.outputText, /caches\.open\s*\(|CacheStorage|localStorage\.setItem/)
})
