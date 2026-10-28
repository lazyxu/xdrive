'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const transpile = (file, src) => ts.transpileModule(src, {
  fileName: file,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
function load(file) {
  const out = { exports: {} }
  new Function('exports', 'module', transpile(file, read(file)))(out.exports, out)
  return out.exports
}
const createReadScope = load('ui/shared/src/mui/FileExplorerDisposableNavigationReads.ts')
  .xDriveCreateFileExplorerDisposableNavigationReads
const resolveAncestors = load('web/src/routedDirectoryAncestors.ts')
  .xDriveResolveRoutedDirectoryAncestors

function savedRestoreFactory() {
  const file = 'web/src/WebFileExplorer.tsx'
  const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let callback = null
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'restoreMobileDirectory' &&
        node.initializer && ts.isCallExpression(node.initializer)) {
      callback = node.initializer.arguments[0].getText(ast)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(callback, 'extract actual Web Files saved-folder restoration, not a mock')
  return deps => new Function(...Object.keys(deps),
    transpile(file, 'const savedRestore = ' + callback + ';') + '\nreturn savedRestore;',
  )(...Object.values(deps))
}
const savedRestore = savedRestoreFactory()
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function fixture() {
  const reads = createReadScope()
  let generation = 0
  const savedResumeRouteGuardRef = { current: { folderID: 71, pending: true } }
  const pending = deferred(), calls = [], commits = []
  const durable = ['upload', 'download', 'backup', 'sync'].map(() => new AbortController())
  const beginNavigationIntent = () => { reads.cancel(); return ++generation }
  const isNavigationIntentCurrent = id => id === generation
  const navigationReadSignalForIntent = id => isNavigationIntentCurrent(id) ? reads.signalFor(id) : null
  const api = { node: (id, signal) => {
    calls.push({ id, signal })
    if (id === 71) return pending.promise
    return Promise.resolve({ id, type: 'dir', parent_id: id === 82 ? 1 : 0, name: 'Node ' + id })
  }}
  const navigateTo = async (crumbs, _record, requestID, receipt) => {
    if (!isNavigationIntentCurrent(requestID)) { receipt?.(false); return }
    commits.push(crumbs)
    receipt?.(true)
  }
  const restore = savedRestore({
    savedResumeRouteGuardRef, api, beginNavigationIntent, isNavigationIntentCurrent,
    navigationReadSignalForIntent, xDriveResolveRoutedDirectoryAncestors: resolveAncestors, navigateTo,
  })
  return { reads, restore, pending, calls, commits, durable,
    savedResumeRouteGuardRef, beginNavigationIntent, navigationReadSignalForIntent }
}
test('same-type Files A -> B aborts old saved-folder GET immediately and B can proceed', async () => {
  const f = fixture()
  const old = f.restore(71)
  assert.equal(f.calls.length, 1)
  const oldSignal = f.calls[0].signal
  const next = f.beginNavigationIntent()
  assert.equal(oldSignal.aborted, true, 'transport is aborted at new intent, not after old reply')
  const nextSignal = f.navigationReadSignalForIntent(next)
  assert.equal(nextSignal.aborted, false)
  f.pending.resolve({ id: 71, type: 'dir', parent_id: 82, name: 'Stale A' })
  assert.equal(await old, false)
  assert.deepEqual(f.calls.map(x => x.id), [71], 'stale uncooperative GET cannot fetch parent')
  assert.deepEqual(f.commits, [], 'stale directory never commits')
  assert.equal(f.savedResumeRouteGuardRef.current.pending, false)
  for (const controller of f.durable) assert.equal(controller.signal.aborted, false)
})
test('mobile saved folder restore follows actual ancestors and awaits counted first-page acceptance', async () => {
  const f = fixture()
  const task = f.restore(71)
  f.pending.resolve({ id: 71, type: 'dir', parent_id: 82, name: 'Saved' })
  assert.equal(await task, true)
  assert.deepEqual(f.calls.map(x => x.id), [71, 82, 1])
  assert.deepEqual(f.commits, [[
    { id: 1, name: 'Node 1' }, { id: 82, name: 'Node 82' }, { id: 71, name: 'Saved' },
  ]])
  assert.equal(f.savedResumeRouteGuardRef.current.pending, false)
})
test('denied first counted Range cannot turn a resolved saved folder into a success', async () => {
  const f = fixture()
  const restore = savedRestore({
    savedResumeRouteGuardRef: f.savedResumeRouteGuardRef,
    api: { node: async id => ({ id, type: 'dir', name: 'Only metadata', parent_id: 0 }) },
    beginNavigationIntent: f.beginNavigationIntent,
    isNavigationIntentCurrent: () => true,
    navigationReadSignalForIntent: f.navigationReadSignalForIntent,
    xDriveResolveRoutedDirectoryAncestors: resolveAncestors,
    navigateTo: async (_crumbs, _record, _requestID, receipt) => receipt(false),
  })
  assert.equal(await restore(71), false)
  assert.equal(f.savedResumeRouteGuardRef.current.pending, false)
})
test('same numeric folder after Owner switch remains a separate pending scope', async () => {
  const f = fixture()
  const oldGuard = f.savedResumeRouteGuardRef.current
  const old = f.restore(71)
  f.beginNavigationIntent()
  const newGuard = { folderID: 71, pending: true }
  f.savedResumeRouteGuardRef.current = newGuard
  f.pending.reject(Object.assign(new Error('stale Owner GET'), { name: 'AbortError' }))
  assert.equal(await old, false)
  assert.equal(oldGuard.pending, false)
  assert.equal(newGuard.pending, true, 'old task must not release new account guard')
})
test('one mounted scope never cancels another tab and stale tokens never resume', () => {
  const a = createReadScope(), tabB = createReadScope()
  const old = a.signalFor(1), same = a.signalFor(1), other = tabB.signalFor(1)
  assert.equal(old, same)
  a.cancel(); a.cancel()
  assert.equal(old.aborted, true)
  assert.equal(other.aborted, false)
  const latest = a.signalFor(2)
  assert.equal(latest.aborted, false)
  a.signalFor(3)
  assert.equal(latest.aborted, true)
  assert.equal(other.aborted, false)
})
test('production navigation, Owner rotation and StrictMode cleanup wire disposal only to Node reads', () => {
  const nav = read('ui/shared/src/mui/FileExplorerNavigation.ts')
  const web = read('web/src/WebFileExplorer.tsx')
  assert.match(nav, /const beginNavigation = [\s\S]*?disposableNavigationReads\.cancel\(\)[\s\S]*?const request =/)
  assert.match(nav, /navigationSessionStorageKeyRef\.current !== navigationSessionStorageKey[\s\S]*?disposableNavigationReads\.cancel\(\)/)
  assert.match(nav, /return \(\) => \{\s*disposableNavigationReads\.cancel\(\)/)
  assert.match(nav, /navigationReadSignalForIntent,\s*navigateTo,/)
  assert.match(web, /const restoreMobileDirectory = useCallback[\s\S]*?navigationReadSignalForIntent\(navigationIntentID\)/)
  assert.match(web, /xDriveResolveRoutedDirectoryAncestors\(\s*directoryID,[\s\S]*?\(id, signal\) => api\.node\(id, signal\)/)
  assert.match(web, /navigationSignal\.addEventListener\('abort', abortForNewNavigation/)
  assert.doesNotMatch(read('ui/shared/src/mui/FileExplorerDisposableNavigationReads.ts'),
    /cancelTransfer|cancelBackup|cancelUpload|cancelDownload|terminateWorker/)
})
