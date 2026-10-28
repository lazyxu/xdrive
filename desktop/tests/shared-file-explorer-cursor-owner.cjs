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
const { useXDriveFileExplorerCursorDirectory } = loadHook(
  'ui/shared/src/mui/FileExplorerCursorDirectoryController.ts',
  { './FileExplorerOwnerFence': fence, './FileExplorerDirectoryReadStrategy': readStrategy },
)
const tick = async () => {
  await Promise.resolve()
  await Promise.resolve()
}
const node = (id, name, parent = 10) => ({ id, name, parent_id: parent, type: 'file', size: 1 })
async function mount() {
  const host = {}, requests = [], roots = []
  const port = {
    readRoot(signal) {
      roots.push(signal)
      return Promise.resolve({ id: 10, name: 'Owner' })
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
  assert.equal(requests.length, 1, 'verified Owner root must trigger exactly one first-page read')
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
