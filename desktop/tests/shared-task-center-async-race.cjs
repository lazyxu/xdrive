const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const filename = path.join(root, 'ui/shared/src/mui/TaskCenterController.ts')

function compileRealCallback(hookName, callbackName, env) {
  const source = fs.readFileSync(filename, 'utf8')
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let initializer
  const parent = ast.statements.find((item) =>
    ts.isFunctionDeclaration(item) && item.name?.text === hookName)
  assert.ok(parent, 'missing production hook ' + hookName)
  function visit(node) {
    if (ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) && node.name.text === callbackName) {
      initializer = node.initializer?.getText(ast)
    }
    ts.forEachChild(node, visit)
  }
  visit(parent)
  assert.ok(initializer?.startsWith('useCallback('),
    'missing actual ' + hookName + '.' + callbackName)
  const output = ts.transpileModule('const callback = ' + initializer + ';', {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const names = Object.keys(env)
  return new Function(...names, output + '\nreturn callback')(
    ...names.map((key) => env[key]),
  )
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}

function settledPage(id) {
  return { current_items: [{ id }], history_items: [], next_cursor: '' }
}
function values(page) {
  return [...page.current, ...page.history].map((item) => item.id)
}
const tick = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve() }
const empty = () => ({ current: [], history: [], nextCursor: '', loadedMore: false })

function fixture() {
  const summaryRequestRef = { current: 0 }
  const summarySourceRef = { current: null }
  const listRefreshRequestRef = { current: 0 }
  const listMoreRequestRef = { current: 0 }
  const listSourceRef = { current: null }
  const onErrorRef = { current: undefined }
  const events = []
  let summary
  let mine = empty()
  let global = empty()
  let mineLoading = false
  let moreLoading = false
  const core = {
    useCallback: (fn) => fn,
    xDriveNormalizeBackgroundTaskPage: (page) => page,
    XDRIVE_BACKGROUND_TASK_HISTORY_PAGE_LIMIT: 50,
    mergeBackgroundTaskHistory: (fresh, prior) => [...fresh, ...prior],
    appendBackgroundTaskHistory: (prior, next) => [...prior, ...next],
    summaryRequestRef, summarySourceRef,
    listRefreshRequestRef, listMoreRequestRef, listSourceRef, onErrorRef,
    setSummary: (value) => { summary = value },
    setSummaryState: (value) => { summary = value.value },
    setMine: (value) => { mine = typeof value === 'function' ? value(mine) : value },
    setGlobalTasks: (value) => { global = typeof value === 'function' ? value(global) : value },
    setMineLoading: (value) => { mineLoading = value },
    setGlobalLoading: () => {},
    setMineLoadingMore: (value) => { moreLoading = value },
    setGlobalLoadingMore: () => {},
    onError: (error) => { events.push(error.message) },
  }
  const ctx = {
    core,
    events,
    get summary() { return summary },
    get mine() { return mine },
    get global() { return global },
    get mineLoading() { return mineLoading },
    get moreLoading() { return moreLoading },
    setMine(value) { mine = value },
  }
  const summaryCallback = (port, lifecycleKey = 'same-owner') => {
    core.summarySourceRef.current = { port, enabled: true, lifecycleKey }
    return compileRealCallback('useXDriveBackgroundTaskActiveSummary', 'refresh', {
      ...core, port, enabled: true, lifecycleKey,
    })
  }
  const listCallback = (which, port, opts = {}) => {
    const lifecycleKey = opts.lifecycleKey ?? 'same-owner'
    const visible = opts.visible ?? true
    const effectiveScope = opts.effectiveScope ?? 'mine'
    core.listSourceRef.current = {
      port, enabled: true, lifecycleKey, visible, effectiveScope,
    }
    return compileRealCallback('useXDriveBackgroundTasks', which, {
      ...core, port, enabled: true, visible,
      lifecycleKey, effectiveScope,
      visibleState: opts.visibleState ?? { ...mine },
      globalLoadingMore: false, mineLoadingMore: false,
    })
  }
  return Object.assign(ctx, { summaryCallback, listCallback })
}

test('Task Center old summary response cannot overwrite newer total', async () => {
  const f = fixture()
  const older = deferred()
  const oldPort = { loadActiveSummary: () => older.promise }
  const newPort = { loadActiveSummary: async () => ({ active_total: 1, file_operation: 0 }) }
  const old = f.summaryCallback(oldPort)()
  await tick()
  await f.summaryCallback(newPort)()
  assert.equal(f.summary.active_total, 1)
  older.resolve({ active_total: 9, file_operation: 0 })
  await old
  assert.equal(f.summary.active_total, 1,
    'older active-summary response must not restore stale badge counts after newer read')
})

test('Task Center older Mine refresh cannot erase a newer completed task list', async () => {
  const f = fixture()
  const older = deferred()
  const oldPort = { loadMinePage: () => older.promise }
  const newPort = { loadMinePage: async () => settledPage('newest') }
  const old = f.listCallback('refresh', oldPort)()
  await tick()
  await f.listCallback('refresh', newPort)()
  assert.deepEqual(values(f.mine), ['newest'])
  older.resolve(settledPage('older'))
  await old
  assert.deepEqual(values(f.mine), ['newest'],
    'old Task Center refresh must never replace the last accepted Server snapshot')
})

test('Task Center old pagination must not append into a new refresh collection', async () => {
  const f = fixture()
  const oldPage = deferred()
  const port = {
    loadMinePage: (_limit, cursor) => cursor
      ? oldPage.promise
      : Promise.resolve(settledPage('new-range')),
  }
  f.setMine({
    current: [{ id: 'old-range' }],
    history: [{ id: 'old-history' }],
    nextCursor: 'old-cursor',
    loadedMore: true,
  })
  const loadMore = f.listCallback('loadMore', port, {
    visibleState: { ...f.mine },
  })()
  await tick()
  await f.listCallback('refresh', port)()
  assert.deepEqual(f.mine.current.map((item) => item.id), ['new-range'])
  oldPage.resolve({
    current_items: [], history_items: [{ id: 'outdated-history' }], next_cursor: '',
  })
  await loadMore
  assert.equal(f.mine.history.some((item) => item.id === 'outdated-history'), false,
    'old cursor must not append history after a newer current-page refresh')
})

test('Task Center older failures cannot overwrite newest success or publish stale errors', async () => {
  const f = fixture()
  const slow = deferred()
  const firstPort = { loadMinePage: () => slow.promise }
  const lastPort = { loadMinePage: async () => settledPage('latest') }
  const old = f.listCallback('refresh', firstPort)()
  await tick()
  await f.listCallback('refresh', lastPort)()
  slow.reject(new Error('expired first request'))
  await old
  assert.deepEqual(values(f.mine), ['latest'])
  assert.deepEqual(f.events, [],
    'stale failed Task Center request must not report a fresh-scope error')
  assert.equal(f.mineLoading, false)
})

test('Task Center Web/Desktop must supply current identity to shared background lifecycle', () => {
  const web = fs.readFileSync(path.join(root, 'web/src/App.tsx'), 'utf8')
  const desktop = fs.readFileSync(path.join(root, 'desktop/src/renderer/App.tsx'), 'utf8')
  const model = fs.readFileSync(filename, 'utf8')
  for (const app of [web, desktop]) {
    assert.match(app, /backgroundTasksLifecycleKey:/,
      'both platforms must identify current background task owner')
  }
  assert.match(model, /backgroundTasksLifecycleKey/)
})

test('Task Center changing only the error handler must not restart an otherwise idle read', async () => {
  const f = fixture()
  let requests = 0
  const port = {
    loadMinePage: async () => {
      requests += 1
      return settledPage('stable')
    },
  }
  let cached
  const useCallback = (fn, deps) => {
    if (cached && cached.deps.length === deps.length &&
        deps.every((value, index) => Object.is(value, cached.deps[index]))) {
      return cached.fn
    }
    cached = { fn, deps: [...deps] }
    return fn
  }
  let lastEffectCallback
  for (let render = 0; render < 3; render += 1) {
    const onError = (_error) => { throw new Error('unexpected error') }
    f.core.onErrorRef.current = onError
    const next = compileRealCallback('useXDriveBackgroundTasks', 'refresh', {
      ...f.core,
      useCallback,
      port,
      enabled: true,
      visible: true,
      effectiveScope: 'mine',
      onError,
    })
    if (next !== lastEffectCallback) {
      lastEffectCallback = next
      await next()
    }
  }
  assert.equal(requests, 1,
    'new error-handler identity alone must not issue another background task read')
})
