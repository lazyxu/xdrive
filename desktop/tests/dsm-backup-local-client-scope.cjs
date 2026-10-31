'use strict'
// Mounted original DSM Backup-only panel regression. Capture every React
// render, including the frame before passive effect cleanup runs on a Host
// client change; deferred fixture reads are not physical NAS acceptance.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')
const { act } = Renderer

const renders = { folders: [], dialogs: [], notices: [] }
function stub(name) {
  return function Stub({ children, ...props }) {
    if (name === 'folder-accordion') renders.folders.push(props.folder?.name)
    if (name === 'batch-dialog' || name === 'schedule-dialog') {
      renders.dialogs.push([name, props.sourceID])
    }
    if (name === 'status-alert') renders.notices.push(children)
    return React.createElement(name, props, children)
  }
}
const MUI = Object.fromEntries(
  ['Box', 'Button', 'Stack', 'Typography'].map(name => [name, stub(name)]),
)
const imports = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/material': MUI,
  '@mui/icons-material/RefreshRounded': { default: stub('refresh-icon') },
  './DeviceBackupFolderAccordion': { XDriveDeviceBackupFolderAccordion: stub('folder-accordion') },
  './DeviceBackupLocalPrimaryActions': { XDriveDeviceBackupLocalPrimaryActions: stub('local-actions') },
  './DeviceBackupDeviceCard': { XDriveDeviceBackupDeviceCard: stub('device-card') },
  './DeviceBackupHistoryList': { XDriveDeviceBackupHistoryList: stub('history-list') },
  './DeviceBackupLocalCommonBatchDialog': { XDriveDeviceBackupLocalCommonBatchDialog: stub('batch-dialog') },
  './DeviceBackupLocalScheduleDialog': { XDriveDeviceBackupLocalScheduleDialog: stub('schedule-dialog') },
  './WorkspaceSurface': { XDriveWorkspaceSurface: stub('workspace') },
  './StatePanel': { XDriveStatePanel: stub('state-panel') },
  './SynologyBackupSourceSetup': { XDriveSynologyBackupSourceSetup: stub('source-setup') },
  './StatusAlert': { XDriveStatusAlert: stub('status-alert') },
}
const filename = path.resolve(__dirname, '../../ui/shared/src/mui/SynologyBackupLocalPanel.tsx')
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
})
assert.deepEqual((compiled.diagnostics || [])
  .filter(x => x.category === ts.DiagnosticCategory.Error)
  .map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [])
const moduleRef = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  moduleRef, moduleRef.exports, name => {
    if (!(name in imports)) throw Error('unexpected DSM Backup-only import: ' + name)
    return imports[name]
  },
)
const Panel = moduleRef.exports.XDriveSynologyBackupLocalPanel
assert.equal(typeof Panel, 'function')
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const originalRun = {
  source_id: 57, run_id: 'original-run-57', revision: 1, state: 'partial',
  inspected_files: 1, confirmed_files: 1, skipped_files: 0,
  unsupported_files: 0, uncertain_files: 0, confirmed_bytes: 42,
  finished_at: '2026-10-31T00:00:00Z',
}
const folder = (id, name) => ({ source_id: id, name })
const emptyHistory = sourceID => ({ source_id: sourceID, items: [] })
function clearRenderTrace() {
  renders.folders.length = 0
  renders.dialogs.length = 0
  renders.notices.length = 0
}

test('DSM Host replacement never renders old-owner Source names, history, task dialog or notice in new Host frame', async () => {
  const freshB = deferred()
  const calls = []
  const A = {
    list: async () => [folder(57, 'Only Owner A NAS Folder')],
    history: async id => ({ source_id: id, items: [originalRun] }),
  }
  const B = {
    list: () => freshB.promise,
    history: async id => { calls.push(['history', id]); return emptyHistory(id) },
  }
  let tree
  await act(async () => {
    tree = Renderer.create(React.createElement(Panel, { client: A }))
    await Promise.resolve()
  })
  assert.equal(tree.root.findAllByType('folder-accordion').length, 1)
  await act(async () => {
    tree.root.findByType('folder-accordion').props.onExpandedChange(true)
    await Promise.resolve()
  })
  assert.equal(tree.root.findByType('history-list').props.entries.length, 1)
  await act(async () => {
    tree.root.findByType('local-actions').props.onRun()
  })
  assert.equal(tree.root.findAllByType('batch-dialog').length, 1)
  clearRenderTrace()
  await act(async () => {
    tree.update(React.createElement(Panel, { client: B }))
    await Promise.resolve()
  })
  assert.deepEqual(renders.folders, [],
    'old Source names must not enter any commit of the new client before useEffect cleanup')
  assert.deepEqual(renders.dialogs, [],
    'an old Source dialog may not bind to the replacement Agent even for one render')
  assert.deepEqual(calls, [], 'replacement Agent may not read old Source history on the Host swap')
  assert.equal(tree.root.findAllByType('folder-accordion').length, 0)
  assert.equal(tree.root.findAllByType('batch-dialog').length, 0)
  assert.equal(tree.root.findAllByType('workspace').length, 1)
  await act(async () => {
    freshB.resolve([folder(58, 'Only Owner B NAS Folder')])
    await Promise.resolve()
  })
  assert.deepEqual(tree.root.findAllByType('folder-accordion').map(x => x.props.folder.name),
    ['Only Owner B NAS Folder'])
  assert.deepEqual(calls, [], 'new Agent history remains opt-in until its own folder is expanded')
  await act(async () => tree.unmount())
})

test('DSM clears prior owner operation notice on Host replacement and keeps fresh Source history on demand', async () => {
  const A = {
    list: async () => [folder(57, 'Owner A')],
    history: async id => emptyHistory(id),
  }
  const B = {
    list: async () => [folder(58, 'Owner B')],
    history: async id => emptyHistory(id),
  }
  let tree
  await act(async () => {
    tree = Renderer.create(React.createElement(Panel, { client: A }))
    await Promise.resolve()
  })
  await act(async () => { tree.root.findByType('local-actions').props.onSchedule() })
  assert.equal(tree.root.findAllByType('schedule-dialog').length, 1)
  await act(async () => {
    tree.root.findByType('schedule-dialog').props.onFinished('Owner A private schedule receipt')
    await Promise.resolve()
  })
  assert.equal(tree.root.findAllByType('status-alert').length, 1)
  clearRenderTrace()
  await act(async () => {
    tree.update(React.createElement(Panel, { client: B }))
    await Promise.resolve()
  })
  assert.equal(renders.notices.some(v => String(v).includes('Owner A private')), false,
    "old owner\'s operation notice must never render in B Host generation")
  assert.equal(tree.root.findAllByType('status-alert').length, 0,
    'successful new Owner listing must clear the old completion notice')
  assert.deepEqual(tree.root.findAllByType('folder-accordion').map(x => x.props.folder.name),
    ['Owner B'])
  await act(async () => tree.unmount())
})
test('DSM ignores a prior Agent schedule completion and close after Host replacement', async () => {
  let ownerBReads = 0
  const ownerA = {
    list: async () => [folder(57, 'Owner A folder')],
    history: async id => emptyHistory(id),
  }
  const ownerB = {
    list: async () => { ownerBReads++; return [folder(58, 'Owner B folder')] },
    history: async id => emptyHistory(id),
  }
  let tree
  await act(async () => {
    tree = Renderer.create(React.createElement(Panel, { client: ownerA }))
    await Promise.resolve()
  })
  await act(async () => tree.root.findByType('local-actions').props.onSchedule())
  const oldSchedule = tree.root.findByType('schedule-dialog').props

  await act(async () => {
    tree.update(React.createElement(Panel, { client: ownerB }))
    await Promise.resolve()
  })
  assert.equal(ownerBReads, 1)
  assert.equal(tree.root.findAllByType('schedule-dialog').length, 0)
  await act(async () => tree.root.findByType('local-actions').props.onSchedule())
  assert.equal(tree.root.findByType('schedule-dialog').props.sourceID, 58)
  await act(async () => {
    // Actual shared schedule dialog can call onFinished after its awaited
    // actions.save() even though a Host change unmounted it meanwhile.
    oldSchedule.onFinished('Owner A private completion after async ACK')
    oldSchedule.onClose()
    await Promise.resolve()
  })
  assert.equal(tree.root.findByType('schedule-dialog').props.sourceID, 58,
    'old Host callbacks must not close a newer Owner schedule dialog')
  assert.equal(ownerBReads, 1,
    'old Host schedule completion must not refresh new Agent Source state')
  assert.equal(tree.root.findAllByType('status-alert').length, 0,
    'old Host completion must never be displayed in replacement Host')

  await act(async () => {
    tree.root.findByType('schedule-dialog').props.onFinished('Owner B schedule saved')
    await Promise.resolve()
  })
  assert.equal(tree.root.findAllByType('schedule-dialog').length, 0)
  assert.equal(tree.root.findAllByType('status-alert').length, 1,
    'current Host completion notice must still work')
  assert.equal(ownerBReads, 2, 'same-Host schedule completion may refresh its own listing')
  await act(async () => tree.unmount())
})

test('DSM ignores old run/close callbacks after Host A -> B -> A even with identical client identity', async () => {
  const ownerA = {
    list: async () => [folder(57, 'Owner A folder')],
    history: async id => emptyHistory(id),
  }
  const ownerB = {
    list: async () => [folder(58, 'Owner B folder')],
    history: async id => emptyHistory(id),
  }
  let tree
  await act(async () => {
    tree = Renderer.create(React.createElement(Panel, { client: ownerA }))
    await Promise.resolve()
  })
  const oldRun = tree.root.findByType('local-actions').props.onRun
  await act(async () => oldRun())
  const oldClose = tree.root.findByType('batch-dialog').props.onClose

  await act(async () => {
    tree.update(React.createElement(Panel, { client: ownerB }))
    await Promise.resolve()
  })
  await act(async () => oldRun())
  assert.equal(tree.root.findAllByType('batch-dialog').length, 0,
    'old Owner run closure must never invoke an alien Source on the B Agent')

  await act(async () => {
    tree.update(React.createElement(Panel, { client: ownerA }))
    await Promise.resolve()
  })
  await act(async () => oldRun())
  assert.equal(tree.root.findAllByType('batch-dialog').length, 0,
    'returning to the same Agent object must not revive an old Host generation')
  await act(async () => tree.root.findByType('local-actions').props.onRun())
  assert.equal(tree.root.findByType('batch-dialog').props.sourceID, 57)
  await act(async () => oldClose())
  assert.equal(tree.root.findByType('batch-dialog').props.sourceID, 57,
    'old Host close may not close a current-generation backup dialog')
  await act(async () => tree.root.findByType('batch-dialog').props.onClose())
  assert.equal(tree.root.findAllByType('batch-dialog').length, 0)
  await act(async () => tree.unmount())
})
