const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = process.env.XDRIVE_REPO_ROOT || path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'ui/shared/src/mui/TaskWakeRefresh.ts'), 'utf8')
const js = ts.transpileModule(source, {
  fileName: 'TaskWakeRefresh.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = { exports: {} }
new Function('module', 'exports', js)(mod, mod.exports)
const bind = mod.exports.xDriveBindTaskWakeRefresh

class Emitter {
  constructor() { this.handlers = new Map() }
  addEventListener(name, fn) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set())
    this.handlers.get(name).add(fn)
  }
  removeEventListener(name, fn) { this.handlers.get(name)?.delete(fn) }
  emit(name) { for (const fn of this.handlers.get(name) || []) fn({ type: name }) }
  listeners(name) { return this.handlers.get(name)?.size ?? 0 }
}
function fixture() {
  const win = new Emitter(), doc = new Emitter()
  doc.visibilityState = 'visible'
  let now = 10000
  return { win, doc, now: () => now, setTime: value => { now = value } }
}

test('S4D1: hidden and consecutive pageshow/focus/online are coalesced into one read-only refresh', () => {
  const f = fixture(), received = []
  const stop = bind(() => received.push(f.now()), { win: f.win, doc: f.doc, now: f.now })
  assert.deepEqual(received, [], 'mount does not trigger redundant server reads')
  f.doc.visibilityState = 'hidden'
  f.win.emit('pageshow'); f.win.emit('online'); f.doc.emit('visibilitychange')
  assert.deepEqual(received, [], 'hidden app must not retry while suspended')
  f.doc.visibilityState = 'visible'
  f.doc.emit('visibilitychange')
  f.win.emit('focus'); f.win.emit('pageshow'); f.win.emit('online')
  assert.deepEqual(received, [10000], 'one wake must not multiply requests')
  f.setTime(11500)
  f.win.emit('online')
  assert.deepEqual(received, [10000, 11500], 'later wake requests a fresh Server snapshot')
  stop()
  f.setTime(15000); f.win.emit('focus'); f.doc.emit('visibilitychange')
  assert.deepEqual(received, [10000, 11500], 'unmounted/account-switched hook never refreshes')
  assert.equal(f.win.listeners('focus'), 0)
  assert.equal(f.doc.listeners('visibilitychange'), 0)
})

test('S4D1: clock rollback and invalid clocks fail closed without silencing later wakes', () => {
  const f = fixture(), calls = []
  const stop = bind(() => calls.push(f.now()), { win: f.win, doc: f.doc, now: f.now })
  f.win.emit('focus')
  f.setTime(NaN); f.win.emit('focus')
  f.setTime(9000); f.win.emit('pageshow')
  assert.deepEqual(calls, [10000, 9000])
  stop()
})

test('S4D1: missing browser objects cannot register or execute background work', () => {
  let called = false
  const stop = bind(() => { called = true }, { win: null, doc: null })
  assert.equal(typeof stop, 'function')
  stop()
  assert.equal(called, false)
})

test('S4D1: shared Web/Desktop/Mobile lifecycle delegates only to existing scoped GET controllers', () => {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8')
  const tasks = read('ui/shared/src/mui/TaskCenterController.ts')
  const operations = read('ui/shared/src/mui/FileOperationLifecycle.ts')
  const web = read('web/src/App.tsx')
  const desktop = read('desktop/src/renderer/App.tsx')
  assert.equal((tasks.match(/xDriveBindTaskWakeRefresh\(/g) || []).length, 2)
  assert.equal((operations.match(/xDriveBindTaskWakeRefresh\(/g) || []).length, 1)
  assert.ok(tasks.includes('if (!enabled || !port?.loadActiveSummary) return'))
  assert.ok(tasks.includes('if (!enabled || !visible || !port) return'))
  assert.ok(operations.includes('if (!enabled) return'))
  assert.ok(operations.includes('void refreshOperations()'))
  assert.ok(tasks.includes('void refresh()'))
  for (const app of [web, desktop]) {
    assert.ok(app.includes('useXDriveTaskCenterController({'))
    assert.ok(app.includes('useXDriveFileOperationLifecycle'))
  }
  assert.equal(source.includes('pagehide'), false, 'page lifecycle must not cancel durable tasks')
  assert.equal(source.includes('skipWaiting'), false, 'wake cannot force Service Worker activation')
  for (const file of [
    'desktop/tests/file-explorer-action-feedback-ordering.cjs',
    'desktop/tests/file-explorer-selection-actions.cjs',
    'desktop/tests/task-transfer-navigation.cjs',
  ]) {
    assert.ok(read(file).includes("'./TaskWakeRefresh'"), 'isolated fixture must load the new helper: ' + file)
  }
  assert.equal(source.includes('fetch('), false, 'helper cannot bypass authenticated Server adapter')
})
