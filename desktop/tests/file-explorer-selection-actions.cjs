const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const TestRenderer = require('react-test-renderer')

const repo = path.resolve(process.env.XDRIVE_FILE_EXPLORER_SOURCE_ROOT || path.join(__dirname, '../..'))
function loadShared(name = 'file-explorer-controller') {
  const filename = path.join(repo, `ui/shared/src/${name}.ts`)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, require)
  return mod.exports
}
const shared = loadShared()
const node = (id) => ({ id, name: `item-${id}.txt`, type: 'file', parent_id: 1, revision: 3, size: 1 })
const item = (id) => ({ id, name: `item-${id}.txt`, kind: 'file', revision: 3, size: 1 })

function adapterSource(platform, app = false) {
  const filename = path.join(repo, platform === 'Web' ? `web/src/${app ? 'App' : 'WebFileExplorer'}.tsx` : `desktop/src/renderer/${app ? 'App' : 'DesktopFileExplorer'}.tsx`)
  const ast = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  function findExpression(name, jsx = false) {
    let result
    const visit = (current) => {
      if (jsx && ts.isJsxAttribute(current) && current.name.getText(ast) === name && current.initializer && ts.isJsxExpression(current.initializer)) result = current.initializer.expression.getText(ast)
      if (jsx && ts.isPropertyAssignment(current) && current.name.getText(ast) === name) result = current.initializer.getText(ast)
      if (!jsx && ts.isVariableDeclaration(current) && current.name.getText(ast) === name && current.initializer) result = current.initializer.getText(ast)
      if (!jsx && ts.isFunctionDeclaration(current) && current.name?.text === name) result = current.getText(ast)
      ts.forEachChild(current, visit)
    }
    visit(ast)
    return result
  }
  const compile = (expression, dependencies) => {
    const output = ts.transpileModule(`const value = ${expression};`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: filename,
    }).outputText
    return new Function(...Object.keys(dependencies), output + '\nreturn value;')(...Object.values(dependencies))
  }
  return { findExpression, compile }
}

function adapterHarness(platform, nodes, options = {}) {
  const source = adapterSource(platform)
  const sent = [], errors = [], feedback = [], outcomes = []
  const downloadResult = options.downloadResult ?? { canceled: false, downloaded: ['item-1.txt'], failures: [{ name: 'item-2.txt', message: 'disk full' }] }
  const dependencies = {
    ...shared,
    useCallback: (callback) => callback,
    nodeByID: new Map(nodes.map((entry) => [entry.id, entry])),
    trashActive: false, fileOperationBusy: false, explorerActionBusy: false, uploadBusy: false,
    fileTagsSupported: true, archiveDownloadSupported: false, folderTreeDownloadSupported: false,
    actionBusyRef: { current: '' },
    onRemoveMany: (refs) => sent.push({ type: 'delete', refs }),
    onDeleteMany: (refs) => sent.push({ type: 'delete', refs }),
    copyWorkspaceItems: (refs) => sent.push({ type: 'copy', refs }),
    cutWorkspaceItems: (refs) => sent.push({ type: 'cut', refs }),
    onError: (error) => errors.push(error instanceof Error ? error.message : String(error)),
    onFeedback: (tone, message) => feedback.push({ tone, message }),
    onDownloadResult: (value) => outcomes.push(value),
    onDownloadStart: () => (value) => outcomes.push(value),
    beginActionBusy: () => ({ generation: 1 }), isActionBusyCurrent: () => true, finishActionBusy: () => {},
    api: {
      download: async (file) => { sent.push({ type: 'download', refs: [file] }); return true },
      downloadArchive: async (ids) => { sent.push({ type: 'download', refs: ids }); return true },
    },
    window: { xdriveDesktop: { agent: {
      cloudDownloadFiles: async (refs) => { sent.push({ type: 'download', refs }); return { ok: true, data: downloadResult } },
      cloudDownloadArchive: async (refs) => { sent.push({ type: 'download', refs }); return { ok: true, data: { canceled: false, downloaded: ['archive.zip'] } } },
    } } },
    ...options,
  }
  const availability = source.findExpression('getSelectionActionDisabledReason')
  dependencies.getSelectionActionDisabledReason = availability ? source.compile(availability, dependencies) : undefined
  const allow = source.findExpression('allowSelectionAction')
  dependencies.allowSelectionAction = allow ? source.compile(allow, dependencies) : () => true
  const action = (name, jsx = false) => {
    const expression = source.findExpression(name, jsx)
    assert.ok(expression, `${platform} must expose ${name}`)
    return source.compile(expression, dependencies)
  }
  return { action, getSelectionActionDisabledReason: dependencies.getSelectionActionDisabledReason, sent, errors, feedback, outcomes, downloadResult }
}

test('clipboard refuses an unresolved selected root instead of copying a subset', () => {
  assert.equal(shared.xDriveFileExplorerClipboardFromItems('copy', [item(1), item(2)], new Map([[1, node(1)]])), null)
})

test('clipboard stores unique selected identities once', () => {
  const clipboard = shared.xDriveFileExplorerClipboardFromItems('copy', [item(1), { ...item(1), id: '1' }], new Map([[1, node(1)]]))
  assert.deepEqual(clipboard.nodes.map((entry) => entry.id), [1])
})

test('drop planning refuses an unresolved selected root instead of moving a subset', () => {
  assert.equal(shared.xDriveFileExplorerDropItemsToParentPlan('move', [item(1), item(2)], 10, new Map([[1, node(1)]])), null)
})

for (const platform of ['Web', 'Desktop']) {
  test(`${platform} Delete does not hand a partially resolved selection to App`, () => {
    const harness = adapterHarness(platform, [node(1)])
    harness.action('onDeleteItems', true)([item(1), item(2)])
    assert.deepEqual(harness.sent, [], 'no incomplete delete confirmation or operation may be submitted')
    assert.match(harness.errors.join(' '), /加载|信息|不可用/)
  })

  test(`${platform} Delete rejects 201 selected roots before App confirmation`, () => {
    const nodes = Array.from({ length: 201 }, (_, index) => node(index + 1))
    const harness = adapterHarness(platform, nodes)
    harness.action('onDeleteItems', true)(nodes.map(({ id }) => item(id)))
    assert.deepEqual(harness.sent, [], 'the 200-root Server limit must not become a failed submission or silently split batch')
    assert.match(harness.errors.join(' '), /200/)
  })

  test(`${platform} Delete passes exactly 200 complete roots with their revisions`, () => {
    const nodes = Array.from({ length: 200 }, (_, index) => node(index + 1))
    const harness = adapterHarness(platform, nodes)
    harness.action('onDeleteItems', true)(nodes.map(({ id }) => item(id)))
    assert.deepEqual(harness.sent, [{ type: 'delete', refs: nodes }])
    assert.deepEqual(harness.errors, [])
  })

  test(`${platform} Download does not save only the available subset`, async () => {
    const harness = adapterHarness(platform, [node(1)])
    await harness.action('downloadSelected')([item(1), item(2)])
    assert.deepEqual(harness.sent, [])
    assert.match(harness.errors.join(' '), /加载|信息|不可用/)
  })

  test(`${platform} action availability separates mutation limits from selection and tag capacity`, () => {
    const nodes = Array.from({ length: 501 }, (_, index) => node(index + 1))
    const harness = adapterHarness(platform, nodes)
    const reason = harness.getSelectionActionDisabledReason
    assert.equal(typeof reason, 'function', 'adapter must provide shared action availability')
    for (const action of ['copy', 'cut', 'delete']) assert.match(reason(action, nodes.slice(0, 201).map(({ id }) => item(id)), 201), /200/)
    assert.equal(reason('manage-tags', nodes.slice(0, 500).map(({ id }) => item(id)), 500), null)
    assert.match(reason('manage-tags', nodes.map(({ id }) => item(id)), 501), /500/)
    assert.equal(reason('download', nodes.map(({ id }) => item(id)), 501), null, 'the mutation limit must not cap a supported download')
    assert.match(reason('copy', [item(1)], 2), /加载|信息|不可用/)
  })

  test(`${platform} direct Copy and Cut preserve the complete-set guard outside the shared toolbar`, () => {
    const nodes = Array.from({ length: 201 }, (_, index) => node(index + 1))
    for (const action of ['copy', 'cut']) {
      const harness = adapterHarness(platform, nodes)
      const run = harness.action(`${action}Items`)
      run(nodes.map(({ id }) => item(id)))
      run([item(1), item(999)])
      assert.deepEqual(harness.sent, [])
      assert.match(harness.errors[0], /200/)
      assert.match(harness.errors[1], /加载|信息|不可用/)
      run([item(1), item(2)])
      assert.deepEqual(harness.sent, [{ type: action, refs: [item(1), item(2)] }])
    }
  })

  test(`${platform} mutation eligibility requires current revisions while read-only download remains available`, () => {
    const harness = adapterHarness(platform, [{ ...node(1), revision: 0 }])
    assert.match(harness.getSelectionActionDisabledReason('delete', [item(1)], 1), /版本|刷新/)
    assert.equal(harness.getSelectionActionDisabledReason('download', [item(1)], 1), null)
  })
}

test('Desktop forwards genuine download partial results to Files with named failures', async () => {
  const harness = adapterHarness('Desktop', [node(1), node(2)])
  await harness.action('downloadSelected')([item(1), item(2)])
  assert.deepEqual(harness.outcomes, [{ downloaded: 1, failed: 1, skippedFolders: 0, failures: [{ name: 'item-2.txt', message: 'disk full' }], canceled: false }])
  assert.match(harness.feedback[0].message, /1 个文件，1 个失败/)
})

test('Desktop fallback reports actual file outcomes and explicitly skipped selected folders', async () => {
  const folder = { ...node(2), type: 'dir', name: 'folder' }
  const harness = adapterHarness('Desktop', [node(1), folder], {
    downloadResult: { canceled: false, downloaded: ['item-1.txt'], failures: [] },
  })
  assert.match(harness.getSelectionActionDisabledReason('download', [{ ...item(2), kind: 'folder' }], 1), /不支持.*文件夹/)
  await harness.action('downloadSelected')([item(1), { ...item(2), kind: 'folder' }])
  assert.equal(harness.sent[0].refs.length, 1)
  assert.deepEqual(harness.outcomes, [{ downloaded: 1, failed: 0, skippedFolders: 1, failures: [], canceled: false }])
})

test('Desktop canceled download preserves completed and failed outcomes without a success toast', async () => {
  const harness = adapterHarness('Desktop', [node(1), node(2)], {
    downloadResult: { canceled: true, downloaded: ['item-1.txt'], failures: [{ name: 'item-2.txt', message: 'disk full' }] },
  })
  await harness.action('downloadSelected')([item(1), item(2)])
  assert.deepEqual(harness.outcomes, [{ downloaded: 1, failed: 1, skippedFolders: 0, failures: [{ name: 'item-2.txt', message: 'disk full' }], canceled: true }])
  assert.deepEqual(harness.feedback, [])
})

test('Desktop folder-tree result reports only the aggregate actually returned by Agent', async () => {
  const folder = { ...node(1), type: 'dir', name: 'folder' }
  const harness = adapterHarness('Desktop', [folder], {
    folderTreeDownloadSupported: true,
    window: { xdriveDesktop: { agent: {
      cloudDownloadFolder: async () => ({ ok: true, data: { downloaded: 7, failed: 2, canceled: false, root: 'folder' } }),
    } } },
  })
  await harness.action('downloadSelected')([{ ...item(1), kind: 'folder' }])
  assert.deepEqual(harness.outcomes, [{ downloaded: 7, failed: 2, skippedFolders: 0, canceled: false }])
  assert.equal(Object.hasOwn(harness.outcomes[0], 'failures'), false)
})

test('archive download completion does not invent per-file outcomes on either platform', async () => {
  for (const platform of ['Web', 'Desktop']) {
    const harness = adapterHarness(platform, [node(1), node(2)], {
      archiveDownloadSupported: true,
      window: { xdriveDesktop: { agent: {
        cloudDownloadArchive: async () => ({ ok: true, data: { canceled: false, downloaded: ['archive.zip'] } }),
      } } },
    })
    await harness.action('downloadSelected')([item(1), item(2)])
    assert.deepEqual(harness.outcomes, [])
    assert.equal(harness.feedback.length, 1)
  }
})

for (const [platform, archiveDownloadSupported, label] of [
  ['Web', true, 'Web archive'],
  ['Desktop', true, 'Desktop archive'],
  ['Desktop', false, 'Desktop file batch'],
]) {
  test(`${label} download transport limit allows 1000 roots and explains why 1001 are unavailable`, () => {
    const nodes = Array.from({ length: 1001 }, (_, index) => node(index + 1))
    const harness = adapterHarness(platform, nodes, { archiveDownloadSupported })
    assert.equal(harness.getSelectionActionDisabledReason('download', nodes.slice(0, 1000).map(({ id }) => item(id)), 1000), null)
    assert.match(harness.getSelectionActionDisabledReason('download', nodes.map(({ id }) => item(id)), 1001), /1000/)
  })

  test(`${label} download handler honors the transport limit without submitting or truncating 1001 roots`, async () => {
    const nodes = Array.from({ length: 1001 }, (_, index) => node(index + 1))
    const harness = adapterHarness(platform, nodes, { archiveDownloadSupported })
    await harness.action('downloadSelected')(nodes.slice(0, 1000).map(({ id }) => item(id)))
    assert.equal(harness.sent[0].refs.length, 1000)
    harness.sent.length = 0
    const selected = nodes.map(({ id }) => item(id))
    await harness.action('downloadSelected')(selected)
    assert.deepEqual(harness.sent, [], 'a 1001-root action must not reach either bounded transport')
    assert.equal(selected.length, 1001, 'the user selection must remain intact')
    assert.match(harness.errors.join(' '), /1000/)
  })
}

function loadHook(name) {
  const filename = path.join(repo, `ui/shared/src/mui/${name}.ts`)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  }).outputText
  const mod = { exports: {} }
  const localRequire = (request) => request === '../file-explorer-controller' ? shared
    : request.startsWith('../') ? loadShared(request.slice(3))
    : require(request)
  new Function('exports', 'module', 'require', 'window', output)(mod.exports, mod, localRequire, {
    setInterval: () => 1, clearInterval: () => {},
  })
  return mod.exports
}

test('operation controller rejects an oversized clipboard plan even when it came from another context', async () => {
  const { useXDriveFileExplorerOperationController } = loadHook('FileExplorerOperationController')
  const sent = [], errors = [], completed = []
  const nodes = Array.from({ length: 201 }, (_, index) => node(index + 1))
  let current, renderer
  function Harness() {
    current = useXDriveFileExplorerOperationController({
      lifecycleKey: 'account-a', nodeByID: new Map(nodes.map(node => [node.id, node])), currentID: 10, maxItems: 200,
      canPaste: (busy) => !busy,
      planPaste: () => ({ operation: 'move', parentID: 10, items: nodes.map(({ id, revision }) => ({ id, revision })), count: nodes.length, clearClipboard: true, clipboardGeneration: 1 }),
      completePaste: () => completed.push('clipboard'), clearSearch: () => completed.push('search'),
      submitOperation: async plan => { sent.push(plan); return { id: 'queued' } },
      onQueued: () => completed.push('queued'), onFeedback: () => completed.push('feedback'), onError: error => errors.push(String(error)),
    })
    return null
  }
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(Harness)) })
  try {
    await TestRenderer.act(async () => { await current.pasteClipboard() })
    assert.deepEqual(sent, [], 'oversized plan must not reach the transport')
    assert.equal(current.canPaste, false)
    assert.deepEqual(completed, [])
    assert.match(errors.join(' '), /200/)
  } finally { await TestRenderer.act(async () => renderer.unmount()) }
})

for (const platform of ['Web', 'Desktop']) {
  test(`${platform} App traces a Files submission by ID while retaining the existing lifecycle owner`, () => {
    const source = adapterSource(platform, true)
    const remembered = [], feedback = []
    const operation = { id: 'operation-7', status: 'queued' }
    const dependencies = {
      useCallback: callback => callback,
      username: 'account-a', status: { server: 'server-a', username: 'account-a' },
      filesFeedbackLifecycleKey: platform === 'Web' ? 'account-a' : 'server-a\naccount-a',
      filesActionFeedbackIntentRef: { current: 0 },
      rememberFileOperation: value => remembered.push(value),
      rememberCloudFileOperation: value => remembered.push(value),
      setFilesActionFeedback: value => feedback.push(value),
    }
    const remember = source.findExpression('rememberFilesOperation')
    if (remember) dependencies.rememberFilesOperation = source.compile(remember, dependencies)
    const expression = source.findExpression('onOperationQueued', true)
    assert.ok(expression)
    source.compile(expression, dependencies)(operation)
    assert.deepEqual(remembered, [operation])
    assert.equal(feedback.length, 1, 'Files must retain a trace to the accepted job')
    assert.equal(feedback[0].operationID, operation.id)
    assert.equal(Object.hasOwn(feedback[0], 'operation'), false, 'the App-owned operation list remains authoritative')
  })

  test(`${platform} Files outcome follows the current App operation record and opens the existing Task Center`, () => {
    const source = adapterSource(platform, true)
    const operation = { id: 'operation-7', status: 'failed', error: 'destination changed', processed_items: 0 }
    const trace = { lifecycleKey: 'account-a', operationID: operation.id }
    const dependencies = {
      filesActionFeedback: trace, currentFilesActionFeedback: trace,
      filesFeedbackLifecycleKey: 'account-a', fileOperations: [operation], cloudFileOperations: [operation],
    }
    const operationExpression = source.findExpression('filesFeedbackOperation')
    assert.ok(operationExpression, 'Files must derive the operation from the current lifecycle list')
    const filesFeedbackOperation = source.compile(operationExpression, dependencies)
    assert.equal(filesFeedbackOperation, operation, 'a later failed/running/completed record must replace the original queued status')
    const views = [], dismissed = []
    const presenterDependencies = {
      ...dependencies, filesFeedbackOperation, require, exports: {},
      XDriveFileExplorerActionFeedback: 'action-feedback',
      setAppView: value => views.push(value), setView: value => views.push(value),
      setFilesActionFeedback: value => dismissed.push(value),
      useCallback: callback => callback,
      filesOperationFocusSequenceRef: { current: 0 },
      setFilesOperationFocus: () => {}, setTaskCenterFocus: () => {},
      taskCenter: { pageProps: { onBackgroundScopeChange: () => {} } },
    }
    const opener = source.findExpression('openFilesOperationTask')
    if (opener) presenterDependencies.openFilesOperationTask = source.compile(opener, presenterDependencies)
    const presenter = source.compile(source.findExpression('actionFeedback', true), presenterDependencies)
    assert.deepEqual(presenter.props.value, { kind: 'operation', operation })
    presenter.props.onViewTask(operation.id)
    presenter.props.onDismiss()
    assert.deepEqual(views, ['transfers'])
    assert.deepEqual(dismissed, [null])
  })

  test(`${platform} existing operation lifecycle fence preserves a newer Files outcome after account switch`, async () => {
    const { useXDriveFileExplorerOperationController } = loadHook('FileExplorerOperationController')
    const { useXDriveFileOperationLifecycle } = loadHook('FileOperationLifecycle')
    const source = adapterSource(platform, true)
    const rememberExpression = source.findExpression('rememberFilesOperation')
    assert.ok(rememberExpression)
    const pending = new Map()
    for (const key of ['account-a', 'account-b']) {
      let resolve
      const promise = new Promise(done => { resolve = done })
      pending.set(key, { promise, resolve })
    }
    let current, renderer
    const serverOperations = new Map()
    function Harness({ lifecycleKey }) {
      const loadOperations = React.useCallback(async () => serverOperations.get(lifecycleKey) ?? [], [lifecycleKey])
      const owner = useXDriveFileOperationLifecycle({ enabled: true, lifecycleKey, loadOperations })
      const [trace, setTrace] = React.useState(null)
      const filesActionFeedbackIntentRef = React.useRef(0)
      const remember = source.compile(rememberExpression, {
        useCallback: React.useCallback,
        filesFeedbackLifecycleKey: lifecycleKey,
        filesActionFeedbackIntentRef,
        rememberFileOperation: owner.rememberOperation,
        rememberCloudFileOperation: owner.rememberOperation,
        setFilesActionFeedback: setTrace,
      })
      const controller = useXDriveFileExplorerOperationController({
        lifecycleKey, nodeByID: new Map([[1, node(1)]]), currentID: 10, maxItems: 200,
        canPaste: busy => !busy,
        planPaste: () => ({ operation: 'copy', parentID: 10, items: [{ id: 1, revision: 3 }], count: 1, clearClipboard: false, clipboardGeneration: 1 }),
        completePaste: () => {}, clearSearch: () => {},
        submitOperation: () => pending.get(lifecycleKey).promise,
        onQueued: remember, onFeedback: () => {}, onError: error => { throw error },
      })
      current = { controller, operations: owner.operations, trace }
      return null
    }
    await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(Harness, { lifecycleKey: 'account-a' })) })
    try {
      let oldSubmission, newSubmission
      await TestRenderer.act(async () => { oldSubmission = current.controller.pasteClipboard() })
      await TestRenderer.act(async () => { renderer.update(React.createElement(Harness, { lifecycleKey: 'account-b' })) })
      await TestRenderer.act(async () => { newSubmission = current.controller.pasteClipboard() })
      const operation = { id: 'new-operation', status: 'queued' }
      serverOperations.set('account-b', [operation])
      await TestRenderer.act(async () => { pending.get('account-b').resolve(operation); await newSubmission })
      assert.deepEqual(current.operations, [operation])
      assert.deepEqual(current.trace, { lifecycleKey: 'account-b', operationID: operation.id })
      await TestRenderer.act(async () => { pending.get('account-a').resolve({ id: 'old-operation', status: 'queued' }); await oldSubmission })
      assert.deepEqual(current.operations, [operation])
      assert.deepEqual(current.trace, { lifecycleKey: 'account-b', operationID: operation.id })
    } finally { await TestRenderer.act(async () => renderer.unmount()) }
  })
}

test('delete controller rejects an oversized direct request before showing confirmation', async () => {
  const { useXDriveFileExplorerDeleteController } = loadHook('FileExplorerDeleteController')
  const confirmations = [], errors = [], sent = []
  let current, renderer
  function Harness() {
    current = useXDriveFileExplorerDeleteController({
      lifecycleKey: 'account-a', maxItems: 200,
      submitOperation: async (...args) => { sent.push(args); return { id: 'delete' } },
      onQueued: () => {}, requestConfirmation: value => confirmations.push(value), onFeedback: () => {}, onError: error => errors.push(String(error)),
    })
    return null
  }
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(Harness)) })
  try {
    current.removeMany(Array.from({ length: 201 }, (_, index) => node(index + 1)))
    assert.deepEqual(confirmations, [])
    assert.deepEqual(sent, [])
    assert.match(errors.join(' '), /200/)
  } finally { await TestRenderer.act(async () => renderer.unmount()) }
})
