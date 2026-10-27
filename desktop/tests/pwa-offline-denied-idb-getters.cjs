'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'web/src/pwaOfflineDirectory.ts'), 'utf8')
const js = ts.transpileModule(source, {
  fileName: 'pwaOfflineDirectory.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const owner = {
  origin: 'https://pwa-offline.test', userID: 2, username: 'fixture-owner',
  instanceID: '01234567-89ab-4cde-8abc-0123456789ab',
}

function restrictedBrowser({ secure = true, denySecure = false, idb = undefined,
  denyIDB = false, denyOpen = false } = {}) {
  const received = []
  const calls = { secure: 0, idb: 0, open: 0 }
  const win = { location: { origin: owner.origin } }
  Object.defineProperty(win, 'isSecureContext', {
    get() {
      calls.secure++
      if (denySecure) throw new Error('SecurityError: secure context denied')
      return secure
    },
  })
  Object.defineProperty(win, 'indexedDB', {
    get() {
      calls.idb++
      if (denyIDB) throw new Error('SecurityError: IndexedDB getter denied')
      if (denyOpen) return Object.defineProperty({}, 'open', {
        get() { throw new Error('SecurityError: IndexedDB.open denied') },
      })
      return idb
    },
  })
  class Channel {
    constructor(name) { assert.equal(name, 'xdrive-pwa-offline-purge') }
    postMessage(value) { received.push(value) }
    close() {}
  }
  const api = {}
  new Function('exports', 'window', 'BroadcastChannel', js)(api, win, Channel)
  return { api, received, calls }
}

test('PWA opt-in offline history cannot crash render when Safari denies secure-context getter', async () => {
  const { api, calls } = restrictedBrowser({ denySecure: true, denyIDB: true })
  assert.equal(api.xDrivePwaOfflineAvailable(), false)
  assert.equal(await api.xDrivePwaReadRelaunchOwner(), null)
  assert.equal(calls.idb, 0, 'unknown secure origin must not query IndexedDB')
  await assert.rejects(api.xDrivePwaReadOfflineDirectories(owner), /Secure IndexedDB unavailable/)
  await assert.rejects(api.xDrivePwaSetOfflineConsent(owner, true), /Secure IndexedDB unavailable/)
})

test('PWA denied IndexedDB factory or open getter never advertises a usable history store', async () => {
  for (const mode of [{ denyIDB: true }, { denyOpen: true }]) {
    const { api, received } = restrictedBrowser(mode)
    assert.doesNotThrow(() => api.xDrivePwaOfflineAvailable())
    assert.equal(api.xDrivePwaOfflineAvailable(), false)
    assert.equal(await api.xDrivePwaReadRelaunchOwner(), null)
    await assert.rejects(api.xDrivePwaReadOfflineDirectories(owner), /Secure IndexedDB unavailable/)
    // Best-effort peer UI invalidation is not proof that inaccessible disk
    // contents were deleted. The user must not see a revived old Owner.
    await assert.doesNotReject(api.xDrivePwaClearOfflineMetadata())
    assert.deepEqual(received, [{ kind: 'xdrive-pwa-offline-purge' }])
    assert.doesNotMatch(JSON.stringify(received), /token|cookie|username|owner_id|file_name/i)
  }
})

test('PWA secure but missing or malformed IndexedDB is unavailable without calling open', () => {
  for (const idb of [undefined, null, {}, { open: 42 }]) {
    assert.equal(restrictedBrowser({ idb }).api.xDrivePwaOfflineAvailable(), false)
  }
  assert.equal(restrictedBrowser({ secure: false, idb: { open: () => {} } })
    .api.xDrivePwaOfflineAvailable(), false)
})

test('PWA secure IndexedDB capability check remains read-only and accepts a callable native factory', () => {
  let openCalls = 0
  const { api, received } = restrictedBrowser({
    idb: { open: () => { openCalls++; throw Error('should not open at render time') } },
  })
  assert.equal(api.xDrivePwaOfflineAvailable(), true)
  assert.equal(openCalls, 0, 'a render-time capability probe must not open a private database')
  assert.deepEqual(received, [])
  assert.doesNotMatch(source, /(?:self\.)?skipWaiting\s*\(|localStorage\.(?:setItem|getItem)/)
})
