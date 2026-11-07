'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

// Execute the actual same-origin DSM transport. The fake response only
// exposes a status + fixed header: Agent text and local paths never reach UI.
const filename = path.resolve(__dirname, '../../ui/shared/src/synology-backup-adapter.ts')
const source = fs.readFileSync(filename, 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((compiled.diagnostics || [])
  .filter(x => x.category === ts.DiagnosticCategory.Error)
  .map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [])
const moduleRef = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  moduleRef, moduleRef.exports, name => { throw Error('Unexpected runtime import: ' + name) },
)
const createClient = moduleRef.exports.createXDriveSynologyBackupLocalClient

test('DSM transport forwards only a fixed, non-sensitive Agent outage reason', async () => {
  const previousWindow = global.window
  const previousFetch = global.fetch
  global.window = { location: {
    href: 'https://nas.example:5001/webman/3rdparty/xdrivenas/index.html',
    origin: 'https://nas.example:5001',
  } }
  let status = 503
  let header = 'agent-unavailable'
  global.fetch = async () => ({
    ok: false, status,
    headers: { get: key => key === 'X-XDrive-DSM-Failure' ? header : null },
  })
  try {
    const client = createClient('/webman/3rdparty/xdrivenas/backup.cgi')
    await assert.rejects(client.list(), /HTTP 503\) \[agent-unavailable\]/)
    header = 'nas-inventory-unavailable'
    await assert.rejects(client.list(), /HTTP 503\) \[nas-inventory-unavailable\]/)
    header = 'root=private-token-do-not-log'
    await assert.rejects(client.list(), err =>
      /HTTP 503\)$/.test(err.message) && !err.message.includes('private-token'))
    status = 403
    header = 'agent-unavailable'
    await assert.rejects(client.list(), /^Error: DSM backup request rejected \(HTTP 403\)$/)
  } finally {
    global.window = previousWindow
    global.fetch = previousFetch
  }
})
