'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const ts = require('typescript')

const repo = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(repo, name), 'utf8')
const main = read('desktop/src/main/index.cts')
const agent = read('desktop/src/main/agent_client.cts')
const preload = read('desktop/src/preload/index.cts')
const renderer = read('desktop/src/renderer/App.tsx')
const types = read('desktop/src/renderer/global.d.ts')

test('Desktop Device Backup overview only: renderer-to-Agent GET abort path is sender-scoped', () => {
  const segment = main.split("ipcMain.handle('agent:get-device-backups',")[1]
    ?.split("ipcMain.handle('agent:get-device-backups-page'")[0]
  assert.ok(segment, 'separate existing Owner device overview GET handler')
  assert.match(segment, /viewportRequests\.run\(event\.sender, requestID, async signal =>/,
    'only invoking Electron sender owns its read cancellation')
  assert.match(segment, /requireAgentCapability\(hello, 'device-backup-read'\)/)
  assert.match(segment, /if \(signal\?\.aborted\) throw new AgentIPCError\('aborted'/)
  assert.match(segment, /requireAgentClient\(\)\.deviceBackups\(signal\)/)
  assert.match(agent, /deviceBackups\(signal\?: AbortSignal\)/)
  const getClient = agent.split('  deviceBackups(')[1]?.split('  deviceBackupsPage(')[0]
  assert.ok(getClient)
  assert.match(getClient, /this\.request<AgentDeviceBackupOverview>\('GET', '\/v1\/device-backups',[\s\S]*?10_000, signal\)/,
    'actual authenticated Agent GET must carry signal into Node fetch')
  assert.match(preload, /getDeviceBackups: \(requestID\?: string\) => ipcRenderer\.invoke\('agent:get-device-backups', requestID\)/)
  assert.match(types, /getDeviceBackups: \(requestID\?: string\)/)
  assert.match(renderer, /list: async \(signal\?: AbortSignal\) => \{[\s\S]*?xDriveDesktopViewportRequest\(signal, requestID =>[\s\S]*?getDeviceBackups\(requestID\)/)
  assert.doesNotMatch(segment, /startBackup|trigger|cancelSourceRun|updateSettings|setDeviceBackupLocal/,
    'read cancellation must not gain a durable backup/Push/Pull mutation handle')
  assert.match(main, /ipcMain\.handle\('agent:get-device-backups-page'/,
    'existing read-only pagination stays separately authorized')
  assert.match(renderer, /getDeviceBackupRuns\(sourceID, limit, offset\)/,
    'History and restore flows are unaffected')
})

function actualRequestHelper() {
  const file = 'desktop/src/renderer/abortableViewportRequest.ts'
  const js = ts.transpileModule(read(file), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', js)(mod.exports, mod)
  return mod.exports.xDriveDesktopViewportRequest
}
async function until(predicate, label) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.fail('timed out: ' + label)
}

test('real HTTP: abandoned Desktop Device Backup GET disconnects; backup POST remains independent', async () => {
  const reads = [], writes = []
  const server = http.createServer((req, res) => {
    const row = { res, closedEarly: false, bytes: 0 }
    res.once('close', () => { row.closedEarly = !res.writableEnded })
    if (req.method === 'POST' && req.url === '/durable-backup') {
      writes.push(row)
      req.resume()
      return // a separate confirmed durable task is allowed to finish later
    }
    if (req.method === 'GET' && req.url === '/v1/device-backups') {
      reads.push(row)
      if (reads.length === 1) return // simulate obsolete slow Agent GET
      const bytes = Buffer.from('{"devices":[]}')
      row.bytes = bytes.length
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(bytes)
      return
    }
    res.writeHead(404); res.end()
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const url = 'http://127.0.0.1:' + server.address().port
  const requests = new Map(), cancelIDs = [], oldWindow = global.window
  global.window = { xdriveDesktop: { agent: {
    cancelViewportRequest: async id => {
      cancelIDs.push(id)
      requests.get(id)?.abort()
      return { ok: true, data: { cancelled: true } }
    },
  } } }
  const helper = actualRequestHelper()
  try {
    const durableSignal = new AbortController()
    const backup = fetch(url + '/durable-backup', {
      method: 'POST', body: 'persistent BackupSession',
      signal: durableSignal.signal,
    }).then(response => response.text())
    const staleSignal = new AbortController()
    const oldRead = helper(staleSignal.signal, id => {
      const network = new AbortController()
      requests.set(id, network)
      return fetch(url + '/v1/device-backups', { signal: network.signal })
        .then(response => response.json())
    })
    await until(() => reads.length === 1 && writes.length === 1,
      'one slow owner-redacted GET and one durable backup HTTP operation')
    staleSignal.abort()
    await assert.rejects(oldRead, e => e?.name === 'AbortError')
    await until(() => reads[0].closedEarly, 'obsolete device overview socket closed')
    assert.equal(reads[0].bytes, 0)
    assert.equal(cancelIDs.length, 1, 'only the owned read has a cancel request ID')
    assert.equal(durableSignal.signal.aborted, false)
    assert.equal(writes[0].res.destroyed, false)
    const replacement = await helper(undefined, () =>
      fetch(url + '/v1/device-backups').then(response => response.json()))
    assert.deepEqual(replacement, { devices: [] })
    writes[0].res.writeHead(200, { 'Content-Type': 'text/plain' })
    writes[0].res.end('finished')
    assert.equal(await backup, 'finished')
    assert.equal(writes[0].closedEarly, false, 'durable backup stream must complete')
  } finally {
    if (oldWindow === undefined) delete global.window
    else global.window = oldWindow
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
})
