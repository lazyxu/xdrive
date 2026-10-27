'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'web/src/pwaOfflineDirectory.ts'), 'utf8')
const section = fs.readFileSync(path.join(root, 'web/src/PwaOfflineDirectorySection.tsx'), 'utf8')
const code = ts.transpileModule(source, {
  fileName: 'pwaOfflineDirectory.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const origin = 'https://offline.test'
const owner = { origin, userID: 2, username: 'fixture-user',
  instanceID: '01234567-89ab-4cde-8abc-0123456789ab' }

function createWindow() {
  return { isSecureContext: true, location: { origin } }
}
function deny(object, property) {
  Object.defineProperty(object, property, {
    configurable: true,
    get() { throw new Error('SecurityError: Safari denied ' + property) },
  })
  return object
}
function loadActualModule(browserWindow) {
  const sent = []
  class Channel {
    constructor(name) { assert.equal(name, 'xdrive-pwa-offline-purge') }
    postMessage(message) { sent.push(message) }
    close() {}
  }
  const api = {}
  new Function('exports', 'window', 'BroadcastChannel', code)(api, browserWindow, Channel)
  return { api, sent }
}

test('PWA offline history availability is evaluated during the real React section render', () => {
  assert.match(section, /const available = xDrivePwaOfflineAvailable\(\) && key !== ''/)
  assert.match(source, /export function xDrivePwaOfflineAvailable\(\): boolean/)
})

test('Safari denied secure context or IndexedDB getters never crash availability or revive historical Owner', async () => {
  const secureDenied = deny(createWindow(), 'isSecureContext')
  const idbDenied = deny(createWindow(), 'indexedDB')
  const openDenied = createWindow()
  openDenied.indexedDB = deny({}, 'open')
  const cases = [
    ['secure-context getter', secureDenied],
    ['IndexedDB getter', idbDenied],
    ['IndexedDB.open getter', openDenied],
  ]
  for (const [label, browserWindow] of cases) {
    const { api, sent } = loadActualModule(browserWindow)
    assert.equal(api.xDrivePwaOfflineAvailable(), false, label)
    assert.equal(await api.xDrivePwaReadRelaunchOwner(), null, label)
    await assert.rejects(api.xDrivePwaReadOfflineDirectories(owner),
      /Secure IndexedDB unavailable/, label)
    await assert.rejects(api.xDrivePwaSetOfflineConsent(owner, true),
      /Secure IndexedDB unavailable/, label)
    await assert.doesNotReject(api.xDrivePwaClearOfflineMetadata(), label)
    assert.deepEqual(sent, [{ kind: 'xdrive-pwa-offline-purge' }],
      label + ' must notify other tabs even when disk is inaccessible')
  }
})

test('missing or noncallable IndexedDB.open fails closed instead of claiming a working history store', async () => {
  for (const idb of [undefined, {}, { open: null }, { open: 'not-a-function' }]) {
    const browserWindow = createWindow()
    if (idb !== undefined) browserWindow.indexedDB = idb
    const { api } = loadActualModule(browserWindow)
    assert.equal(api.xDrivePwaOfflineAvailable(), false)
    assert.equal(await api.xDrivePwaReadRelaunchOwner(), null)
    await assert.rejects(api.xDrivePwaReadOfflineDirectories(owner),
      /Secure IndexedDB unavailable/)
  }
})

test('normal IndexedDB.open method remains available; rejected open retains real failure', async () => {
  const storageError = new Error('SecurityError: IndexedDB.open rejected')
  let calls = 0
  const browserWindow = createWindow()
  browserWindow.indexedDB = { open() { calls++; throw storageError } }
  const { api, sent } = loadActualModule(browserWindow)
  assert.equal(api.xDrivePwaOfflineAvailable(), true,
    'detect an exposed callable API without pretending transactions must succeed')
  await assert.rejects(api.xDrivePwaReadOfflineDirectories(owner), err => err === storageError)
  assert.equal(calls, 1)
  await assert.rejects(api.xDrivePwaClearOfflineMetadata(), err => err === storageError,
    'failed persisted purge must never be silently reported as success')
  assert.equal(calls, 2)
  assert.deepEqual(sent, [{ kind: 'xdrive-pwa-offline-purge' }])
})

test('offline browser retains independently supported connectivity listeners under Safari denials', async () => {
  const React = require('react')
  const TestRenderer = require('react-test-renderer')
  const { act } = TestRenderer
  const browserSource = fs.readFileSync(path.join(root, 'web/src/PwaOfflineDirectoryBrowser.tsx'), 'utf8')
  const browserCode = ts.transpileModule(browserSource, {
    fileName: 'PwaOfflineDirectoryBrowser.tsx',
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    },
  }).outputText
  const Wrapper = props => React.createElement('test-element', props, props.children)
  const mui = {}
  for (const name of ['Alert', 'Box', 'Button', 'Divider', 'Stack', 'Typography']) mui[name] = Wrapper

  for (const deniedAdd of [new Set(['online']), new Set(['offline']),
    new Set(['online', 'offline'])]) {
    const attempted = [], accepted = [], removed = []
    let disposed = 0
    const simulatedWindow = {
      addEventListener(name) {
        attempted.push(name)
        if (deniedAdd.has(name)) throw new Error('SecurityError: denied event ' + name)
        accepted.push(name)
      },
      removeEventListener(name) {
        removed.push(name)
        if (name === 'online') throw new Error('SecurityError: denied listener removal')
      },
    }
    const mocks = {
      react: React,
      'react/jsx-runtime': require('react/jsx-runtime'),
      '@mui/material': mui,
      '@xdrive/ui/mui': { XDriveFileExplorerItemIcon: Wrapper, XDriveFolderIcon: Wrapper },
      './api': { ApiError: class ApiError extends Error {} },
      './pwaOfflineDirectory': {
        xDrivePwaObserveOfflinePurge: () => () => { disposed++ },
        xDrivePwaReadRelaunchOwner: async () => null,
        xDrivePwaReadOfflineDirectories: () => { throw Error('no offline Owner rehydration') },
        xDrivePwaReadAlbumSummaries: () => { throw Error('no offline album rehydration') },
        xDrivePwaClearOfflineMetadata: async () => {},
        xDrivePwaVerifiedIdentityMatches: () => false,
      },
    }
    const module = { exports: {} }
    new Function('module', 'exports', 'require', browserCode)(
      module, module.exports, id => {
        assert.ok(Object.hasOwn(mocks, id), 'Unexpected offline browser dependency: ' + id)
        return mocks[id]
      },
    )
    const Browser = module.exports.default
    const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    Object.defineProperty(globalThis, 'window', {
      configurable: true, writable: true, value: simulatedWindow,
    })
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true, writable: true, value: { onLine: false },
    })
    let renderer
    try {
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(Browser, {
          api: {}, hasSession: false, onExit: () => {}, onOpenGallery: () => {},
        }))
      })
      assert.deepEqual(attempted, ['online', 'offline'])
      assert.deepEqual(accepted, ['online', 'offline'].filter(name => !deniedAdd.has(name)),
        'denying one advisory browser event must not suppress the other')
      await assert.doesNotReject(async () => {
        await act(async () => { renderer.unmount() })
      }, 'denied cleanup must not throw during React unmount')
      assert.deepEqual(removed, ['online', 'offline'],
        'both event cleanups must be independently attempted')
      assert.equal(disposed, 1, 'the optional peer purge observer is always detached')
    } finally {
      if (renderer) {
        try { await act(async () => { renderer.unmount() }) } catch { /* cleanup test environment */ }
      }
      if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
      else delete globalThis.window
      if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator)
      else delete globalThis.navigator
    }
  }
})
