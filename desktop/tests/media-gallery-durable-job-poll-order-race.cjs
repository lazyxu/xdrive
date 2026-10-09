const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const renderer = require('react-test-renderer')
const { act } = renderer

const root = path.join(__dirname, '..', '..')
const filename = path.join(root, 'ui/shared/src/mui/MediaGalleryQuerySelection.tsx')
const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText
const tags = {
  Box: 'box', Button: 'button', CircularProgress: 'progress',
  Dialog: 'dialog', DialogActions: 'dialog-actions', IconButton: 'iconbutton',
  Stack: 'stack', TextField: 'textfield', Typography: 'typography',
  useMediaQuery: () => false,
}
const deps = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/material': tags,
  '@mui/icons-material/CloseRounded': 'close',
  './useMobilePanelViewport': { useXDriveMobilePanelViewport: () => null },
  './MediaGalleryUtils': { xDriveMediaGalleryErrorMessage: String },
}
const mod = { exports: {} }
new Function('exports', 'module', 'require', output)(
  mod.exports, mod,
  name => {
    if (!Object.hasOwn(deps, name)) throw Error('unexpected dependency: ' + name)
    return deps[name]
  },
)
const Component = mod.exports.XDriveMediaGalleryQuerySelection
const snapshot = {
  token: 'poll-test-token', version: 4, total: 230, selected: 230,
  excluded: 0, day: '', expires_at: '2026-10-10T12:00:00Z',
}
const item = { node_id: 101, revision: 3, name: 'item-101.jpg', stale: false }
const job = (processed, options = {}) => ({
  id: 'fixed-job-1',
  action: 'favorite', favorite: true, status: 'running',
  total_items: 230, processed_items: processed, succeeded_items: processed,
  failed_items: 0, cancelled_items: 0,
  created_at: '2026-10-10T02:00:00Z',
  updated_at: '2026-10-10T02:00:00Z',
  ...options,
})
function deferred() {
  let resolve, reject
  const promise = new Promise((a,b) => { resolve=a; reject=b })
  return { promise, resolve, reject }
}
const click = (view, key) => {
  const button = view.root.findAll(el => el.type === 'button' && el.props[key])[0]
  assert.ok(button, 'missing real shared component control: ' + key)
  button.props.onClick()
}
const flush = async () => {
  for (let i=0; i<8; i++) await Promise.resolve()
}
const words = node => Array.isArray(node) ? node.map(words).join('') :
  typeof node === 'string' || typeof node === 'number' ? String(node) :
  node?.children ? words(node.children) : ''
async function fixture(getJob) {
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  const interval = { id: Symbol('G07-job-poll-1700'), tick: null, cleared: false }
  globalThis.setInterval = (fn, ms, ...rest) => {
    if (ms === 1700) {
      assert.equal(interval.tick, null, 'one active durable job must have one polling timer')
      interval.tick = fn
      return interval.id
    }
    return originalSetInterval(fn, ms, ...rest)
  }
  globalThis.clearInterval = id => {
    if (id === interval.id) { interval.cleared = true; return }
    return originalClearInterval(id)
  }
  const actions = {
    create: async () => ({ ...snapshot }),
    page: async (_token, offset) => ({
      ...snapshot, offset, limit: 100, items: [item], has_more: false,
    }),
    exclude: async () => { throw Error('not used') },
    release: async () => {},
    submitFavorite: async () => job(0),
    getJob,
  }
  let view
  try {
    await act(async () => {
      view = renderer.create(React.createElement(Component, {
        actions, timeZone: 'Asia/Singapore', sortBy: 'captured',
      }))
    })
    await act(async () => { click(view, 'data-xdrive-gallery-select-query'); await flush() })
    await act(async () => { click(view, 'data-xdrive-gallery-submit-favorite') })
    await act(async () => {
      click(view, 'data-xdrive-gallery-confirm-durable-favorite')
      await flush()
    })
    assert.ok(interval.tick, 'real durable-job polling effect must be mounted')
    assert.match(words(view.toJSON()), /已处理 0\s*\/\s*230/)
  } catch (error) {
    if (view) await act(async () => { view.unmount() })
    globalThis.setInterval = originalSetInterval
    globalThis.clearInterval = originalClearInterval
    throw error
  }
  return {
    view, interval,
    get text() { return words(view.toJSON()) },
    async poll(times=1) {
      await act(async () => {
        for(let i=0;i<times;i++) interval.tick()
        await flush()
      })
    },
    async settle(deferredResult, value, isError=false) {
      await act(async () => {
        if(isError) deferredResult.reject(value)
        else deferredResult.resolve(value)
        await flush()
      })
    },
    async dispose() {
      try { await act(async () => { view.unmount() }) }
      finally {
        globalThis.setInterval=originalSetInterval
        globalThis.clearInterval=originalClearInterval
      }
      assert.equal(interval.cleared, true, 'polling interval must be cleared on teardown')
    },
  }
}

test('G07 job polling: old completion cannot regress newer same-job progress', async () => {
  const older = deferred(), newer = deferred()
  let requested = 0
  const h = await fixture(() => ++requested === 1 ? older.promise : newer.promise)
  try {
    await h.poll(2)
    assert.equal(requested, 2)
    await h.settle(newer, job(30))
    assert.match(h.text, /已处理 30\s*\/\s*230/)
    await h.settle(older, job(5))
    assert.match(h.text, /已处理 30\s*\/\s*230/,
      'older same-status response must not rewind the progress from 30 to 5')
  } finally { await h.dispose() }
})

test('G07 job polling: stale failure cannot publish after a newer successful poll', async () => {
  const older = deferred(), newer = deferred()
  let requested = 0
  const h = await fixture(() => ++requested === 1 ? older.promise : newer.promise)
  try {
    await h.poll(2)
    await h.settle(newer, job(48))
    assert.match(h.text, /已处理 48\s*\/\s*230/)
    await h.settle(older, new Error('obsolete older job poll error'), true)
    assert.doesNotMatch(h.text, /obsolete older job poll error/,
      'older failed request must not place an irrelevant error beside fresh progress')
    assert.match(h.text, /已处理 48\s*\/\s*230/)
  } finally { await h.dispose() }
})

test('G07 job polling: one current response still updates progress', async () => {
  const pending = deferred()
  const h = await fixture(() => pending.promise)
  try {
    await h.poll()
    await h.settle(pending, job(16))
    assert.match(h.text, /已处理 16\s*\/\s*230/)
  } finally { await h.dispose() }
})
