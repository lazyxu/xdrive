'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const file = 'web/src/routedDirectoryAncestors.ts'
const js = ts.transpileModule(read(file), {
  fileName: file, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  },
}).outputText
const moduleOut = { exports: {} }
new Function('exports', 'module', js)(moduleOut.exports, moduleOut)
const resolveAncestors = moduleOut.exports.xDriveResolveRoutedDirectoryAncestors

test('Web Files deep link A -> B aborts actual old Node GET, not the new request', async () => {
  let markStarted
  const started = new Promise(resolve => { markStarted = resolve })
  const calls = [], aborted = []
  const oldController = new AbortController()
  const old = resolveAncestors(71, (id, signal) => {
    calls.push(id)
    assert.equal(signal, oldController.signal)
    return new Promise((_resolve, reject) => {
      const stop = () => {
        aborted.push(id)
        reject(Object.assign(new Error('request aborted'), { name: 'AbortError' }))
      }
      signal.addEventListener('abort', stop, { once: true })
      markStarted()
    })
  }, oldController.signal, () => true)
  await started
  oldController.abort()
  assert.equal(await old, null, 'old route returns no authorized ancestor chain')
  assert.deepEqual(calls, [71], 'old route never starts another ancestor GET')
  assert.deepEqual(aborted, [71], 'actual transport was signalled')
  const newController = new AbortController()
  const newCalls = []
  const nodes = {
    82: { id: 82, name: 'New folder', type: 'dir', parent_id: 1 },
    1: { id: 1, name: 'Root', type: 'dir', parent_id: 0 },
  }
  assert.deepEqual(await resolveAncestors(82, async (id, signal) => {
    assert.equal(signal, newController.signal)
    newCalls.push(id)
    return nodes[id]
  }, newController.signal, () => true), [
    { id: 1, name: 'Root' }, { id: 82, name: 'New folder' },
  ])
  assert.deepEqual(newCalls, [82, 1])
  assert.equal(newController.signal.aborted, false, 'new route is never preempted')
})

test('a non-cooperative old Node response cannot launch another GET or commit after intent switch', async () => {
  let settle
  const calls = []
  let current = true
  const controller = new AbortController()
  const pending = resolveAncestors(64, (id, signal) => {
    calls.push({ id, signal })
    return new Promise(resolve => { settle = resolve })
  }, controller.signal, () => current)
  current = false
  settle({ id: 64, name: 'Old', type: 'dir', parent_id: 1 })
  assert.equal(await pending, null)
  assert.deepEqual(calls.map(x => x.id), [64],
    'intent switch suppresses further stale ancestor GETs')
  assert.equal(controller.signal.aborted, false,
    'stale UI fencing also works if a transport ignores abort')
})

test('a live invalid ancestor remains a real authorization/type error', async () => {
  const controller = new AbortController()
  await assert.rejects(resolveAncestors(8, async () => ({
    id: 8, name: 'Document', type: 'file', parent_id: 1,
  }), controller.signal, () => true), /目标不是文件夹/)
  await assert.rejects(resolveAncestors(8, async () => {
    throw new Error('Owner denied')
  }, controller.signal, () => true), /Owner denied/)
  controller.abort()
  let reads = 0
  assert.equal(await resolveAncestors(8, async () => { reads++; return null },
    controller.signal, () => true), null)
  assert.equal(reads, 0, 'cancel-before-admission performs no HTTP GET')
})

test('actual Web route lookup passes its scoped AbortSignal to XDriveApi.node', () => {
  const component = read('web/src/WebFileExplorer.tsx')
  const api = read('web/src/api.ts')
  assert.match(component, /const ancestorLookup = new AbortController\(\)/)
  assert.match(component, /xDriveResolveRoutedDirectoryAncestors\(\s*initialDirectoryID,/)
  assert.match(component, /\(id, signal\) => api\.node\(id, signal\)/)
  assert.match(component, /ancestorLookup\.abort\(\)/,
    'URL change / unmount actively aborts the previous metadata GET')
  assert.match(component, /!ancestorLookup\.signal\.aborted/,
    'aborted metadata reads must not render a user-facing error')
  assert.match(api, /node\(id: number, signal\?: AbortSignal\) \{\s*return this\.request<Node>\([\s\S]*?\{ signal \}\)/)
  assert.doesNotMatch(component.slice(
    component.indexOf('const ancestorLookup = new AbortController()'),
    component.indexOf('const ancestorLookup = new AbortController()') + 1200,
  ), /cancelTransfer|cancelBackup|cancelUpload|cancelDownload/,
  'this scope cannot cancel durable transfers')
})
