const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function extractTransferCallbacks() {
  const filename = path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx')
  const source = fs.readFileSync(filename, 'utf8')
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )

  let snapshotCallback = null
  let eventCallback = null

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sourceFile)
      if (
        callee === 'window.xdriveDesktop.agent.getTransfers().then' &&
        node.arguments.length > 0
      ) {
        snapshotCallback = node.arguments[0].getText(sourceFile)
      }
      if (
        callee === 'window.xdriveDesktop.agent.onTransfers' &&
        node.arguments.length > 0
      ) {
        eventCallback = node.arguments[0].getText(sourceFile)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  assert.ok(snapshotCallback, 'missing initial Agent transfer snapshot callback')
  assert.ok(eventCallback, 'missing Agent transfer event callback')
  return { filename, snapshotCallback, eventCallback }
}


function extractTransferSnapshotAcceptor() {
  const filename = path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx')
  const source = fs.readFileSync(filename, 'utf8')
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )

  let initializer = null
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'acceptTransferSnapshot' &&
      node.initializer
    ) {
      initializer = node.initializer.getText(sourceFile)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  assert.ok(initializer, 'missing transfer snapshot acceptor')
  return { filename, initializer }
}

function compileCallback(filename, callbackText, dependencies) {
  const output = ts.transpileModule(
    'const callback = ' + callbackText + ';',
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
  const values = names.map((name) => dependencies[name])
  return new Function(...names, output + '\nreturn callback')(...values)
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

test('Desktop transfer bootstrap snapshot cannot overwrite a newer transfer event revision', () => {
  const { filename, snapshotCallback, eventCallback } = extractTransferCallbacks()
  const acceptorSource = extractTransferSnapshotAcceptor()
  let current = snapshot(0, 'initial')

  const setTransfers = (next) => {
    current = typeof next === 'function' ? next(current) : next
  }
  const transfersRevisionRef = { current: 0 }
  const acceptTransferSnapshot = compileCallback(
    acceptorSource.filename,
    acceptorSource.initializer,
    {
      useCallback: (callback) => callback,
      setTransfers,
      transfersRevisionRef,
    },
  )
  const dependencies = {
    active: true,
    setTransfers,
    transfersRevisionRef,
    acceptTransferSnapshot,
  }

  const applySnapshot = compileCallback(filename, snapshotCallback, dependencies)
  const applyEvent = compileCallback(filename, eventCallback, dependencies)

  applyEvent(snapshot(11, 'new-event'))
  applySnapshot(snapshot(10, 'old-bootstrap'))

  assert.equal(
    current.revision,
    11,
    'a late bootstrap snapshot must not regress the transfer revision after a newer event',
  )
  assert.equal(
    current.transfers[0]?.id,
    'new-event',
    'FileExplorer hydration progress must retain the newest transfer event payload',
  )
})


test('Desktop live transfer events remain authoritative when Agent revision restarts', () => {
  const { filename, eventCallback } = extractTransferCallbacks()
  let current = snapshot(100, 'old-agent')
  const transfersRevisionRef = { current: 100 }
  const setTransfers = (next) => {
    current = typeof next === 'function' ? next(current) : next
  }
  const applyEvent = compileCallback(filename, eventCallback, {
    active: true,
    setTransfers,
    transfersRevisionRef,
  })

  applyEvent(snapshot(1, 'restarted-agent'))

  assert.equal(current.revision, 1)
  assert.equal(current.transfers[0]?.id, 'restarted-agent')
  assert.equal(transfersRevisionRef.current, 1)
})
