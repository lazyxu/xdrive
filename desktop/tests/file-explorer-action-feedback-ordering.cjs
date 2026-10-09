const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const TestRenderer = require('react-test-renderer')

const repo = path.resolve(process.env.XDRIVE_FILE_EXPLORER_SOURCE_ROOT || path.join(__dirname, '../..'))

function loadShared(name) {
  const filename = path.join(repo, `ui/shared/src/${name}.ts`)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  }).outputText
  const mod = { exports: {} }
  const localRequire = (request) => request.startsWith('../') ? loadShared(request.slice(3)) : require(request)
  new Function('exports', 'module', 'require', 'window', output)(mod.exports, mod, localRequire, {
    setInterval: () => 1, clearInterval: () => {},
  })
  return mod.exports
}

function source(relative) {
  const filename = path.join(repo, relative)
  const ast = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const find = (predicate) => {
    let found
    const visit = (current) => { if (predicate(current)) found = current; ts.forEachChild(current, visit) }
    visit(ast)
    assert.ok(found, `${relative}: required live source expression is present`)
    return found
  }
  const variable = (name) => find((current) => ts.isVariableDeclaration(current) && (
    current.name.getText(ast) === name || ts.isArrayBindingPattern(current.name) && current.name.elements.some((entry) => entry.name?.getText(ast) === name)
  ))
  const expression = (name, prop = false) => {
    const node = find((current) => prop
      ? ts.isPropertyAssignment(current) && current.name.getText(ast) === name || ts.isJsxAttribute(current) && current.name.getText(ast) === name
      : ts.isVariableDeclaration(current) && current.name.getText(ast) === name || ts.isFunctionDeclaration(current) && current.name?.text === name)
    return ts.isFunctionDeclaration(node) ? node.getText(ast)
      : ts.isJsxAttribute(node) ? node.initializer.expression.getText(ast) : node.initializer.getText(ast)
  }
  const block = (first, last) => {
    const start = variable(first).parent.parent
    const end = variable(last).parent.parent
    assert.equal(start.parent, end.parent, 'the live App feedback statements must remain in one owner')
    const statements = [...start.parent.statements]
    return statements.slice(statements.indexOf(start), statements.indexOf(end) + 1).map((entry) => entry.getText(ast)).join('\n')
  }
  const run = (body, dependencies, result) => {
    const output = ts.transpileModule(body, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: filename,
    }).outputText
    return new Function(...Object.keys(dependencies), `${output}\nreturn ${result};`)(...Object.values(dependencies))
  }
  const evaluate = (name, dependencies, prop = false) => run(`const result = ${expression(name, prop)};`, dependencies, 'result')
  return { ast, variable, expression, block, run, evaluate }
}

const shared = loadShared('file-explorer-controller')
const { useXDriveFileOperationLifecycle } = loadShared('mui/FileOperationLifecycle')
const { useXDriveFileExplorerDeleteController } = loadShared('mui/FileExplorerDeleteController')
const appSource = source('desktop/src/renderer/App.tsx')
const adapterSource = source('desktop/src/renderer/DesktopFileExplorer.tsx')
const explorerSource = source('ui/shared/src/mui/FileExplorer.tsx')
const node = { id: 1, name: 'selected.txt', type: 'file', parent_id: 10, revision: 3, size: 2 }
const item = { id: 1, name: 'selected.txt', kind: 'file', revision: 3, size: 2 }
const queuedDelete = { id: 'delete-newer', type: 'delete', status: 'queued', total_items: 1, processed_items: 0,
  total_bytes: 0, processed_bytes: 0, percent: 0, retryable: false,
  created_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z' }
const downloadResult = { canceled: false, downloaded: ['selected.txt'], failures: [] }

async function mountHarness() {
  let resolveDownload
  const download = new Promise((resolve) => { resolveDownload = resolve })
  const events = [], errors = [], confirmations = [], serverOperations = []
  let current, renderer
  const agent = {
    cloudDownloadFiles: async (items) => { events.push({ type: 'download-start', items }); return download },
    cloudCreateFileOperation: async (operation, items) => {
      events.push({ type: 'delete-submit', operation, items })
      serverOperations.push(queuedDelete)
      return { ok: true, data: queuedDelete }
    },
  }
  function Harness() {
    const loadOperations = React.useCallback(async () => [...serverOperations], [])
    const owner = useXDriveFileOperationLifecycle({ enabled: true, lifecycleKey: 'server-a\naccount-a', loadOperations })
    const appDependencies = {
      ...React, require, exports: {},
      status: { server: 'server-a', username: 'account-a' },
      rememberCloudFileOperation: owner.rememberOperation,
      cloudFileOperations: owner.operations,
      XDriveFileExplorerActionFeedback: 'action-feedback',
      setView: () => {},
      // These ordering cases render feedback without opening Task Center. Its
      // separately tested callback is a binding of the live JSX, not an action here.
      openFilesOperationTask: () => assert.fail('feedback ordering does not open Task Center'),
    }
    const feedback = appSource.run(
      appSource.block('filesFeedbackLifecycleKey', 'filesFeedbackOperation') +
        `\nconst onDownloadStart = ${appSource.expression('onDownloadStart', true)};` +
        `\nconst presenter = ${appSource.expression('actionFeedback', true)};`,
      appDependencies,
      '{ filesActionFeedback, rememberFilesOperation, onDownloadStart, value: presenter.props.value }',
    )
    const deleteController = useXDriveFileExplorerDeleteController({
      lifecycleKey: 'server-a\naccount-a', maxItems: 200,
      submitOperation: (operation, items) => agent.cloudCreateFileOperation(operation, items),
      onQueued: feedback.rememberFilesOperation,
      requestConfirmation: (confirmation) => confirmations.push(confirmation),
      onFeedback: (message) => events.push({ type: 'delete-notice', message }),
      onError: (error) => errors.push(String(error)),
    })
    // Run the actual adapter's state and busy-token functions, not an always-true
    // isCurrent stub. This test remains in one mounted account lifecycle.
    const busy = adapterSource.run([
      ...['actionBusy', 'actionBusyRef', 'actionGenerationRef'].map((name) => adapterSource.variable(name).parent.parent.getText(adapterSource.ast)),
      ...['beginActionBusy', 'isActionBusyCurrent', 'finishActionBusy'].map((name) => `const ${name} = ${adapterSource.expression(name)};`),
    ].join('\n'), React, '{ actionBusy, actionBusyRef, beginActionBusy, isActionBusyCurrent, finishActionBusy }')
    const dependencies = {
      ...shared, ...busy, useCallback: React.useCallback,
      nodeByID: new Map([[node.id, node]]), trashActive: false,
      fileOperationBusy: false, uploadBusy: false, fileTagsSupported: true,
      archiveDownloadSupported: false, folderTreeDownloadSupported: false,
      window: { xdriveDesktop: { agent } },
      onDownloadStart: feedback.onDownloadStart,
      onDeleteMany: deleteController.removeMany,
      onError: (error) => errors.push(String(error)),
      onFeedback: (tone, message) => events.push({ type: 'download-notice', tone, message }),
    }
    dependencies.getSelectionActionDisabledReason = adapterSource.evaluate('getSelectionActionDisabledReason', dependencies)
    dependencies.allowSelectionAction = adapterSource.evaluate('allowSelectionAction', dependencies)
    const downloadSelected = adapterSource.evaluate('downloadSelected', dependencies)
    const onDeleteItems = adapterSource.evaluate('onDeleteItems', dependencies, true)
    // The toolbar executes the shared selection guard and public adapter callback.
    const explorerDependencies = {
      selectedItems: [item], selectedCount: 1, loading: Boolean(busy.actionBusy),
      folderDownloadSupported: false,
      getSelectionActionDisabledReason: dependencies.getSelectionActionDisabledReason,
    }
    explorerDependencies.selectionActionDisabledReason = explorerSource.evaluate('selectionActionDisabledReason', explorerDependencies)
    const runSelectionAction = explorerSource.evaluate('runSelectionAction', explorerDependencies)
    current = {
      owner, feedback, busy, downloadSelected,
      deleteReason: explorerDependencies.selectionActionDisabledReason('delete'),
      requestDelete: () => runSelectionAction('delete', onDeleteItems),
    }
    return null
  }
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(Harness)) })
  return {
    get current() { return current }, events, errors, confirmations,
    finishDownload: async (pending) => { await TestRenderer.act(async () => { resolveDownload({ ok: true, data: downloadResult }); await pending }) },
    confirmDelete: async () => {
      await TestRenderer.act(async () => current.requestDelete())
      assert.equal(confirmations.length, 1, 'public shared selection action must reach the real App delete confirmation')
      await TestRenderer.act(async () => { await confirmations[0].run() })
    },
    unmount: async () => { await TestRenderer.act(async () => renderer.unmount()) },
  }
}

test('Desktop actual download completion presents its returned aggregate with no competing submission', async () => {
  const harness = await mountHarness()
  try {
    let pending
    await TestRenderer.act(async () => { pending = harness.current.downloadSelected([item]) })
    assert.equal(harness.current.busy.actionBusy, 'download-many')
    await harness.finishDownload(pending)
    assert.deepEqual(harness.current.feedback.value, { kind: 'download', result: { downloaded: 1, failed: 0, skippedFolders: 0, failures: [], canceled: false } })
    assert.deepEqual(harness.errors, [])
  } finally { await harness.unmount() }
})

test('Desktop pending download cannot replace feedback for a newer confirmed Files delete', async () => {
  const harness = await mountHarness()
  try {
    let pending
    await TestRenderer.act(async () => { pending = harness.current.downloadSelected([item]) })
    assert.equal(harness.current.busy.actionBusy, 'download-many')
    assert.equal(harness.current.deleteReason, null, 'the real toolbar/adapter boundary permits delete while download A is pending')
    await harness.confirmDelete()
    assert.deepEqual(harness.current.feedback.value, { kind: 'operation', operation: queuedDelete })
    assert.equal(harness.current.busy.actionBusy, 'download-many', 'delete does not replace the adapter download busy token')
    await harness.finishDownload(pending)
    assert.deepEqual(harness.current.owner.operations, [queuedDelete], 'the authoritative durable operation remains present')
    assert.deepEqual(harness.errors, [])
    assert.deepEqual(harness.current.feedback.value, { kind: 'operation', operation: queuedDelete },
      'older download completion must not displace the latest confirmed Files operation from its details entry')
  } finally { await harness.unmount() }
})

test('Desktop download initiated after a completed Files submission can become the newest outcome', async () => {
  const harness = await mountHarness()
  try {
    await harness.confirmDelete()
    assert.deepEqual(harness.current.feedback.value, { kind: 'operation', operation: queuedDelete })
    let pending
    await TestRenderer.act(async () => { pending = harness.current.downloadSelected([item]) })
    await harness.finishDownload(pending)
    assert.equal(harness.current.feedback.value?.kind, 'download')
    assert.equal(harness.current.feedback.value?.result.downloaded, 1)
    assert.deepEqual(harness.current.owner.operations, [queuedDelete])
    assert.deepEqual(harness.errors, [])
  } finally { await harness.unmount() }
})
