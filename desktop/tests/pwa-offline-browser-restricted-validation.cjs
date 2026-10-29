'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')

const root = path.resolve(__dirname, '../..')
const filename = path.join(root, 'web/src/PwaOfflineDirectoryBrowser.tsx')
const source = fs.readFileSync(filename, 'utf8')
const built = ts.transpileModule(source, {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  },
})
assert.deepEqual((built.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error)
  .map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [])

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const owner = {
  origin: 'https://pwa.test.invalid', userID: 42, username: 'owner',
  instanceID: '11111111-1111-4111-8111-111111111111',
}
function harness({ constructorDenied = false, abortThrows = false, lateSignalDenied = false } = {}) {
  const mePending = [], events = new Map()
  let peerPurge = null, nodeReads = 0, rangeReads = 0, aborts = 0
  let controllerCount = 0
  class Controller {
    constructor() {
      if (constructorDenied) throw new Error('Safari denied AbortController')
      controllerCount++
      let reads = 0
      this.signal = {
        get aborted() {
          reads++
          if (lateSignalDenied && reads >= 2) throw new Error('Safari denied AbortSignal.aborted')
          return false
        },
      }
    }
    abort() {
      aborts++
      if (abortThrows) throw new Error('Safari denied abort()')
    }
  }
  class ApiError extends Error {}
  const api = {
    me() { const d = deferred(); mePending.push(d); return d.promise },
    async node() { nodeReads++; return { type: 'dir' } },
    async listRange() { rangeReads++; return { total_count: 0, items: [] } },
  }
  const directory = {
    id: 5, name: 'secret-folder', capturedAt: Date.now(),
    capturedCount: 1, totalCount: 1,
    items: [{ id: 55, name: 'private-file.jpg', type: 'file' }],
  }
  const store = {
    xDrivePwaReadRelaunchOwner: async () => owner,
    xDrivePwaReadOfflineDirectories: async () => ({
      consented: true, revalidated: false, directories: [directory],
    }),
    xDrivePwaReadAlbumSummaries: async () => ({
      consented: true, revalidated: false, snapshot: null,
    }),
    xDrivePwaObserveOfflinePurge(callback) { peerPurge = callback; return () => { peerPurge = null } },
    xDrivePwaVerifiedIdentityMatches: () => true,
    xDrivePwaClearOfflineMetadata: async () => {},
  }
  const components = {}
  for (const name of ['Alert', 'Box', 'Button', 'Divider', 'Stack', 'Typography']) {
    components[name] = props => {
      // startIcon is a React element with a Fiber owner, not a JSON host prop.
      // Ignore this decorative icon but keep actual rendered text and controls.
      const { children, startIcon, ...hostProps } = props
      return React.createElement('test-' + name, hostProps, children)
    }
  }
  const globals = {
    window: {
      addEventListener(name, fn) { events.set(name, fn) },
      removeEventListener(name) { events.delete(name) },
    },
    navigator: { onLine: true },
  }
  const runtime = { exports: {} }
  const modules = {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    '@mui/material': components,
    '@xdrive/ui/mui': {
      XDriveFileExplorerItemIcon: props => React.createElement('test-file-icon', props),
      XDriveFolderIcon: props => React.createElement('test-folder-icon', props),
    },
    './api': { ApiError },
    './pwaOfflineDirectory': store,
  }
  new Function('module', 'exports', 'require', 'window', 'navigator', 'AbortController',
    built.outputText)(
    runtime, runtime.exports, name => {
      assert.ok(Object.hasOwn(modules, name), 'unexpected dependency: ' + name)
      return modules[name]
    }, globals.window, globals.navigator, Controller,
  )
  const Component = runtime.exports.default
  let view
  const mount = async () => {
    await act(async () => {
      view = create(React.createElement(Component, {
        api, hasSession: true, onExit() {}, onOpenGallery() {},
      }))
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
  }
  const json = () => JSON.stringify(view.toJSON())
  const purge = async () => act(async () => { assert.ok(peerPurge); peerPurge() })
  const offline = async () => act(async () => {
    assert.ok(events.get('offline'))
    events.get('offline')()
  })
  const resolveMe = async () => act(async () => {
    assert.ok(mePending.length, 'expected pending Owner /me')
    mePending.shift().resolve({ id: owner.userID, username: owner.username })
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
  const unmount = async () => act(async () => { view.unmount() })
  return {
    mount, json, purge, offline, resolveMe, unmount,
    get requests() { return mePending.length }, get nodeReads() { return nodeReads },
    get rangeReads() { return rangeReads }, get aborts() { return aborts },
    get controllerCount() { return controllerCount },
  }
}

test('denied controller constructor fails closed without dispatching even /me', async () => {
  const h = harness({ constructorDenied: true })
  await h.mount()
  assert.equal(h.requests, 0)
  assert.match(h.json(), /目前无法完成权限核验/)
  assert.doesNotMatch(h.json(), /服务器已重新核验/)
  await h.unmount()
})

test('peer purge clears old Owner labels even when native abort() throws', async () => {
  const h = harness({ abortThrows: true })
  await h.mount()
  assert.equal(h.requests, 1)
  await h.purge()
  assert.ok(h.aborts >= 1)
  assert.doesNotMatch(h.json(), /private-file\.jpg|secret-folder/)
  await h.resolveMe()
  assert.equal(h.nodeReads, 0, 'obsolete Owner must not initiate Node proof')
  assert.doesNotMatch(h.json(), /服务器已重新核验/)
  await h.unmount()
})

test('offline browser event remains usable after a denied native abort', async () => {
  const h = harness({ abortThrows: true })
  await h.mount()
  assert.equal(h.requests, 1)
  await h.offline()
  assert.match(h.json(), /设备处于离线状态/)
  await h.resolveMe()
  assert.equal(h.nodeReads, 0)
  assert.doesNotMatch(h.json(), /服务器已重新核验/)
  await h.unmount()
})

test('late-denied signal getter cannot authorize media browse after valid /me', async () => {
  const h = harness({ lateSignalDenied: true })
  await h.mount()
  assert.equal(h.requests, 1)
  await h.resolveMe()
  assert.equal(h.nodeReads, 0)
  assert.equal(h.rangeReads, 0)
  assert.match(h.json(), /目前无法完成权限核验/)
  await h.unmount()
})

test('healthy current Owner still performs bounded one-row authorized directory proof', async () => {
  const h = harness()
  await h.mount()
  assert.equal(h.requests, 1)
  await h.resolveMe()
  assert.equal(h.nodeReads, 1)
  assert.equal(h.rangeReads, 1)
  assert.match(h.json(), /服务器已重新核验本目录访问权限/)
  await h.unmount()
})

test('offline viewer remains historical-only, never a download or private cache', () => {
  assert.ok(source.includes('xDrivePwaObserveOfflinePurge(reset)'))
  assert.ok(source.includes('await api.listRange(selected.id, 0, 1,'))
  assert.ok(source.includes('if (!acceptVerifiedResponse()) return'))
  assert.doesNotMatch(source, /caches\.open\s*\(|skipWaiting\s*\(|localStorage\.setItem/)
})
