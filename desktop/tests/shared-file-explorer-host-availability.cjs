'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const modulePath = 'ui/shared/src/file-explorer-host-availability.ts'
const source = fs.readFileSync(path.join(root, modulePath), 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: modulePath, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((compiled.diagnostics || [])
  .filter(x => x.category === ts.DiagnosticCategory.Error)
  .map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [])
const mod = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  mod, mod.exports, name => { throw Error('Unexpected Host dependency: ' + name) })
const { xDriveReadFileExplorerHostAvailability: read, XDRIVE_FILE_EXPLORER_HOST_AVAILABILITY_BATCH_LIMIT: limit } = mod.exports
const entry = (path, status = 'ready') => ({ path, availability: { status } })

test('deduplicates paths, caps each Agent request at 2048, and maps to exact Node IDs', async () => {
  const requests = Array.from({ length: limit + 2 }, (_, i) => ({ nodeID: i + 1, path: 'file/' + i }))
  requests.push({ nodeID: 5000, path: 'file/0' })
  const batchSizes = []
  const value = await read({
    requests, isCurrent: () => true,
    readBatch: async paths => {
      batchSizes.push(paths.length)
      return { ok: true, data: { items: paths.map(p => entry(p)) } }
    },
  })
  assert.deepEqual(batchSizes, [limit, 2])
  assert.equal(value.kind, 'complete')
  assert.equal(value.byID.size, limit + 3)
  assert.strictEqual(value.byID.get(1).state, value.byID.get(5000).state)
  assert.equal(value.byID.get(limit + 2).path, 'file/' + (limit + 1))
})

test('late prior-Owner reply is discarded without starting another batch', async () => {
  let current = true
  let resolve
  const requests = Array.from({ length: limit + 1 }, (_, i) => ({ nodeID: i + 1, path: 'path/' + i }))
  let calls = 0
  const pending = read({
    requests, isCurrent: () => current,
    readBatch: () => { calls += 1; return new Promise(done => { resolve = done }) },
  })
  current = false
  resolve({ ok: true, data: { items: [entry('path/0', 'prior')] } })
  assert.equal(await pending, null)
  assert.equal(calls, 1)
})

test('failed and thrown Host reads do not reuse stale badges or leak raw paths', async () => {
  const requests = [{ nodeID: 1, path: '/private/root' }]
  const error = await read({ requests, isCurrent: () => true,
    readBatch: async () => ({ ok: false, error: { code: 'unsupported_capability', message: '/private/root' } }),
  })
  assert.deepEqual(error, { kind: 'error', code: 'unsupported_capability' })
  const rejected = await read({ requests, isCurrent: () => true,
    readBatch: async () => { throw Error('private credential token /private/root') },
  })
  assert.deepEqual(rejected, { kind: 'error' })
  const empty = await read({ requests, isCurrent: () => true,
    readBatch: async () => ({ ok: true, data: { items: [] } }),
  })
  assert.equal(empty.kind, 'complete')
  assert.equal(empty.byID.size, 0, 'unknown must remain unknown, not healthy')
})

test('malformed projected IDs and irrelevant or absent Host rows never become a badge', async () => {
  const value = await read({
    requests: [
      { nodeID: 0, path: 'bad' }, { nodeID: '2', path: 'string' },
      { nodeID: Number.MAX_SAFE_INTEGER + 1, path: 'overflow' },
      { nodeID: 1, path: 'known' }, { nodeID: 2, path: 'known' },
      { nodeID: 3, path: 'unknown' },
    ],
    isCurrent: () => true,
    readBatch: async paths => {
      assert.deepEqual(paths, ['known', 'unknown'])
      return { ok: true, data: { items: [entry('unrequested'), entry('known', 'verified')] } }
    },
  })
  assert.equal(value.kind, 'complete')
  assert.deepEqual([...value.byID.keys()], [1, 2])
  assert.equal(value.byID.get(1).state.status, 'verified')
  assert.equal(value.byID.get(3), undefined)
})

test('Desktop delegates disposable reads while preserving existing user-facing failure semantics', () => {
  const desktop = fs.readFileSync(path.join(root, 'desktop/src/renderer/DesktopFileExplorer.tsx'), 'utf8')
  const exported = fs.readFileSync(path.join(root, 'ui/shared/src/index.ts'), 'utf8')
  assert.match(exported, /export \* from '\.\/file-explorer-host-availability'/)
  assert.match(desktop, /xDriveReadFileExplorerHostAvailability<AgentFileAvailability>/)
  assert.match(desktop, /readBatch: paths => hostPort\.browse\.getFileAvailabilityBatch\(paths\)/)
  assert.match(desktop, /if \(!isCurrent\(\) \|\| !outcome\) return/)
  assert.match(desktop, /rejectProbe\(outcome\.code\)/)
  assert.match(desktop, /setAvailabilityByID\(outcome\.byID\)/)
  assert.match(desktop, /setAvailabilityByID\(new Map\(\)\)/)
  assert.doesNotMatch(source, /window\.xdriveDesktop|backup\.cgi|fetch\s*\(|cancelTransfer|cancelUpload|cancelBackup/)
})
