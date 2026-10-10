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
async function fixture(getJob, extraActions = {}) {
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
    if (id === interval.id) { interval.cleared = true; interval.tick = null; return }
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
    ...extraActions,
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

test('G07 cancel vs poll: accepted Cancel cannot be reverted by older running response in one batch', async () => {
  const olderPoll = deferred()
  const acceptedCancel = deferred()
  let cancelCalls = 0
  const h = await fixture(() => olderPoll.promise, {
    cancelJob: () => { cancelCalls++; return acceptedCancel.promise },
  })
  const cancelButtons = () => h.view.root.findAll(el =>
    el.type === 'button' && el.props.children === '取消任务')
  try {
    await h.poll()
    assert.equal(cancelButtons().length, 1, 'test starts with a running job')
    await act(async () => { cancelButtons()[0].props.onClick(); await flush() })
    assert.equal(cancelCalls, 1, 'the real Cancel handler made one durable command')
    // Complete the accepted mutation first and the old in-flight poll second.
    // Both Promise continuations execute before React commits this update batch.
    await act(async () => {
      acceptedCancel.resolve()
      olderPoll.resolve(job(2, { status: 'running' }))
      await flush()
    })
    assert.equal(cancelButtons().length, 0,
      'an older pre-Cancel poll must not restore the Cancel button after accepted cancellation')
    assert.match(h.text, /正在取消/,
      'accepted Cancel must remain visible until a newer authoritative poll')
  } finally { await h.dispose() }
})

test('G07 cancel vs poll: obsolete poll failure cannot display error after accepted Cancel', async () => {
  const olderPoll = deferred()
  const acceptedCancel = deferred()
  const h = await fixture(() => olderPoll.promise, {
    cancelJob: () => acceptedCancel.promise,
  })
  try {
    await h.poll()
    const cancelButton = h.view.root.findAll(el =>
      el.type === 'button' && el.props.children === '取消任务')[0]
    assert.ok(cancelButton)
    await act(async () => { cancelButton.props.onClick(); await flush() })
    await act(async () => {
      acceptedCancel.resolve()
      olderPoll.reject(new Error('obsolete pre-cancel poll failure'))
      await flush()
    })
    assert.doesNotMatch(h.text, /obsolete pre-cancel poll failure/,
      'a poll initiated before accepted Cancel must not surface its obsolete error')
    assert.match(h.text, /正在取消/)
  } finally { await h.dispose() }
})

test('G07 cancel control: a single accepted Cancel without an in-flight poll remains correct', async () => {
  const h = await fixture(() => Promise.resolve(job(0)), {
    cancelJob: async () => {},
  })
  try {
    const cancelButton = h.view.root.findAll(el =>
      el.type === 'button' && el.props.children === '取消任务')[0]
    assert.ok(cancelButton)
    await act(async () => { cancelButton.props.onClick(); await flush() })
    assert.match(h.text, /正在取消/)
    assert.equal(h.view.root.findAll(el =>
      el.type === 'button' && el.props.children === '取消任务').length, 0)
  } finally { await h.dispose() }
})
