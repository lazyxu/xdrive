const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const TestRenderer = require('react-test-renderer')

const repo = path.resolve(process.env.XDRIVE_FILE_EXPLORER_SOURCE_ROOT || path.join(__dirname, '../..'))
const modules = new Map()
function loadSource(relative) {
  const filename = path.resolve(repo, relative)
  if (modules.has(filename)) return modules.get(filename).exports
  const mod = { exports: {} }
  modules.set(filename, mod)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  }).outputText
  const localRequire = request => {
    if (!request.startsWith('.')) return require(request)
    const target = path.resolve(path.dirname(filename), request)
    return loadSource([target, `${target}.ts`, `${target}.tsx`].find(file => fs.existsSync(file) && fs.statSync(file).isFile()))
  }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports
}
const shared = loadSource('ui/shared/src/file-explorer-controller.ts')
const { useXDriveFileExplorerOperationController } = loadSource('ui/shared/src/mui/FileExplorerOperationController.ts')
const node = id => ({ id, revision: 3, name: `file-${id}.txt`, type: 'file', parent_id: 1 })
const root = { id: 1, name: '我的文件' }
const destination = [root, { id: 10, name: '目标' }]
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function createController(options = {}) {
  const nodes = options.nodes ?? [node(2), node(3)]
  const submitted = [], queued = [], feedback = [], errors = [], completions = []
  let current, renderer
  let props = {
    lifecycleKey: 'account-a', maxItems: 200, nodeByID: new Map(nodes.map(value => [value.id, value])), currentID: 1,
    canPaste: busy => !busy, planPaste: () => null,
    completePaste: () => completions.push('clipboard'), clearSearch: () => completions.push('search'),
    submitOperation: async plan => { submitted.push(plan); return options.submit ? options.submit(plan) : { id: 'accepted', status: 'queued' } },
    onQueued: value => queued.push(value), onFeedback: (...value) => feedback.push(value),
    onError: error => errors.push(error), ...options.props,
  }
  function Harness() { current = useXDriveFileExplorerOperationController(props); return null }
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(Harness)) })
  return {
    get current() { return current }, nodes, submitted, queued, feedback, errors, completions,
    async run(action) { await TestRenderer.act(async () => { await action(current) }) },
    async update(next) { props = { ...props, ...next }; await TestRenderer.act(async () => renderer.update(React.createElement(Harness))) },
    async dispose() { await TestRenderer.act(async () => renderer.unmount()) },
  }
}
function requireDestination(controller) {
  assert.equal(typeof controller.openDestination, 'function', 'the shared operation controller must open a direct destination flow')
  assert.equal(typeof controller.submitDestination, 'function', 'the direct submit method must return an awaited result')
}

test('destination target validation is shared and never silently excludes selected roots', () => {
  const reason = shared.xDriveFileExplorerDestinationTargetDisabledReason
  assert.equal(typeof reason, 'function')
  const folder = { ...node(2), type: 'dir', name: 'folder' }
  assert.match(reason('copy', [folder], []), /目标|文件夹/)
  assert.match(reason('copy', [folder], [root, { id: 2, name: 'folder' }]), /自身|子文件夹/)
  assert.match(reason('move', [folder], [root, { id: 2, name: 'folder' }, { id: 4, name: 'nested' }]), /自身|子文件夹/)
  assert.match(reason('move', [node(2), { ...node(3), parent_id: 10 }], destination), /已.*此|当前|目标/)
  assert.equal(reason('copy', [node(2)], [root]), null, 'same-parent copy keeps the existing duplicate-copy behavior')
  assert.equal(reason('move', [node(2)], destination), null)
})

for (const operation of ['move', 'copy']) {
  test(`direct ${operation} captures immutable complete sources and leaves clipboard untouched`, async () => {
    const h = await createController()
    try {
      requireDestination(h.current)
      await h.run(current => current.openDestination(operation, [{ id: 2 }, { id: 3 }, { id: '2' }], [root]))
      const request = h.current.destinationRequest
      assert.equal(request.operation, operation)
      assert.deepEqual(request.sources.map(value => [value.id, value.revision]), [[2, 3], [3, 3]])
      h.nodes[0].revision = 99
      h.nodes[0].name = 'later mutation'
      const newerSearchClears = []
      await h.update({ nodeByID: new Map(), currentID: 90, clearSearch: () => newerSearchClears.push('newer') })
      assert.equal(h.current.destinationRequest, request)
      assert.equal(request.sources[0].name, 'file-2.txt')
      await h.run(current => current.submitDestination(destination))
      assert.deepEqual(h.submitted, [{ operation, parentID: 10, items: [{ id: 2, revision: 3 }, { id: 3, revision: 3 }], count: 2 }])
      assert.equal(h.current.destinationRequest, null)
      assert.equal(h.queued.length, 1)
      assert.deepEqual(h.completions, ['search'], 'direct destination actions must not complete or rewrite clipboard state')
      assert.deepEqual(newerSearchClears, [], 'acceptance must keep the source callback captured when the picker opened')
    } finally { await h.dispose() }
  })
}

test('direct destination rejects incomplete metadata and201 roots before opening', async () => {
  const nodes = Array.from({ length: 201 }, (_, index) => node(index + 2))
  const h = await createController({ nodes })
  try {
    requireDestination(h.current)
    await h.run(current => current.openDestination('move', nodes.map(({ id }) => ({ id })), [root]))
    assert.equal(h.current.destinationRequest, null)
    assert.match(String(h.errors.at(-1)), /200/)
    await h.run(current => current.openDestination('copy', [{ id: 2 }, { id: 9999 }], [root]))
    assert.equal(h.current.destinationRequest, null)
    assert.match(String(h.errors.at(-1)), /完整|加载|信息/)
    assert.deepEqual(h.submitted, [])
    await h.run(current => current.openDestination('copy', nodes.slice(0, 200).map(({ id }) => ({ id })), [root]))
    assert.equal(h.current.destinationRequest.sources.length, 200)
    await h.run(current => current.submitDestination([root, { id: 999, name: '目标' }]))
    assert.equal(h.submitted[0].count, 200)
    assert.deepEqual(h.submitted[0].items, nodes.slice(0, 200).map(({ id, revision }) => ({ id, revision })))
  } finally { await h.dispose() }
})

test('direct destination rejects transport failure and preserves the exact draft for retry', async () => {
  let fail = true
  const h = await createController({ submit: async () => {
    if (fail) throw new Error('目标权限已改变')
    return { id: 'retried', status: 'queued' }
  } })
  try {
    requireDestination(h.current)
    await h.run(current => current.openDestination('copy', [{ id: 2 }], [root]))
    const request = h.current.destinationRequest
    await h.run(current => assert.rejects(current.submitDestination(destination), /目标权限已改变/))
    assert.equal(h.current.destinationRequest, request)
    assert.deepEqual(h.queued, [])
    assert.deepEqual(h.completions, [])
    fail = false
    await h.run(current => current.submitDestination(destination))
    assert.equal(h.current.destinationRequest, null)
    assert.equal(h.submitted.length, 2)
    assert.deepEqual(h.submitted[0], h.submitted[1])
    assert.equal(h.queued.length, 1)
  } finally { await h.dispose() }
})

test('direct destination refusal rejects without closing the draft or submitting a subset', async () => {
  const h = await createController({ nodes: [node(2), { ...node(3), parent_id: 10 }] })
  try {
    requireDestination(h.current)
    await h.run(current => current.openDestination('move', [{ id: 2 }, { id: 3 }], [root]))
    const request = h.current.destinationRequest
    await h.run(current => assert.rejects(current.submitDestination(destination), /已.*此|当前|目标/))
    assert.equal(h.current.destinationRequest, request)
    await h.update({ disabled: true })
    await h.run(current => assert.rejects(current.submitDestination([root, { id: 20, name: 'another' }]), /正在|稍后|不可用/))
    assert.equal(h.current.destinationRequest, request)
    assert.deepEqual(h.submitted, [])
    await h.run(current => current.closeDestination())
    assert.equal(h.current.destinationRequest, null)
    assert.deepEqual(h.completions, [])
  } finally { await h.dispose() }
})

test('direct destination shares the existing synchronous submission owner', async () => {
  const pending = deferred()
  const h = await createController({ submit: () => pending.promise })
  try {
    requireDestination(h.current)
    await h.run(current => current.openDestination('copy', [{ id: 2 }], [root]))
    let first
    await h.run(async current => {
      first = current.submitDestination(destination)
      await assert.rejects(current.submitDestination(destination), /正在|稍后/)
    })
    assert.equal(h.submitted.length, 1)
    await h.run(async () => { pending.resolve({ id: 'accepted', status: 'queued' }); await first })
    assert.equal(h.queued.length, 1)
  } finally { await h.dispose() }
})

test('old destination acceptance cannot close a new account draft', async () => {
  const pending = deferred()
  const h = await createController({ submit: () => pending.promise })
  try {
    requireDestination(h.current)
    await h.run(current => current.openDestination('copy', [{ id: 2 }], [root]))
    let first
    await h.run(current => { first = current.submitDestination(destination) })
    await h.update({ lifecycleKey: 'account-b' })
    assert.equal(h.current.destinationRequest, null)
    await h.run(current => current.openDestination('move', [{ id: 3 }], [root]))
    const newer = h.current.destinationRequest
    await h.run(async () => { pending.resolve({ id: 'old', status: 'queued' }); await assert.rejects(first, /会话|已变化|已失效/) })
    assert.equal(h.current.destinationRequest, newer)
    assert.deepEqual(h.queued, [])
    assert.deepEqual(h.completions, [])
  } finally { await h.dispose() }
})

function appSource(platform, app = false) {
  const file = path.join(repo, platform === 'Web' ? `web/src/${app ? 'App' : 'WebFileExplorer'}.tsx` : `desktop/src/renderer/${app ? 'App' : 'DesktopFileExplorer'}.tsx`)
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  function expression(name, jsx = false) {
    let result
    function visit(current) {
      if (!jsx && ts.isVariableDeclaration(current) && current.name.getText(ast) === name && current.initializer) result = current.initializer.getText(ast)
      if (jsx && ts.isJsxAttribute(current) && current.name.getText(ast) === name && current.initializer && ts.isJsxExpression(current.initializer)) result = current.initializer.expression.getText(ast)
      if (jsx && ts.isPropertyAssignment(current) && current.name.getText(ast) === name) result = current.initializer.getText(ast)
      ts.forEachChild(current, visit)
    }
    visit(ast)
    return result
  }
  function compile(expression, dependencies) {
    const output = ts.transpileModule(`const value = ${expression};`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: file }).outputText
    return new Function(...Object.keys(dependencies), output + '\nreturn value;')(...Object.values(dependencies))
  }
  return { expression, compile }
}

for (const platform of ['Web', 'Desktop']) {
  test(`${platform} direct Move/Copy To delegates complete selection and authoritative crumbs`, () => {
    const source = appSource(platform)
    for (const [prop, operation] of [['onMoveItemsTo', 'move'], ['onCopyItemsTo', 'copy']]) {
      const calls = []
      const expression = source.expression(prop, true)
      assert.ok(expression, `${platform} must expose ${prop}`)
      const callback = source.compile(expression, { trashActive: false, crumbs: [root], openDestination: (...args) => calls.push(args) })
      const selected = [{ id: 2 }, { id: 3 }]
      callback(selected)
      assert.deepEqual(calls, [[operation, selected, [root]]])
    }
  })

  test(`${platform} View Task selects mine scope and carries a repeatable exact operation focus request`, () => {
    const source = appSource(platform, true)
    const views = [], scopes = [], requests = []
    const dependencies = {
      useCallback: callback => callback, require, exports: {},
      XDriveFileExplorerActionFeedback: 'action-feedback',
      filesFeedbackOperation: { id: 'operation-target' }, currentFilesActionFeedback: null,
      filesOperationFocusSequenceRef: { current: 0 },
      setFilesOperationFocus: value => requests.push(value), setTaskCenterFocus: () => {},
      taskCenter: { pageProps: { onBackgroundScopeChange: value => scopes.push(value) } },
      setAppView: value => views.push(value), setView: value => views.push(value), setFilesActionFeedback: () => {},
    }
    const opener = source.expression('openFilesOperationTask')
    if (opener) dependencies.openFilesOperationTask = source.compile(opener, dependencies)
    const presenter = source.compile(source.expression('actionFeedback', true), dependencies)
    presenter.props.onViewTask('operation-target')
    presenter.props.onViewTask('operation-target')
    assert.deepEqual(views, ['transfers', 'transfers'])
    assert.deepEqual(scopes, ['mine', 'mine'])
    assert.deepEqual(requests, [{ operationID: 'operation-target', requestID: 1 }, { operationID: 'operation-target', requestID: 2 }])
  })
}
