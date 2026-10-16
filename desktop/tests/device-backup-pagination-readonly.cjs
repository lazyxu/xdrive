const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')

test('Desktop and Web read only bounded owner-redacted device pages', () => {
  const client = read('desktop', 'src', 'main', 'agent_client.cts')
  const main = read('desktop', 'src', 'main', 'index.cts')
  const preload = read('desktop', 'src', 'preload', 'index.cts')
  const globals = read('desktop', 'src', 'renderer', 'global.d.ts')
  const renderer = read('desktop', 'src', 'renderer', 'App.tsx')
  const web = read('web', 'src', 'App.tsx')
  assert.ok(client.includes("deviceBackupsPage(limit = 100, afterDeviceID = '')"))
  assert.ok(client.includes("`/v1/device-backups?\${query.toString()}`"))
  const start = main.indexOf("ipcMain.handle('agent:get-device-backups-page'")
  const end = main.indexOf("ipcMain.handle('agent:get-device-backup-runs'", start)
  assert.ok(start > 0 && end > start)
  const bounded = main.slice(start, end)
  for (const expected of [
    "requireAgentCapability(hello, 'device-backup-read')",
    "Number.isSafeInteger(requestedLimit)",
    "requestedCursor !== 'string'",
    "deviceBackupsPage(requestedLimit, requestedCursor)",
  ]) assert.ok(bounded.includes(expected), expected)
  for (const unsafe of ['local-source', 'RootFingerprint', 'createSource', 'cancelSourceRun']) {
    assert.equal(bounded.includes(unsafe), false, 'read IPC must not carry ' + unsafe)
  }
  assert.ok(preload.includes("getDeviceBackupsPage: (limit = 100, afterDeviceID = '')"))
  assert.ok(globals.includes('getDeviceBackupsPage: (limit?: number, afterDeviceID?: string)'))
  assert.ok(renderer.includes('listPage: async (limit, afterDeviceID)'))
  assert.ok(web.includes('listPage: (limit: number, afterDeviceID: string) => api.deviceBackupsPage(limit, afterDeviceID)'))
})

test('shared paging is deduplicated, datasource-scoped, and honest about unpaged folders', () => {
  const page = read('ui', 'shared', 'src', 'mui', 'DeviceBackupPage.tsx')
  for (const expected of [
    'source.listPage(100, cursor)',
    'prev.source !== source || prev.overview !== requestedOverview',
    'new Set(devices.map((device) => device.id))',
    'if (seen.has(device.id)) continue',
    'requestedOverview.has_more_folders || page.has_more_folders',
    'page.has_more ? page.next_after_device_id : undefined',
    '设备读取失败；已加载设备保持不变',
    'source.foldersPage(deviceID, 100, cursor)',
    '未读完前不能将当前列表视作完整',
  ]) assert.ok(page.includes(expected), expected)
  assert.equal(page.includes('sourceOverview('), false)
  assert.equal(page.includes('sourceItems('), false)
})
