const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const renderer = require('react-test-renderer')
const { act } = renderer

// Execute the actual shared Web/Desktop FileExplorer Upload Hook. Transfer
// lifecycle ports are controlled; controller/interleaving code is unchanged.
const repo = path.resolve(__dirname, '../..')
const filename = path.join(repo, 'ui/shared/src/mui/FileExplorerUploadController.ts')
const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText
const modules = {
  react: React,
  '../upload-conflicts': {
    xDriveUploadBatchSummary: () => '',
    xDriveUploadConflictCanOverwrite: () => false,
    xDriveUploadConflictPreflightBatchSize: 1000,
  },
  './UploadConflictDialog': {
    useXDriveUploadConflictResolver: () => {
      const active = React.useRef(false)
      return {
        beginBatch: () => {
          if (active.current) return false
          active.current = true
          return true
        },
        endBatch: () => { active.current = false },
        reset: () => { active.current = false },
        resolveConflict: async () => 'cancel',
        dialogProps: {},
      }
    },
  },
}
const loaded = { exports: {} }
new Function('exports', 'module', 'require', output)(
  loaded.exports, loaded, name => {
    if (!Object.hasOwn(modules, name)) throw Error('unexpected import ' + name)
    return modules[name]
  },
)
const useUploadController = loaded.exports.useXDriveFileExplorerUploadController
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const target = (name, id = 11) => ({
  parentID: id, file: { name, size: 10 }, relativePath: 'folder/' + name,
})
const targetNames = ['a.bin', 'b.bin']
const targets = () => targetNames.map(name => target(name))

function lifecycle(overrides = {}) {
  const finished = [], started = [], events = []
  const result = {
    started, finished, events,
    startGroup: async () => { events.push('start-group'); return 'group-A' },
    startChild: async (_group, input) => {
      events.push('start-child:' + input.fileName)
      return input.fileName === 'a.bin' ? 'child-a' : 'child-b'
    },
    startChildren: async (_group, inputs) => {
      events.push('start-children:' + inputs.length)
      return inputs.map((_, index) => 'child-' + (index + 1))
    },
    begin: async id => { started.push(id) },
    progress: async () => {},
    updateGroup: async () => {},
    finish: async (id, input) => {
      finished.push([id, input.state])
      events.push('finish:' + id + ':' + input.state)
    },
    ...overrides,
  }
  return result
}
const finishedState = l => l.finished.map(([id, state]) => id + ':' + state).sort()

async function mount(transferLifecycle, overrides = {}) {
  const errors = [], feedback = []
  const holder = { controller: null }
  const defaults = {
    lifecycleKey: 'server-A:user-A',
    trackProgress: true,
    fileName: file => file.name,
    fileSize: file => file.size ?? 0,
    preflight: async () => ({ conflict: false }),
    upload: async () => ({ skipped: false }),
    onError: error => errors.push(error),
    onFeedback: (tone, message) => feedback.push([tone, message]),
    transferLifecycle,
    ...overrides,
  }
  function Harness(props) {
    holder.controller = useUploadController(props)
    return React.createElement('upload-probe', {
      busyAction: holder.controller.busyAction,
    })
  }
  let view
  await act(async () => {
    view = renderer.create(React.createElement(Harness, defaults))
    await flush()
  })
  return {
    errors, feedback,
    get controller() { return holder.controller },
    async switchSession() {
      await act(async () => {
        view.update(React.createElement(Harness, {
          ...defaults, lifecycleKey: 'server-B:user-B',
        }))
        await flush()
      })
    },
    async dispose() {
      await act(async () => { view.unmount(); await flush() })
    },
  }
}
const request = resolveTargets => ({
  label: 'Folder-A',
  itemsTotal: 2, bytesTotal: 20, resolveTargets,
})
const settle = async (waiting, value) => {
  await act(async () => { waiting.resolve(value); await flush() })
}


test('Partial group: slow second-file preflight after first completed must close only unstarted tracking', async () => {
  const second = deferred(), old = lifecycle(), calls = []
  const h = await mount(old, {
    preflight: async (_parentID, file) =>
      file.name === 'b.bin' ? second.promise : { conflict: false },
    upload: async (_parentID, file) => { calls.push(file.name); return { skipped: false } },
  })
  try {
    const run = h.controller.runGroup(request(async () => targets()))
    await act(async () => { await flush() })
    assert.deepEqual(calls, ['a.bin'])
    assert.deepEqual(finishedState(old), ['child-1:completed'])
    assert.deepEqual(old.started, ['group-A','child-1','child-2'])
    await h.switchSession()
    await settle(second, { conflict: false })
    const outcome = await run
    assert.equal(outcome.cancelled, true)
    assert.deepEqual(calls, ['a.bin'], 'second file may not begin uploading after session switch')
    assert.deepEqual(finishedState(old), [
      'child-1:completed', 'child-2:cancelled', 'group-A:partial',
    ], 'completed file must survive; unstarted sibling and root must reach distinct terminal states')
    assert.deepEqual(h.errors, [])
  } finally {
    second.resolve({ conflict: false })
    await h.dispose()
  }
})

test('Partial group: slow second child begin after first completed must not abandon queued sibling', async () => {
  const second = deferred(), old = lifecycle(), calls = []
  old.begin = async id => {
    old.started.push(id)
    if (id === 'child-2') return second.promise
  }
  const h = await mount(old, { upload: async (_parentID, file) => {
    calls.push(file.name); return { skipped: false }
  } })
  try {
    const run = h.controller.runGroup(request(async () => targets()))
    await act(async () => { await flush() })
    assert.deepEqual(finishedState(old), ['child-1:completed'])
    assert.deepEqual(old.started, ['group-A','child-1','child-2'])
    await h.switchSession()
    await settle(second)
    assert.equal((await run).cancelled, true)
    assert.deepEqual(calls, ['a.bin'])
    assert.deepEqual(finishedState(old), [
      'child-1:completed', 'child-2:cancelled', 'group-A:partial',
    ])
  } finally {
    second.resolve()
    await h.dispose()
  }
})

test('Partial group: slow second child group-progress acknowledgement after first completed must close sibling', async () => {
  const second = deferred(), old = lifecycle(), calls = []
  let groupUpdates = 0
  old.updateGroup = async () => {
    groupUpdates++
    if (groupUpdates === 3) return second.promise
  }
  const h = await mount(old, { upload: async (_parentID, file) => {
    calls.push(file.name); return { skipped: false }
  } })
  try {
    const run = h.controller.runGroup(request(async () => targets()))
    await act(async () => { await flush() })
    assert.equal(groupUpdates, 3, 'hold second child progress update, not the first child')
    assert.deepEqual(finishedState(old), ['child-1:completed'])
    await h.switchSession()
    await settle(second)
    assert.equal((await run).cancelled, true)
    assert.deepEqual(calls, ['a.bin'])
    assert.deepEqual(finishedState(old), [
      'child-1:completed', 'child-2:cancelled', 'group-A:partial',
    ])
  } finally {
    second.resolve()
    await h.dispose()
  }
})

test('Partial group: second preflight rejection after switching session must preserve completed first child', async () => {
  const second = deferred(), old = lifecycle(), calls = []
  const h = await mount(old, {
    preflight: (_parentID, file) => file.name === 'b.bin'
      ? second.promise
      : Promise.resolve({ conflict: false }),
    upload: async (_parentID, file) => { calls.push(file.name); return { skipped: false } },
  })
  try {
    const run = h.controller.runGroup(request(async () => targets()))
    await act(async () => { await flush() })
    assert.deepEqual(finishedState(old), ['child-1:completed'])
    await h.switchSession()
    await act(async () => {
      second.reject(new Error('stale Server A preflight error'))
      await flush()
    })
    assert.equal((await run).cancelled, true)
    assert.deepEqual(calls, ['a.bin'])
    assert.deepEqual(finishedState(old), [
      'child-1:completed', 'child-2:cancelled', 'group-A:partial',
    ])
    assert.deepEqual(h.errors, [], 'stale preflight errors must not leak into the new account UI')
  } finally {
    second.resolve({ conflict: false })
    await h.dispose()
  }
})

test('Partial group: first upload failed before second preflight must retain failed child and failed root', async () => {
  const second = deferred(), old = lifecycle()
  let uploadCalls = 0
  const h = await mount(old, {
    continueOnUploadError: true,
    preflight: (_parentID, file) => file.name === 'b.bin'
      ? second.promise
      : Promise.resolve({ conflict: false }),
    upload: async () => { uploadCalls++; throw new Error('first file failed') },
  })
  try {
    const run = h.controller.runGroup(request(async () => targets()))
    await act(async () => { await flush() })
    assert.equal(uploadCalls, 1)
    assert.deepEqual(finishedState(old), ['child-1:failed'])
    await h.switchSession()
    await settle(second, { conflict: false })
    assert.equal((await run).cancelled, true)
    assert.equal(uploadCalls, 1)
    assert.deepEqual(finishedState(old), [
      'child-1:failed', 'child-2:cancelled', 'group-A:failed',
    ], 'a failed earlier upload cannot be misreported as complete or leave the group running')
    assert.deepEqual(h.errors, [])
  } finally {
    second.resolve({ conflict: false })
    await h.dispose()
  }
})

test('Partial group safety: second real upload dispatched at detach must NOT cancel in-flight transfer or root', async () => {
  const second = deferred(), old = lifecycle(), calls = []
  const h = await mount(old, {
    upload: (_parentID, file) => {
      calls.push(file.name)
      return file.name === 'b.bin' ? second.promise : Promise.resolve({ skipped: false })
    },
  })
  try {
    const run = h.controller.runGroup(request(async () => targets()))
    await act(async () => { await flush() })
    assert.deepEqual(calls, ['a.bin', 'b.bin'])
    assert.deepEqual(finishedState(old), ['child-1:completed'])
    await h.switchSession()
    await settle(second, { skipped: false })
    assert.equal((await run).cancelled, true)
    assert.deepEqual(finishedState(old), ['child-1:completed'],
      'a still-running real upload must never be marked cancelled by stale UI cleanup')
    assert.deepEqual(h.errors, [])
  } finally {
    second.resolve({ skipped: false })
    await h.dispose()
  }
})

test('Partial group control: both normal uploads and group still complete under one owner', async () => {
  const old = lifecycle(), calls = []
  const h = await mount(old, { upload: async (_parentID, file) => {
    calls.push(file.name); return { skipped: false }
  } })
  try {
    const result = await h.controller.runGroup(request(async () => targets()))
    assert.equal(result.uploaded, 2)
    assert.equal(result.cancelled, false)
    assert.deepEqual(calls, ['a.bin', 'b.bin'])
    assert.deepEqual(finishedState(old), [
      'child-1:completed', 'child-2:completed', 'group-A:completed',
    ])
  } finally {
    await h.dispose()
  }
})

test('Partial group safety: first child terminal acknowledgement after detach closes only queued sibling', async () => {
  const firstFinished = deferred(), old = lifecycle(), calls = []
  old.finish = async (id, input) => {
    if (id === 'child-1' && input.state === 'completed') await firstFinished.promise
    old.finished.push([id, input.state])
  }
  const h = await mount(old, {
    upload: async (_parentID, file) => {
      calls.push(file.name)
      return { skipped: false }
    },
  })
  try {
    const run = h.controller.runGroup(request(async () => targets()))
    await act(async () => { await flush() })
    assert.deepEqual(calls, ['a.bin'],
      'first upload must finish transport before waiting for its terminal receipt')
    assert.deepEqual(finishedState(old), [],
      'old transport is waiting for terminal confirmation, not yet completed tracking')
    await h.switchSession()
    await settle(firstFinished)
    assert.equal((await run).cancelled, true)
    assert.deepEqual(calls, ['a.bin'],
      'second real upload must not be issued after detached terminal acknowledgement')
    assert.deepEqual(finishedState(old), [
      'child-1:completed', 'child-2:cancelled', 'group-A:partial',
    ])
    assert.deepEqual(h.errors, [])
  } finally {
    firstFinished.resolve()
    await h.dispose()
  }
})
