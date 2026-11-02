'use strict'
// Mounted DSM Source progress regression: current owning Agent only.
// No physical NAS, backup completion or CAS integrity is implied.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')
const { act } = Renderer

function stub(name) {
  return function Stub({ children, ...props }) {
    return React.createElement(name, props, children)
  }
}
const root = path.resolve(__dirname, '../..')
const validatorFile = path.join(root, 'ui/shared/src/synology-task-status.ts')
const validatorModule = { exports: {} }
const validatorOutput = ts.transpileModule(fs.readFileSync(validatorFile, 'utf8'), {
  fileName: validatorFile, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  },
}).outputText
new Function('module', 'exports', validatorOutput)(
  validatorModule, validatorModule.exports,
)
const imports = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/material': Object.fromEntries(
    ['Button', 'Stack', 'Typography'].map(name => [name, stub(name)]),
  ),
  '../format': { formatBytes: bytes => bytes + ' B' },
  '../synology-task-status': validatorModule.exports,
  './DeviceBackupFolderSummary': { xDriveDeviceBackupRunLabel: state => state },
  './StatusAlert': { XDriveStatusAlert: stub('status-alert') },
  './StatusBadge': { XDriveStatusBadge: stub('status-badge') },
}
const sourceFile = path.join(root, 'ui/shared/src/mui/SynologyBackupSourceProgress.tsx')
const compiled = ts.transpileModule(fs.readFileSync(sourceFile, 'utf8'), {
  fileName: sourceFile,
  reportDiagnostics: true,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
})
assert.deepEqual((compiled.diagnostics || []).filter(
  x => x.category === ts.DiagnosticCategory.Error,
).map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [])
const mod = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  mod, mod.exports, name => {
    if (!(name in imports)) throw new Error('unapproved progress import ' + name)
    return imports[name]
  },
)
const Progress = mod.exports.XDriveSynologyBackupSourceProgress
assert.equal(typeof Progress, 'function')
function current(source_id, more = {}) {
  return {
    source_id, revision: 1, state: 'partial', running: false,
    inspected_files: 8, confirmed_files: 4, skipped_files: 1,
    unsupported_files: 1, uncertain_files: 2, confirmed_bytes: 800,
    backup_complete: false, retirement_safe: false,
    current_cas_verified: false, ...more,
  }
}
function deferred() {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
function textOf(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!node) return ''
  if (Array.isArray(node)) return node.map(textOf).join('')
  return (node.children || []).map(textOf).join('')
}
async function mount(client, sourceID = 57, refreshEpoch = 0) {
  let tree
  await act(async () => {
    tree = Renderer.create(React.createElement(Progress, {
      client, sourceID, refreshEpoch,
    }))
    await Promise.resolve()
  })
  return tree
}

test('only explicitly mounted Source reads a verified actual Agent status and refreshes', async () => {
  const calls = []
  const client = { inspect: (id, signal) => {
    calls.push({ id, signal })
    return Promise.resolve(current(id))
  } }
  const tree = await mount(client)
  assert.deepEqual(calls.map(x => x.id), [57])
  assert.equal(calls[0].signal.aborted, false)
  assert.equal(tree.root.findByType('status-badge').props.label, 'partial')
  assert.match(textOf(tree.toJSON()), /已检查 8/)
  assert.match(textOf(tree.toJSON()), /800 B/)
  assert.match(textOf(tree.toJSON()), /不代表整份备份完成/)
  await act(async () => {
    tree.root.findByType('Button').props.onClick()
    await Promise.resolve()
  })
  assert.deepEqual(calls.map(x => x.id), [57, 57])
  await act(async () => tree.unmount())
  assert.equal(calls[1].signal.aborted, true)
})

test('invalid completion/CAS claims, wrong Source and Agent errors show no false progress', async () => {
  for (const raw of [
    current(57, { backup_complete: true }),
    current(57, { retirement_safe: true }),
    current(57, { current_cas_verified: true }),
    current(58),
    current(57, { confirmed_files: 12 }),
  ]) {
    const tree = await mount({ inspect: async () => raw })
    assert.equal(tree.root.findAllByType('status-badge').length, 0)
    assert.equal(tree.root.findAllByType('status-alert').length, 1)
    assert.match(textOf(tree.toJSON()), /不会使用历史记录假定本次备份成功/)
    await act(async () => tree.unmount())
  }
  const offline = await mount({ inspect: async () => { throw new Error('private bearer denied') } })
  assert.doesNotMatch(textOf(offline.toJSON()), /private bearer denied/)
  assert.equal(offline.root.findAllByType('status-badge').length, 0)
  await act(async () => offline.unmount())
})

test('Host A -> B -> A and stale Source responses cannot render another Owner progress', async () => {
  const blocked = deferred()
  let oldSignal
  const A = { inspect: (_id, signal) => { oldSignal = signal; return blocked.promise } }
  const B = { inspect: async id => current(id, { confirmed_bytes: 2800 }) }
  let tree
  await act(async () => {
    tree = Renderer.create(React.createElement(Progress, {
      key: 'A:57', client: A, sourceID: 57, refreshEpoch: 0,
    }))
    await Promise.resolve()
  })
  await act(async () => {
    tree.update(React.createElement(Progress, {
      key: 'B:58', client: B, sourceID: 58, refreshEpoch: 0,
    }))
    await Promise.resolve()
  })
  assert.equal(oldSignal.aborted, true)
  assert.match(textOf(tree.toJSON()), /2800 B/)
  await act(async () => {
    blocked.resolve(current(57, { confirmed_bytes: 5700 }))
    await Promise.resolve()
  })
  assert.doesNotMatch(textOf(tree.toJSON()), /5700 B/)
  assert.match(textOf(tree.toJSON()), /2800 B/)
  await act(async () => {
    tree.update(React.createElement(Progress, {
      key: 'A-new-epoch:57', client: A,
      sourceID: 57, refreshEpoch: 0,
    }))
    await Promise.resolve()
  })
  assert.equal(tree.root.findAllByType('status-badge').length, 1)
  await act(async () => tree.unmount())
})

test('only one expanded running Source polls, only in visible tab, and stops on terminal read', async () => {
  const oldWindow = global.window, oldDocument = global.document
  let nextTimer = 0
  const timers = new Map()
  let reads = 0
  global.window = {
    setInterval: (callback, ms) => {
      assert.equal(ms, 10000)
      const id = ++nextTimer
      timers.set(id, callback)
      return id
    },
    clearInterval: id => { timers.delete(id) },
  }
  global.document = { visibilityState: 'hidden' }
  let tree
  try {
    const client = { inspect: async id => {
      reads += 1
      return reads === 1
        ? current(id, { revision: 0, state: 'running', running: true })
        : current(id, { state: 'partial', running: false })
    } }
    tree = await mount(client)
    assert.equal(reads, 1)
    assert.equal(timers.size, 1)
    await act(async () => {
      for (const tick of [...timers.values()]) tick()
      await Promise.resolve()
    })
    assert.equal(reads, 1, 'hidden DSM page must not poll the owning Agent')
    global.document.visibilityState = 'visible'
    await act(async () => {
      for (const tick of [...timers.values()]) tick()
      await Promise.resolve()
    })
    assert.equal(reads, 2)
    assert.equal(timers.size, 0, 'terminal Source must stop polling immediately')
  } finally {
    if (tree) await act(async () => tree.unmount())
    if (oldWindow === undefined) delete global.window
    else global.window = oldWindow
    if (oldDocument === undefined) delete global.document
    else global.document = oldDocument
  }
})

test('a completed manual run dialog closes into a new selected-Source read', async () => {
  let reads = 0
  const client = { inspect: async id => { reads++; return current(id) } }
  let tree = await mount(client)
  assert.equal(reads, 1)
  await act(async () => {
    tree.update(React.createElement(Progress, {
      client, sourceID: 57, refreshEpoch: 1,
    }))
    await Promise.resolve()
  })
  assert.equal(reads, 2)
  await act(async () => tree.unmount())
})
