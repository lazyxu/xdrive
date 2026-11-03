'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('Desktop offline update follows authenticated Renderer -> Main -> Agent -> Server without arbitrary proxy', () => {
  const preload = read('desktop/src/preload/index.cts')
  const main = read('desktop/src/main/index.cts')
  const agent = read('desktop/src/main/agent_client.cts')
  const ipc = read('cmd/xdrive-agent/desktop_ipc.go')
  const handlers = read('cmd/xdrive-agent/desktop_ipc_offline_update.go')
  const client = read('internal/client/admin_offline_update.go')
  const controller = read('cmd/xdrive-agent/cloud_files.go')
  const global = read('desktop/src/renderer/global.d.ts')
  assert.ok(main.includes("requireAgentCapability(hello, 'server-offline-update')"))
  assert.ok(main.includes("agentState.status?.role !== 'admin'"))
  assert.ok(main.includes('event.sender !== mainWindow.webContents'))
  assert.ok(main.includes('event.senderFrame !== mainWindow.webContents.mainFrame'))
  assert.ok(ipc.includes('"server-offline-update"'))
  assert.ok(handlers.includes('desktopIPCOfflineUpdateController interface'))
  for (const key of [
    'offlineImportList', 'offlineImportCreate', 'offlineImportGet',
    'offlineImportRegister', 'offlineImportChunk', 'offlineImportFinalize',
    'offlineImportDelete', 'offlineImportActivate',
  ]) {
    assert.ok(preload.includes(key), 'missing exposed bounded method: ' + key)
    assert.ok(agent.includes(key), 'missing Agent method: ' + key)
    assert.ok(global.includes(key), 'missing typed Renderer method: ' + key)
  }
  for (const token of [
    'CloudOfflineImportList', 'CloudOfflineImportCreate', 'CloudOfflineImportGet',
    'CloudOfflineImportRegister', 'CloudOfflineImportChunk', 'CloudOfflineImportFinalize',
    'CloudOfflineImportDelete', 'CloudStartOfflineServerUpdate',
  ]) {
    assert.ok(controller.includes(token), token)
    assert.ok(handlers.includes(token), token)
  }
  assert.ok(main.includes('data.byteLength > 8 * 1024 * 1024'))
  assert.ok(handlers.includes('http.MaxBytesReader'))
  assert.ok(client.includes('ValidOfflineImportID'))
  assert.ok(client.includes('ValidOfflineImportFile'))
  assert.ok(client.includes('ValidOfflineImportSHA256'))
  assert.ok(client.includes('"source": "offline", "channel": "master"'))
  assert.ok(agent.includes("'application/octet-stream'"))
  assert.equal(handlers.includes('docker.sock'), false)
  assert.equal(handlers.includes('exec.Command'), false)
})

test('offline Host state never becomes a selectable online update source', () => {
  const core = read('ui/shared/src/server-update.ts')
  const controller = read('ui/shared/src/mui/ServerUpdateController.ts')
  assert.ok(core.includes("source: XDriveServerUpdateSource | 'offline'"))
  assert.ok(controller.includes("if (next.source !== 'offline')"))
})
