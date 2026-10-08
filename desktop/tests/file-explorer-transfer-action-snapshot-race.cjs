const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function sourceFile() {
  const filename = path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx')
  const source = fs.readFileSync(filename, 'utf8')
  return {
    filename,
    sourceFile: ts.createSourceFile(
      filename,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
  }
}

function extractArrowFunction(name) {
  const { filename, sourceFile: file } = sourceFile()
  let initializer = null
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      initializer = node.initializer.getText(file)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(initializer, 'missing App function: ' + name)
  return { filename, initializer }
}

function extractTransferEventCallback() {
  const { filename, sourceFile: file } = sourceFile()
  let callback = null
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(file) === 'window.xdriveDesktop.agent.onTransfers' &&
      node.arguments.length > 0
    ) {
      callback = node.arguments[0].getText(file)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(callback, 'missing transfer event callback')
  return { filename, callback }
}

function compileExpression(filename, name, expression, dependencies) {
  const output = ts.transpileModule(
    'const ' + name + ' = ' + expression + ';',
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: filename,
    },
  ).outputText
  const names = Object.keys(dependencies)
  const values = names.map((key) => dependencies[key])
  return new Function(...names, output + '\nreturn ' + name)(...values)
}


function extractTransferSnapshotAcceptor() {
  return extractArrowFunction('acceptTransferSnapshot')
}

function extractTransferHistoryClearedCallback() {
  const { filename, sourceFile: file } = sourceFile()
  let initializer = null
  const visit = (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(file) === 'onTransferHistoryCleared'
    ) {
      initializer = node.initializer.getText(file)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(initializer, 'missing transfer-history cleared callback')
  return { filename, initializer }
}

function snapshot(revision, id) {
  return {
    revision,
    transfers: [{
      id,
      root_id: id,
      scope: 'item',
      file_name: id + '.bin',
      kind: 'hydration',
      direction: 'download',
      state: 'running',
      bytes_done: revision,
      bytes_total: 20,
      percent: revision * 5,
      instant_bytes_per_second: 0,
      average_bytes_per_second: 0,
      elapsed_ms: 0,
      retry_count: 0,
      retryable: false,
      started_at: '2026-10-08T00:00:00Z',
      updated_at: '2026-10-08T00:00:00Z',
    }],
  }
}

function deferred() {
  let resolve
  const promise = new Promise((next) => { resolve = next })
  return { promise, resolve }
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
}

test('Desktop retryTransfer result cannot overwrite a newer live transfer revision', async () => {
  const retrySource = extractArrowFunction('retryTransfer')
  const acceptorSource = extractTransferSnapshotAcceptor()
  const eventSource = extractTransferEventCallback()

  let current = snapshot(9, 'initial')
  const transfersRevisionRef = { current: 9 }
  const setTransfers = (next) => {
    current = typeof next === 'function' ? next(current) : next
  }

  const pendingRetry = deferred()
  const run = async () => pendingRetry.promise
  const window = {
    xdriveDesktop: {
      agent: {
        retryTransfer: async () => {
          throw new Error('retryTransfer should be owned by the run stub')
        },
      },
    },
  }

  const acceptTransferSnapshot = compileExpression(
    acceptorSource.filename,
    'acceptTransferSnapshot',
    acceptorSource.initializer,
    { useCallback: (callback) => callback, setTransfers, transfersRevisionRef },
  )
  const retryTransfer = compileExpression(
    retrySource.filename,
    'retryTransfer',
    retrySource.initializer,
    { run, window, setTransfers, acceptTransferSnapshot },
  )
  const applyEvent = compileExpression(
    eventSource.filename,
    'eventCallback',
    eventSource.callback,
    { active: true, setTransfers, transfersRevisionRef },
  )

  const pending = retryTransfer('transfer-1')
  await flushAsync()

  applyEvent(snapshot(11, 'new-live-event'))
  pendingRetry.resolve(snapshot(10, 'old-retry-result'))
  await pending

  assert.equal(
    current.revision,
    11,
    'a retry response generated before a newer event must not regress renderer transfer state',
  )
  assert.equal(
    current.transfers[0]?.id,
    'new-live-event',
    'FileExplorer hydration progress must retain the newer live transfer payload',
  )
})


test('Desktop clear-transfer-history snapshot cannot overwrite a newer live transfer revision', () => {
  const acceptorSource = extractTransferSnapshotAcceptor()
  const historySource = extractTransferHistoryClearedCallback()
  const eventSource = extractTransferEventCallback()

  let current = snapshot(20, 'initial')
  const transfersRevisionRef = { current: 20 }
  const setTransfers = (next) => {
    current = typeof next === 'function' ? next(current) : next
  }
  const acceptTransferSnapshot = compileExpression(
    acceptorSource.filename,
    'acceptTransferSnapshot',
    acceptorSource.initializer,
    { useCallback: (callback) => callback, setTransfers, transfersRevisionRef },
  )
  const onTransferHistoryCleared = compileExpression(
    historySource.filename,
    'onTransferHistoryCleared',
    historySource.initializer,
    { setTransfers, acceptTransferSnapshot },
  )
  const applyEvent = compileExpression(
    eventSource.filename,
    'eventCallback',
    eventSource.callback,
    { active: true, setTransfers, transfersRevisionRef },
  )

  applyEvent(snapshot(22, 'new-live-event'))
  onTransferHistoryCleared(snapshot(21, 'old-clear-result'))

  assert.equal(current.revision, 22)
  assert.equal(current.transfers[0]?.id, 'new-live-event')
})
