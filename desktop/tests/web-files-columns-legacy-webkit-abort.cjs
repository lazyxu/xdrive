'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const file = 'web/src/WebFileExplorer.tsx'
const source = fs.readFileSync(path.join(root, file), 'utf8')
const helperName = 'xDriveAssertWebFileColumnReadActive'
const helperStart = source.indexOf('function ' + helperName + '(')
const helperEnd = source.indexOf('\n}\n', helperStart) + 2
const listStart = source.indexOf('    list: async (parentID, cursor, signal) => {', helperEnd)
const listEnd = source.indexOf('\n    },\n  }), [api, explorerCrumbs[0]?.id]', listStart)
assert.ok(helperStart >= 0 && helperEnd > helperStart &&
  listStart > helperEnd && listEnd > listStart,
  'the real Web Columns Owner read adapter and its cancellation guard must exist')

// Execute the actual production list callback, not an independently rewritten
// test implementation. Its real HTTP/Owner transport is a controlled fake.
const code = source.slice(helperStart, helperEnd) +
  '\nconst adapter = {\n' + source.slice(listStart, listEnd + 7) +
  '\n}\nexport const list = adapter.list\n'
const output = ts.transpileModule(code, {
  fileName: 'WebFilesColumnsRealReadAdapter.ts',
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((output.diagnostics || [])
  .filter(d => d.category === ts.DiagnosticCategory.Error)
  .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
function realColumnsRead(api) {
  const mod = { exports: {} }
  new Function('module', 'exports', 'api', output.outputText)(mod, mod.exports, api)
  return mod.exports.list
}
function oldWebKitSignal(controller, missingReason = false) {
  Object.defineProperty(controller.signal, 'throwIfAborted', {
    configurable: true, value: undefined,
  })
  if (missingReason) Object.defineProperty(controller.signal, 'reason', {
    configurable: true, value: undefined,
  })
  return controller.signal
}

test('old WebKit with no throwIfAborted still reads exactly one authorized Files Columns page', async () => {
  const controller = new AbortController()
  const signal = oldWebKitSignal(controller)
  const calls = []
  const list = realColumnsRead({
    listPageAbortable: async (...args) => {
      calls.push(args)
      return { items: [{ id: 73, name: 'current-owner.pdf' }], next_cursor: 'next' }
    },
  })
  const result = await list(8, 'page-2', signal)
  assert.deepEqual(result, { items: [{ id: 73, name: 'current-owner.pdf' }], nextCursor: 'next' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 8)
  assert.deepEqual(calls[0][1], {
    cursor: 'page-2', limit: 200, sort: 'name', order: 'asc',
  })
  assert.strictEqual(calls[0][2], signal)
})

test('old WebKit aborted before Columns read must not issue an Owner request', async () => {
  const controller = new AbortController()
  const signal = oldWebKitSignal(controller)
  const reason = new DOMException('obsolete account', 'AbortError')
  controller.abort(reason)
  let calls = 0
  const list = realColumnsRead({
    listPageAbortable: async () => {
      calls++
      return { items: [{ id: 999 }], next_cursor: 'leak' }
    },
  })
  await assert.rejects(() => list(8, null, signal), error => error === reason)
  assert.equal(calls, 0)
})

test('a late, noncooperative Columns read cannot publish private rows after Viewer/Owner navigation', async () => {
  const controller = new AbortController()
  const signal = oldWebKitSignal(controller)
  const reason = new DOMException('Viewer route superseded', 'AbortError')
  let resolve, calls = 0
  const list = realColumnsRead({
    listPageAbortable: () => {
      calls++
      return new Promise(r => { resolve = r })
    },
  })
  const pending = list(8, null, signal)
  assert.equal(calls, 1)
  controller.abort(reason)
  resolve({ items: [{ id: 999, name: 'private-old-owner.pdf' }], next_cursor: 'old' })
  await assert.rejects(pending, error => error === reason)
  assert.equal(calls, 1)
})

test('legacy WebKit without AbortSignal.reason rejects with standard AbortError', async () => {
  const controller = new AbortController()
  const signal = oldWebKitSignal(controller, true)
  controller.abort()
  let calls = 0
  const list = realColumnsRead({
    listPageAbortable: async () => { calls++; return { items: [] } },
  })
  await assert.rejects(() => list(8, null, signal),
    error => error?.name === 'AbortError')
  assert.equal(calls, 0)
})

test('invalid or unsafe Columns parent IDs are rejected before calling the current Host', async () => {
  let calls = 0
  const list = realColumnsRead({
    listPageAbortable: async () => { calls++; return { items: [] } },
  })
  for (const parent of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const controller = new AbortController()
    const signal = oldWebKitSignal(controller)
    await assert.rejects(() => list(parent, null, signal), /Invalid Owner directory identity/)
  }
  assert.equal(calls, 0)
})
