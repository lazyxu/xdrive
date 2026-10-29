'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const file = path.join(root, 'desktop/src/renderer/desktopCloudFilesHostPort.ts')
const source = fs.readFileSync(file, 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: file, reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
})
assert.deepEqual((compiled.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error)
  .map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [])
const invocations = []
const bridge = { xDriveDesktopViewportRequest: async (signal, callback) => {
  invocations.push(['viewport', signal])
  if (signal?.aborted) throw new Error('AbortError')
  return callback('host-read-lease-42')
}}
const mod = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  mod, mod.exports,
  name => {
    assert.equal(name, './abortableViewportRequest')
    return bridge
  },
)
const create = mod.exports.createDesktopCloudFilesHostPort

function agent() {
  return {
    cloudRoot: async () => { invocations.push(['root']); return { ok: true, data: { id: 11 } } },
    cloudChildrenPage: async (id, opts) => {
      invocations.push(['page', id, opts]); return { ok: true, data: { items: [{ id: 23 }] } }
    },
    cloudChildrenRange: async (...args) => {
      invocations.push(['range', ...args])
      return { ok: true, data: { items: [], total_count: 300, offset: args[1], limit: args[2] } }
    },
    cloudChanges: async (after, limit) => {
      invocations.push(['changes', after, limit]); return { ok: true, data: { items: [], next_after: after } }
    },
    cloudQuota: async () => {
      invocations.push(['quota'])
      return { ok: true, data: { quota_bytes: 123 } }
    },
  }
}

test('Desktop Host exposes only genuine read capabilities and no hidden upload/Agent proxy', async () => {
  invocations.length = 0
  const host = create(agent, true)
  assert.deepEqual(Object.keys(host).sort(),
    ['getChanges', 'getPage', 'getQuota', 'getRange', 'getRoot'])
  assert.equal((await host.getRoot()).id, 11)
  assert.equal((await host.getPage(11, { limit: 5 })).items[0].id, 23)
  assert.equal((await host.getQuota()).quota_bytes, 123)
  assert.equal((await host.getChanges(90, 30)).next_after, 90)
  assert.deepEqual(invocations, [
    ['root'], ['page', 11, { limit: 5 }], ['quota'], ['changes', 90, 30],
  ])
})

test('shared counted Range preserves sort, grouping and exact desktop cancellation lease', async () => {
  invocations.length = 0
  const host = create(agent, true)
  const controller = new AbortController()
  const grouping = { key: 'month', direction: 'desc' }
  const result = await host.getRange(17, 200, 100, { key: 'name', direction: 'asc' },
    false, grouping, controller.signal)
  assert.equal(result.total_count, 300)
  assert.strictEqual(invocations[0][1], controller.signal)
  assert.deepEqual(invocations[1], [
    'range', 17, 200, 100, 'name', 'asc', false, grouping, 'host-read-lease-42',
  ])
})

test('missing change-feed capability must be undefined, never a fabricated empty page', () => {
  const host = create(agent, false)
  assert.strictEqual(host.getChanges, undefined)
  assert.equal('getChanges' in host, true)
})

test('current Agent is rebound per request and exact Server errors propagate', async () => {
  let current = agent()
  const host = create(() => current, true)
  assert.equal((await host.getRoot()).id, 11)
  current = { ...agent(), cloudRoot: async () => ({ ok: true, data: { id: 77 } }),
    cloudChildrenPage: async () => ({ ok: false, error: { message: 'server Owner denied' } }),
    cloudQuota: async () => ({ ok: false, error: { message: 'quota unavailable' } }),
  }
  assert.equal((await host.getRoot()).id, 77)
  await assert.rejects(host.getPage(11, { limit: 5 }), /server Owner denied/)
  await assert.rejects(host.getQuota(), /quota unavailable/)
})

test('new Host module never owns a page, native task, bearer or request-side cron', () => {
  for (const forbidden of ['Authorization', 'backup.cgi', 'ipcRenderer',
    'setInterval', 'setTimeout', 'cancelTransfer', 'window.xdriveDesktop',
    '<DesktopFileExplorer', '<XDriveFilesWorkspacePage']) {
    assert.equal(source.includes(forbidden), false, forbidden)
  }
  const app = fs.readFileSync(path.join(root, 'desktop/src/renderer/App.tsx'), 'utf8')
  assert.match(app, /useMemo\(\s*\(\) => createDesktopCloudFilesHostPort\(/)
  assert.match(app, /useXDriveCloudFilesController<AgentCloudNode, AgentCloudQuota, XDriveFileExplorerSort>/)
  assert.match(app, /lifecycleKey: \x60\$\{status\?\.server \?\? ''\}\\n\$\{status\?\.username \?\? ''\}\x60/)
})
