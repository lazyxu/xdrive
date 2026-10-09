const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')
const { act } = Renderer
const root = path.resolve(__dirname, '../..')

function loadTS(relative, bindings = {}) {
  const filename = path.join(root, relative)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  const imports = { react: React, ...bindings }
  new Function('module', 'exports', 'require', output)(mod, mod.exports, name => {
    if (Object.prototype.hasOwnProperty.call(imports, name)) return imports[name]
    throw Error('Unexpected import: ' + name)
  })
  return mod.exports
}

const gesture = loadTS('ui/shared/src/mobile-item-gesture.ts')

test('Files and Gallery share a strict stationary-hold / scrolling threshold', () => {
  assert.equal(gesture.XDRIVE_MOBILE_ITEM_HOLD_MS, 450)
  assert.equal(gesture.xDriveMobileItemMoved({ x: 0, y: 0 }, { x: 6, y: 8 }), false)
  assert.equal(gesture.xDriveMobileItemMoved({ x: 0, y: 0 }, { x: 8, y: 8 }), true)
  assert.equal(gesture.xDriveMobileItemMoved({ x: 100, y: 50 }, { x: 100, y: 42 }), false)
})

const hash = route => '#/app/' + route.app + (Object.keys(route.params || {}).length
  ? '?' + new URLSearchParams(Object.entries(route.params).map(([k, v]) => [k, String(v)])).toString() : '')
const parse = raw => {
  if (!raw.startsWith('#/app/')) return null
  const [app, query = ''] = raw.slice(6).split('?')
  if (!app) return null
  return { app, params: Object.fromEntries(new URLSearchParams(query)) }
}
const viewer = app => ['preview', 'media-viewer', 'pdf-viewer', 'text-viewer', 'audio-player'].includes(app)
const { useXDriveWebAppRuntime } = loadTS('web/src/webAppRuntime.ts', {
  '../../ui/shared/src': {
    xDriveParseWebAppHash: parse,
    xDriveWebAppHash: hash,
    xDriveWebAppViewer: viewer,
  },
})

function fakeWindow(initialRoute, existingState) {
  let position = 0
  const entries = [{ hash: hash(initialRoute), state: existingState ?? null }]
  const listeners = new Map()
  const location = { hash: entries[0].hash }
  const api = {
    location,
    addEventListener: (type, cb) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(cb)
    },
    removeEventListener: (type, cb) => listeners.get(type)?.delete(cb),
    sessionStorage: { getItem: () => null, setItem: () => {} },
    open: () => {},
  }
  const notify = type => { for (const cb of listeners.get(type) || []) cb() }
  api.history = {
    get state() { return entries[position].state },
    get length() { return entries.length },
    pushState(state, _title, next) {
      entries.splice(++position)
      entries.push({ hash: next, state })
      location.hash = next
    },
    replaceState(state, _title, next) {
      entries[position] = { hash: next, state }
      location.hash = next
    },
    back() {
      if (position === 0) return
      position -= 1
      location.hash = entries[position].hash
      notify('popstate')
      notify('hashchange')
    },
  }
  return api
}

async function mountedRuntime(initialRoute, state) {
  const previousWindow = global.window
  global.window = fakeWindow(initialRoute, state)
  let runtime
  let view
  function Harness() { runtime = useXDriveWebAppRuntime(); return null }
  await act(async () => { view = Renderer.create(React.createElement(Harness)) })
  return {
    get runtime() { return runtime },
    get location() { return global.window.location.hash },
    get historyLength() { return global.window.history.length },
    async call(fn) { await act(async () => { fn(runtime) }) },
    async dispose() {
      await act(async () => { view.unmount() })
      global.window = previousWindow
    },
  }
}

test('application Back exits Files to the previous App, not the parent directory', async () => {
  const h = await mountedRuntime({ app: 'overview', params: {} })
  try {
    await h.call(r => r.launch({ app: 'files', params: {} }))
    await h.call(r => r.launch({ app: 'files', params: { dir: 42 } }, { replace: true }))
    assert.equal(h.runtime.canExitApp, true)
    await h.call(r => r.exitApp())
    assert.equal(h.location, '#/app/overview')
    assert.equal(h.historyLength, 2)
  } finally { await h.dispose() }
})

test('nested app transitions return to their caller and retain its params', async () => {
  const h = await mountedRuntime({ app: 'overview', params: {} })
  try {
    await h.call(r => r.launch({ app: 'gallery', params: { section: 'favorites' } }))
    await h.call(r => r.launch({ app: 'files', params: { dir: 10 } }))
    await h.call(r => r.exitApp())
    assert.equal(h.location, '#/app/gallery?section=favorites')
    await h.call(r => r.exitApp())
    assert.equal(h.location, '#/app/overview')
  } finally { await h.dispose() }
})

test('deep link with no internal caller falls back to overview without external Back', async () => {
  const h = await mountedRuntime({ app: 'files', params: { dir: 9 } })
  try {
    await h.call(r => r.exitApp())
    assert.equal(h.location, '#/app/overview')
    assert.equal(h.historyLength, 1)
    assert.equal(h.runtime.canExitApp, false)
  } finally { await h.dispose() }
})

test('Viewer continues to pop only its own overlay history', async () => {
  const h = await mountedRuntime({ app: 'gallery', params: {} })
  try {
    await h.call(r => r.launch({ app: 'media-viewer', params: { node: 13 } }, { viewerReturn: true }))
    await h.call(r => r.closeViewer({ app: 'files', params: {} }))
    assert.equal(h.location, '#/app/gallery')
  } finally { await h.dispose() }
})

test('compact shell has no floating trigger or per-item action chrome', () => {
  const source = relative => fs.readFileSync(path.join(root, relative), 'utf8')
  const nav = source('ui/shared/src/mui/WorkspaceCompactNavigation.tsx')
  const frame = source('ui/shared/src/mui/MobileAppHeader.tsx')
  const files = source('ui/shared/src/mui/FileExplorer.tsx')
  const gallery = source('ui/shared/src/mui/MediaGallery.tsx')
  assert.match(nav, /fullscreen \? \{ display: 'contents' \}/)
  assert.doesNotMatch(nav, /position: 'fixed'/)
  assert.match(frame, /data-xdrive-mobile-app-header/)
  assert.match(frame, /aria-label="返回上一个应用"/)
  const web = source('web/src/App.tsx')
  assert.match(web, /compactWorkspace \? accountAction : undefined/)
  assert.match(web, /transferAction=\{transferAction\}/)
  const transfer = web.slice(web.indexOf('const transferAction = ('), web.indexOf('const accountAction = ('))
  assert.match(transfer, /<XDriveTransferPopover/)
  assert.match(transfer, /transfers=\{transfers\}/)
  assert.doesNotMatch(transfer, /compactTrigger=/, 'all Mobile widths use the same upload/download speed trigger as Web')
  assert.doesNotMatch(web, /compactChromeOverflow/, 'narrow mobile must never move transfer into the drawer')
  assert.match(web, /onOpenTransfers=\{\(\) => setTransferPopoverOpen\(true\)\}/)
  assert.match(files, /touchDrag\.begin\(event, source\.map/)
  assert.match(files, /selectedCount === 0 \|\| !touchDragDisabledReason/)
  assert.match(files, /touchDrag\.cancel\(\)/, 'second touch must cancel an active drag')
  assert.match(files, /loadNodeLocation=\{showMediaProperties \? loadNodeLocation : undefined\}/,
    'Mobile Files must retain the shared G06 location adapter during gesture changes')
  assert.match(files, /onShowInFolder=\{onShowInFolder\}/,
    'Show in Folder must remain reachable from media Properties')
  assert.doesNotMatch(files, /data-xdrive-file-explorer-item-more/)
  assert.doesNotMatch(gallery, /data-xdrive-gallery-touch-info/)
  assert.match(gallery, /!compactTouch && onSetFavorite/)
})
