const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const renderer = require('react-test-renderer')
const { act } = renderer

// Run the real shared FileExplorer upload controller with React hooks.
// Only the legacy Agent transport and the conflict-dialog Port are stubbed.
const repo = path.resolve(__dirname, '../..')
const filename = path.join(repo, 'ui/shared/src/mui/FileExplorerUploadController.ts')
const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText
let batchActive = false
const modules = {
  react: React,
  '../upload-conflicts': {
    xDriveUploadBatchSummary: () => '',
    xDriveUploadConflictCanOverwrite: () => false,
    xDriveUploadConflictPreflightBatchSize: 1000,
  },
  './UploadConflictDialog': {
    useXDriveUploadConflictResolver: () => ({
      beginBatch: () => {
        if (batchActive) return false
        batchActive = true
        return true
      },
      endBatch: () => { batchActive = false },
      reset: () => { batchActive = false },
      resolveConflict: async () => 'cancel',
      dialogProps: {},
    }),
  },
}
const mod = { exports: {} }
new Function('exports', 'module', 'require', output)(
  mod.exports, mod, name => {
    if (!Object.hasOwn(modules, name)) throw Error('Unexpected dependency ' + name)
    return modules[name]
  },
)
const useUploadController = mod.exports.useXDriveFileExplorerUploadController
const flush = async () => { for (let i=0; i<12; i++) await Promise.resolve() }
function pending() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve=yes; reject=no })
  return {promise, resolve, reject}
}
const target = name => ({parentID: 17, file: {name}})
async function mount(overrides = {}) {
  batchActive = false
  const calls = []
  const holder = { controller: null }
  const options = {
    lifecycleKey: 'server-A:user-A',
    fileName: file => file.name,
    preflight: async () => ({conflict: false}),
    upload: async (_parentID, file) => {
      calls.push(file.name)
      return {skipped: false}
    },
    onFeedback: () => {},
    onError: error => { throw error },
    ...overrides,
  }
  function Harness(props) {
    holder.controller = useUploadController(props)
    return React.createElement('hook-probe', {
      busyAction: holder.controller.busyAction,
    })
  }
  let view
  await act(async () => {
    view = renderer.create(React.createElement(Harness, options))
    await flush()
  })
  return {
    calls,
    get controller() { return holder.controller },
    async changeLifecycle(key) {
      await act(async () => {
        view.update(React.createElement(Harness, {...options, lifecycleKey:key}))
        await flush()
      })
    },
    async dispose() {
      await act(async () => { view.unmount(); await flush() })
    },
  }
}

test('Legacy folder upload: same-render duplicate selection must scan the directory only once', async () => {
  const scan = pending(), h = await mount()
  let scans = 0
  const input = {
    label: 'legacy-folder',
    resolveTargets: () => {
      scans++
      return scan.promise
    },
  }
  try {
    const click = h.controller.runGroup
    const first = click(input)
    const second = click(input)
    await act(async () => { await flush() })
    const callsBeforeRelease = scans
    await act(async () => { scan.resolve([target('one.txt')]); await flush() })
    const results = await Promise.all([first, second])
    assert.equal(callsBeforeRelease, 1,
      'legacy Agent fallback must claim Busy synchronously before scanning a directory')
    assert.deepEqual(results.map(x => x.started), [true, false])
    assert.deepEqual(h.calls, ['one.txt'],
      'the same folder must never schedule duplicate uploads')
  } finally {
    scan.resolve([target('one.txt')])
    await h.dispose()
  }
})

test('Legacy folder upload: a pending directory scan must own Busy against a second flat upload', async () => {
  const scan = pending(), h = await mount()
  try {
    const group = h.controller.runGroup({
      label: 'folder',
      resolveTargets: () => scan.promise,
    })
    await act(async () => { await flush() })
    assert.equal(h.controller.busy, true,
      'the in-flight folder scan must be visible as a busy upload action')
    const flat = await h.controller.runTargets([target('independent.txt')])
    assert.equal(flat.started, false,
      'flat upload cannot overtake a folder scan on the same controller')
    assert.deepEqual(h.calls, [])
    await act(async () => { scan.resolve([target('group.txt')]); await flush() })
    const outcome = await group
    assert.equal(outcome.uploaded, 1)
    assert.deepEqual(h.calls, ['group.txt'])
  } finally {
    scan.resolve([target('group.txt')])
    await h.dispose()
  }
})

test('Legacy folder upload control: one scan starts one upload and releases Busy', async () => {
  const h = await mount()
  let scans = 0
  try {
    const result = await h.controller.runGroup({
      label: 'folder',
      resolveTargets: async () => {
        scans++
        return [target('a.bin')]
      },
    })
    assert.equal(scans, 1)
    assert.deepEqual(h.calls, ['a.bin'])
    assert.equal(result.started, true)
    assert.equal(result.uploaded, 1)
    assert.equal(h.controller.busy, false)
  } finally {
    await h.dispose()
  }
})

test('Legacy folder upload control: an old lifecycle scan cannot start a new-session upload', async () => {
  const scan = pending(), h = await mount()
  try {
    const old = h.controller.runGroup({
      label: 'old-folder',
      resolveTargets: () => scan.promise,
    })
    await act(async () => { await flush() })
    await h.changeLifecycle('server-B:user-B')
    await act(async () => { scan.resolve([target('private-A.txt')]); await flush() })
    const outcome = await old
    assert.equal(outcome.cancelled, true)
    assert.deepEqual(h.calls, [],
      'late old-session scan must not begin an upload in the new session')
  } finally {
    scan.resolve([target('private-A.txt')])
    await h.dispose()
  }
})
