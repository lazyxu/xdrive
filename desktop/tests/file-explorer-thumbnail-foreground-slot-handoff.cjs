'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')

const root = path.resolve(__dirname, '../..')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate, message, timeoutMS = 1500) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMS) throw Error('foreground slot handoff: ' + message)
    await sleep(5)
  }
}
function deferred() {
  let resolve
  const promise = new Promise(next => { resolve = next })
  return { promise, resolve }
}
function transpile(relativePath) {
  const absolute = path.join(root, relativePath)
  return ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    fileName: absolute,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText
}
function loadModules() {
  const bus = { exports: {} }
  new Function('exports', 'module', transpile('ui/shared/src/mui/ViewerForegroundPriority.ts'))(
    bus.exports, bus,
  )
  const Placeholder = () => React.createElement('span', null, 'pending')
  const Box = React.forwardRef(function TestBox({ children }, ref) {
    return React.createElement('div', { ref }, children)
  })
  const component = { exports: {} }
  new Function('exports', 'module', 'require',
    transpile('ui/shared/src/mui/FileExplorerThumbnail.tsx'),
  )(component.exports, component, request => {
    if (request === 'react') return React
    if (request === '@mui/material') return { Box }
    if (request === '@mui/icons-material/ErrorOutlineRounded') {
      return { __esModule: true, default: Placeholder }
    }
    if (request === './MediaLoadProgress') return { XDriveMediaLoadingProgress: Placeholder }
    if (request === './LivePhotoSurface') return { XDriveLivePhotoGlyph: Placeholder }
    if (request === './ViewerForegroundPriority') return bus.exports
    if (request === './FileExplorerThumbnailVisualState') {
      return { xDriveFileExplorerThumbnailVisualState: () => 'loading' }
    }
    return require(request)
  })
  return { bus: bus.exports, thumbnails: component.exports }
}

test('an obsolete Files page cannot hold six thumbnail slots if its loader ignores abort', async () => {
  const saved = {
    document: global.document,
    window: global.window,
    IntersectionObserver: global.IntersectionObserver,
  }
  global.document = Object.assign(new EventTarget(), { hidden: false })
  global.window = Object.assign(new EventTarget(), { setTimeout, clearTimeout })
  global.IntersectionObserver = undefined

  const { bus, thumbnails } = loadModules()
  const obsolete = []
  const incoming = []
  function loaderFor(records) {
    // Native/IPC adapters can acknowledge AbortSignal but fail to settle
    // their Promise. This deliberately ignores the signal until test release.
    return (item, signal) => {
      const gate = deferred()
      records.push({ id: item.id, signal, gate })
      return gate.promise
    }
  }
  const oldLoader = loaderFor(obsolete)
  const newLoader = loaderFor(incoming)
  function page(kind) {
    const old = kind === 'old'
    const firstID = old ? 100 : 200
    return React.createElement(
      thumbnails.XDriveFileExplorerThumbnailProvider,
      { key: kind, lifecycleKey: kind, loadThumbnail: old ? oldLoader : newLoader },
      Array.from({ length: 8 }, (_, index) => {
        const id = firstID + index
        return React.createElement(thumbnails.XDriveFileExplorerThumbnail, {
          key: id,
          item: { id, kind: 'file', name: 'thumbnail.jpeg', revision: 1 },
          eligible: true,
          fallback: React.createElement('span', null, 'cold'),
        })
      }),
    )
  }

  let renderer
  try {
    bus.xDriveEnterForegroundPage('web:files')
    await act(async () => {
      renderer = create(page('old'), { createNodeMock: () => ({}) })
    })
    await until(() => obsolete.length === 6, 'old Files occupies all six slots')
    assert.equal(obsolete.length, 6, 'two further old tiles are queued')

    // The new read-only Share page uses the same FileExplorer thumbnail pool.
    // It must start before any old uncooperative Promise completes.
    await act(async () => {
      bus.xDriveEnterForegroundPage('web:public-share')
      renderer.update(page('new'))
    })
    await until(() => incoming.length === 6, 'new Share starts six visible reads')
    assert.equal(obsolete.length, 6, 'queued obsolete reads must never start during cancellation')
    assert.equal(incoming.length, 6, 'the new page must still respect the six-slot cap')
    assert.ok(obsolete.every(row => row.signal.aborted), 'old I/O received cancellation')
    assert.ok(incoming.every(row => !row.signal.aborted), 'new page I/O remains active')

    // Late cancellation completion must NOT release any of the new page's
    // occupied slots or let its seventh/eighth requests jump the queue.
    await act(async () => {
      for (const row of obsolete) row.gate.resolve(null)
    })
    await sleep(20)
    assert.equal(incoming.length, 6, 'late old finally cannot free a new slot')

    await act(async () => { incoming[0].gate.resolve('https://thumb.invalid/200.jpeg') })
    await until(() => incoming.length === 7, 'first new completion releases one slot')
    assert.equal(incoming.length, 7)
    await act(async () => { incoming[1].gate.resolve('https://thumb.invalid/201.jpeg') })
    await until(() => incoming.length === 8, 'second new completion releases one slot')
    assert.equal(incoming.length, 8)

    assert.equal(bus.xDriveCurrentForegroundPage(), 'web:public-share')
  } finally {
    if (renderer) await act(async () => { renderer.unmount() })
    for (const row of [...obsolete, ...incoming]) row.gate.resolve(null)
    await sleep(0)
    bus.xDriveEnterForegroundPage(null)
    for (const [key, previous] of Object.entries(saved)) {
      if (previous === undefined) delete global[key]
      else global[key] = previous
    }
  }
})
