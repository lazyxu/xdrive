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

test('Group lifecycle: delayed startGroup returning after session change must terminalize old group', async () => {
  const hold = deferred(), scans = []
  const old = lifecycle({ startGroup: () => hold.promise })
  const h = await mount(old)
  try {
    const run = h.controller.runGroup(request(async () => {
      scans.push('scanned')
      return targets()
    }))
    await act(async () => { await flush() })
    await h.switchSession()
    await settle(hold, 'group-A')
    const result = await run
    assert.equal(result.cancelled, true)
    assert.deepEqual(scans, [], 'detached group may not start scanning another session')
    assert.deepEqual(finishedState(old), ['group-A:cancelled'],
      'a late but successful startGroup response must not leave an orphan queued group')
  } finally {
    hold.resolve('group-A')
    await h.dispose()
  }
})

test('Group lifecycle: detached directory scan must close already registered old group', async () => {
  const scan = deferred()
  const old = lifecycle()
  const h = await mount(old)
  try {
    const run = h.controller.runGroup(request(() => scan.promise))
    await act(async () => { await flush() })
    assert.ok(old.events.includes('start-group'))
    await h.switchSession()
    await settle(scan, targets())
    const result = await run
    assert.equal(result.cancelled, true)
    assert.deepEqual(finishedState(old), ['group-A:cancelled'],
      'old-group scan cancellation must terminalize tracking without uploading anything')
    assert.deepEqual(old.started, [])
  } finally {
    scan.resolve(targets())
    await h.dispose()
  }
})

test('Group lifecycle: late batch child registration must close returned children and old group', async () => {
  const batch = deferred()
  const old = lifecycle({
    startChildren: () => batch.promise,
  })
  const h = await mount(old)
  try {
    const run = h.controller.runGroup(request(async () => targets()))
    await act(async () => { await flush() })
    await h.switchSession()
    await settle(batch, ['child-1', 'child-2'])
    const result = await run
    assert.equal(result.cancelled, true)
    assert.deepEqual(finishedState(old), [
      'child-1:cancelled', 'child-2:cancelled', 'group-A:cancelled',
    ], 'newly returned tracking children must never remain queued after old session detaches')
    assert.deepEqual(old.started, [], 'no old-session transfer should start')
  } finally {
    batch.resolve(['child-1', 'child-2'])
    await h.dispose()
  }
})

test('Group lifecycle: partial serial child registration must finish both returned children', async () => {
  const second = deferred()
  const old = lifecycle({
    startChildren: undefined,
    startChild: async (_group, input) => {
      if (input.fileName === 'a.bin') return 'child-a'
      return second.promise
    },
  })
  const h = await mount(old)
  try {
    const run = h.controller.runGroup(request(async () => targets()))
    await act(async () => { await flush() })
    await h.switchSession()
    await settle(second, 'child-b')
    const result = await run
    assert.equal(result.cancelled, true)
    assert.deepEqual(finishedState(old), [
      'child-a:cancelled', 'child-b:cancelled', 'group-A:cancelled',
    ], 'serial child creation must close the child returned after old session detaches')
    assert.deepEqual(old.started, [])
  } finally {
    second.resolve('child-b')
    await h.dispose()
  }
})

test('Group lifecycle control: normal registered group and children finish completed', async () => {
  const old = lifecycle()
  const h = await mount(old)
  try {
    const result = await h.controller.runGroup(request(async () => targets()))
    assert.equal(result.uploaded, 2)
    assert.equal(result.cancelled, false)
    assert.deepEqual(finishedState(old), [
      'child-1:completed', 'child-2:completed', 'group-A:completed',
    ])
    assert.deepEqual(h.errors, [])
  } finally {
    await h.dispose()
  }
})

test('Group pre-upload: old session delayed child begin closes registered group and both children', async () => {
  const waiting = deferred(), old = lifecycle()
  let uploads = 0
  old.begin = async id => {
    old.started.push(id)
    if (id === 'child-1') return waiting.promise
  }
  const h = await mount(old, { upload: async () => { uploads++; return { skipped: false } } })
  try {
    const run = h.controller.runGroup(request(async () => targets()))
    await act(async () => { await flush() })
    assert.deepEqual(old.started, ['group-A', 'child-1'])
    await h.switchSession()
    await settle(waiting)
    assert.equal((await run).cancelled, true)
    assert.equal(uploads, 0)
    assert.deepEqual(finishedState(old), [
      'child-1:cancelled', 'child-2:cancelled', 'group-A:cancelled',
    ], 'late begin(child) must close all unstarted tracking records via their original Port')
    assert.deepEqual(h.errors, [])
  } finally {
    waiting.resolve()
    await h.dispose()
  }
})

test('Group pre-upload: old session late group update closes initialized child and queued sibling', async () => {
  const waiting = deferred(), old = lifecycle()
  old.updateGroup = () => waiting.promise
  let uploads = 0
  const h = await mount(old, { upload: async () => { uploads++; return { skipped: false } } })
  try {
    const run = h.controller.runGroup(request(async () => targets()))
    await act(async () => { await flush() })
    assert.deepEqual(old.started, ['group-A', 'child-1'])
    await h.switchSession()
    await settle(waiting)
    assert.equal((await run).cancelled, true)
    assert.equal(uploads, 0)
    assert.deepEqual(finishedState(old), [
      'child-1:cancelled', 'child-2:cancelled', 'group-A:cancelled',
    ], 'late updateGroup must terminate pre-upload old-Port records')
  } finally {
    waiting.resolve()
    await h.dispose()
  }
})

test('Group pre-upload: old session preflight completion closes running child and queued sibling', async () => {
  const waiting = deferred(), old = lifecycle()
  let uploads = 0
  const h = await mount(old, {
    preflight: () => waiting.promise,
    upload: async () => { uploads++; return { skipped: false } },
  })
  try {
    const run = h.controller.runGroup(request(async () => targets()))
    await act(async () => { await flush() })
    assert.deepEqual(old.started, ['group-A', 'child-1'])
    await h.switchSession()
    await settle(waiting, { conflict: false })
    assert.equal((await run).cancelled, true)
    assert.equal(uploads, 0)
    assert.deepEqual(finishedState(old), [
      'child-1:cancelled', 'child-2:cancelled', 'group-A:cancelled',
    ], 'detached first-file preflight must close old-Port queue before any upload')
    assert.deepEqual(h.errors, [])
  } finally {
    waiting.resolve({ conflict: false })
    await h.dispose()
  }
})

test('Group pre-upload: failed old-session directory scan still terminates created group', async () => {
  const waiting = deferred(), old = lifecycle()
  const h = await mount(old)
  try {
    const run = h.controller.runGroup(request(() => waiting.promise))
    await act(async () => { await flush() })
    assert.ok(old.events.includes('start-group'))
    await h.switchSession()
    await act(async () => {
      waiting.reject(new Error('disconnected old scanner'))
      await flush()
    })
    assert.equal((await run).cancelled, true)
    assert.deepEqual(finishedState(old), ['group-A:cancelled'],
      'old-session scan failure must close its registered group')
    assert.deepEqual(h.errors, [], 'obsolete scan failure cannot leak to new session')
  } finally {
    waiting.resolve(targets())
    await h.dispose()
  }
})

test('Group pre-upload: failed old-session child registration still terminates root group', async () => {
  const waiting = deferred(), old = lifecycle({ startChildren: () => waiting.promise })
  const h = await mount(old)
  try {
    const run = h.controller.runGroup(request(async () => targets()))
    await act(async () => { await flush() })
    await h.switchSession()
    await act(async () => {
      waiting.reject(new Error('disconnected old Agent child registrar'))
      await flush()
    })
    assert.equal((await run).cancelled, true)
    assert.deepEqual(finishedState(old), ['group-A:cancelled'],
      'old-session rejected child creation must close its parent group')
    assert.deepEqual(h.errors, [])
  } finally {
    waiting.resolve([])
    await h.dispose()
  }
})

test('Group pre-upload control: current-session preflight failure reports failed child and root', async () => {
  const old = lifecycle()
  const h = await mount(old, {
    preflight: async () => { throw new Error('current-session preflight denied') },
  })
  try {
    const result = await h.controller.runGroup(request(async () => targets()))
    assert.equal(result.failed, 1)
    assert.equal(result.cancelled, false)
    assert.deepEqual(finishedState(old), [
      'child-1:failed', 'child-2:cancelled', 'group-A:failed',
    ], 'a current preflight error must remain failed, not be relabelled cancelled')
    assert.equal(h.errors.length, 1)
  } finally {
    await h.dispose()
  }
})

test('Group pre-upload control: a dispatched file upload is not cancelled on UI session change', async () => {
  const waiting = deferred(), old = lifecycle()
  let uploadCalls = 0
  const h = await mount(old, {
    upload: () => {
      uploadCalls++
      return waiting.promise
    },
  })
  try {
    const run = h.controller.runGroup(request(async () => targets()))
    await act(async () => { await flush() })
    assert.equal(uploadCalls, 1, 'the first real upload must be dispatched before detachment')
    await h.switchSession()
    await settle(waiting, { skipped: false })
    const result = await run
    assert.equal(result.cancelled, true, 'the obsolete UI action must exit')
    assert.deepEqual(finishedState(old), [],
      'UI detachment cannot terminalize an actual dispatched Server/Agent upload')
    assert.deepEqual(h.errors, [])
  } finally {
    waiting.resolve({ skipped: false })
    await h.dispose()
  }
})
