'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
function loadHook(file, replacements = {}) {
  const source = ts.transpileModule(read(file), {
    fileName: file, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const moduleRef = { exports: {} }
  const inject = name => replacements[name] || require(name)
  new Function('exports', 'module', 'require', source)(moduleRef.exports, moduleRef, inject)
  return moduleRef.exports
}
const fence = loadHook('ui/shared/src/mui/FileExplorerOwnerFence.ts')
const readStrategy = loadHook('ui/shared/src/mui/FileExplorerDirectoryReadStrategy.ts')
const { useXDriveFileExplorerCursorDirectory, xDriveFileExplorerAdmitOwnerRoot } = loadHook(
  'ui/shared/src/mui/FileExplorerCursorDirectoryController.ts',
  { './FileExplorerOwnerFence': fence, './FileExplorerDirectoryReadStrategy': readStrategy },
)
const tick = async () => {
  await Promise.resolve()
  await Promise.resolve()
}
const node = (id, name, parent = 10) => ({ id, name, parent_id: parent, type: 'file', size: 1 })
async function mount(rootValue = { id: 10, name: 'Owner' }, expectedPages = 1) {
  const host = {}, requests = [], roots = []
  const port = {
    readRoot(signal) {
      roots.push(signal)
      return Promise.resolve(typeof rootValue === 'function' ? rootValue() : rootValue)
    },
    readPage(parent, limit, sort, cursor, signal) {
      return new Promise((resolve, reject) => requests.push({
        parent, limit, sort, cursor, signal, resolve, reject,
      }))
    },
  }
  let state, renderer
  function Harness({ activeHost, activePort }) {
    state = useXDriveFileExplorerCursorDirectory({
      host: activeHost, port: activePort, initialSort: { key: 'name', direction: 'asc' },
      scopeKeyFor: (crumbs, key, direction) =>
        crumbs.map(item => item.id).join('/') + ':' + key + ':' + direction,
      limit: 2,
    })
    return null
  }
  async function render(activeHost = host, activePort = port) {
    await Renderer.act(async () => {
      const elem = React.createElement(Harness, { activeHost, activePort })
      if (renderer) renderer.update(elem)
      else renderer = Renderer.create(elem)
      await tick()
    })
  }
  await render()
  assert.equal(requests.length, expectedPages,
    'only a verified Owner root can trigger its first-page cursor read')
  return {
    host, port, requests, roots, get state() { return state }, render,
    async resolve(index, value) {
      await Renderer.act(async () => { requests[index].resolve(value); await tick() })
    },
    async call(fn) { await Renderer.act(async () => { fn(state); await tick() }) },
    async unmount() { await Renderer.act(async () => renderer.unmount()) },
  }
}

test('a later folder wins over an unresolved prior cursor page, even if IDs overlap', async () => {
  const app = await mount()
  await app.resolve(0, { items: [node(1, 'first')], has_more: true, next_cursor: 'A' })
  assert.equal(app.state.currentScopeVerified, true)
  assert.deepEqual(app.state.items.map(item => item.id), [1])
  await app.call(s => s.loadMore())
  assert.equal(app.requests[1].cursor, 'A')
  await app.call(s => s.setCrumbs([{ id: 10, name: 'Owner' }, { id: 99, name: 'Next' }]))
  assert.equal(app.requests[1].signal.aborted, true, 'old cursor page must yield on navigation')
  assert.equal(app.state.currentScopeVerified, false, 'old Owner rows cannot be displayed under new folder scope')
  await app.resolve(1, { items: [node(1, 'obsolete')], has_more: false })
  assert.equal(app.state.currentScopeVerified, false)
  const newest = app.requests.findIndex((r, i) => i > 1 && r.parent === 99)
  assert.ok(newest >= 2)
  await app.resolve(newest, { items: [node(1, 'new Owner ID', 99)], has_more: false })
  assert.deepEqual(app.state.items.map(item => item.name), ['new Owner ID'])
  assert.equal(app.state.currentScopeVerified, true)
  await app.unmount()
})

test('cursor page duplicates do not overwrite or advance previously verified items', async () => {
  const app = await mount()
  await app.resolve(0, { items: [node(2, 'verified')], has_more: true, next_cursor: 'next' })
  await app.call(s => s.loadMore())
  await app.resolve(1, { items: [node(2, 'duplicated')], has_more: false })
  assert.deepEqual(app.state.items.map(item => item.name), ['verified'])
  assert.match(app.state.error, /重复文件/)
  assert.equal(app.state.nextCursor, 'next')
  await app.unmount()
})

test('refresh and Host replacement revoke the old scope and abort the pending request', async () => {
  const app = await mount()
  await app.resolve(0, { items: [node(3, 'verified')], has_more: true, next_cursor: 'more' })
  const staleOwner = app.state.isCurrentOwner
  await app.call(s => s.loadMore())
  await app.call(s => s.refreshAuthenticatedRoot())
  assert.equal(staleOwner(), false)
  assert.equal(app.requests[1].signal.aborted, true)
  assert.equal(app.state.currentScopeVerified, false)
  const newer = app.requests.findIndex((request, index) => index > 1 && request.cursor === '')
  assert.ok(newer >= 2, 'refresh must re-read first page from newly authorized root')
  await app.resolve(newer, { items: [node(4, 'fresh')], has_more: false })
  assert.equal(app.state.currentScopeVerified, true)
  const oldOwner = app.state.isCurrentOwner
  const nextHost = {}
  const nextPort = { ...app.port }
  await app.render(nextHost, nextPort)
  assert.equal(oldOwner(), false)
  assert.equal(app.state.currentScopeVerified, false)
  await app.unmount()
})

test('authenticated Owner root admission preserves valid Host identity and rejects malformed roots', () => {
  const root = { id: 7, name: '我的文件', revision: 12 }
  assert.strictEqual(xDriveFileExplorerAdmitOwnerRoot(root), root,
    'the shared UI must never fabricate a different Owner root object')
  for (const invalid of [
    null, undefined, [], '', 2,
    {}, { id: 0, name: 'Owner' }, { id: -1, name: 'Owner' },
    { id: '7', name: 'Owner' }, { id: 1.5, name: 'Owner' },
    { id: Number.MAX_SAFE_INTEGER + 1, name: 'Owner' },
    { id: 7, name: '' }, { id: 7, name: '   ' },
    { id: 7, name: 7 }, { id: 7, name: 'a\nb' },
    { id: 7, name: 'a'.repeat(513) },
  ]) {
    assert.throws(() => xDriveFileExplorerAdmitOwnerRoot(invalid),
      /Invalid authenticated Owner Files root/, JSON.stringify(invalid))
  }
})

test('malformed Owner root never invokes a cursor read or publishes stale files', async () => {
  let currentRoot = { id: 0, name: 'unverified root' }
  const app = await mount(() => currentRoot, 0)
  assert.equal(app.requests.length, 0)
  assert.deepEqual(app.state.crumbs, [])
  assert.deepEqual(app.state.items, [])
  assert.equal(app.state.currentScopeVerified, false)
  assert.match(app.state.rootError, /无法通过 Agent 当前 xDrive Server 账号/)
  currentRoot = { id: 10, name: 'Owner' }
  await app.call(state => state.refreshAuthenticatedRoot())
  assert.equal(app.requests.length, 1, 'reverification must use the real Host root first')
  assert.equal(app.requests[0].parent, 10)
  await app.resolve(0, { items: [node(5, 'authorized')], has_more: false })
  assert.equal(app.state.currentScopeVerified, true)
  assert.deepEqual(app.state.items.map(item => item.name), ['authorized'])
  await app.unmount()
})


test('a non-adjacent cursor cycle keeps verified rows and never promotes the replay', async () => {
  const app = await mount()
  await app.resolve(0, { items: [node(21, 'first')], has_more: true, next_cursor: 'A' })
  await app.call(s => s.loadMore())
  assert.equal(app.requests[1].cursor, 'A')
  await app.resolve(1, { items: [node(22, 'second')], has_more: true, next_cursor: 'B' })
  await app.call(s => s.loadMore())
  assert.equal(app.requests[2].cursor, 'B')
  // The next token differs from the immediately requested cursor, but it
  // replays a token previously issued for this same directory.
  await app.resolve(2, { items: [node(23, 'unverified')], has_more: true, next_cursor: 'A' })
  assert.deepEqual(app.state.items.map(item => item.id), [21, 22])
  assert.equal(app.state.currentScopeVerified, true, 'previously proven rows remain visible')
  assert.equal(app.state.nextCursor, 'B', 'replayed cursor must never advance the page')
  assert.match(app.state.error, /重复分页游标/)
  // A retry may recover when the real Host returns a valid next page.
  await app.call(s => s.loadMore())
  assert.equal(app.requests[3].cursor, 'B')
  await app.resolve(3, { items: [node(23, 'recovered')], has_more: false })
  assert.deepEqual(app.state.items.map(item => item.id), [21, 22, 23])
  assert.equal(app.state.hasMore, false)
  await app.unmount()
})

test('same signed cursor token is valid again in a different verified directory', async () => {
  const app = await mount()
  await app.resolve(0, { items: [node(31, 'old')], has_more: true, next_cursor: 'A' })
  await app.call(s => s.setCrumbs([{ id: 10, name: 'Owner' }, { id: 99, name: 'Other' }]))
  const index = app.requests.findIndex(r => r.parent === 99 && r.cursor === '')
  assert.ok(index >= 1)
  await app.resolve(index, {
    items: [node(41, 'new-folder', 99)], has_more: true, next_cursor: 'A',
  })
  assert.equal(app.state.currentScopeVerified, true)
  assert.equal(app.state.error, '')
  await app.call(s => s.loadMore())
  const next = app.requests.findIndex((r, i) => i > index && r.parent === 99 && r.cursor === 'A')
  assert.ok(next > index)
  await app.resolve(next, { items: [node(42, 'next', 99)], has_more: false })
  assert.deepEqual(app.state.items.map(item => item.id), [41, 42])
  await app.unmount()
})
