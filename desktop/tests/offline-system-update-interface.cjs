'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..', '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const page = read('ui/shared/src/mui/SystemUpdatePage.tsx')
const panel = read('ui/shared/src/mui/OfflineSystemUpdatePanel.tsx')
const port = read('ui/shared/src/offline-update.ts')
const web = read('web/src/App.tsx')
const api = read('web/src/api.ts')
const controller = read('ui/shared/src/mui/ServerUpdateController.ts')
const status = read('ui/shared/src/server-update.ts')

test('offline import uses the same authenticated Server Update workspace but a separate transport', () => {
  assert.ok(page.includes('offlinePort?: XDriveOfflineImportPort'))
  assert.ok(page.includes('<XDriveOfflineSystemUpdatePanel'))
  assert.ok(web.includes('offlinePort: offlineImportPort'))
  assert.ok(web.includes('const offlineImportPort = useMemo('))
  assert.ok(web.includes('adminUpdate: serverAdminVerified ?'))
  assert.ok(controller.includes("next.source !== 'offline'"))
  assert.ok(status.includes("XDriveServerUpdateSource | 'offline'"))
  assert.equal(web.includes('docker.sock'), false)
})

test('browser upload is chunk-bounded, resumable and does not promote uploader SHA as trust', () => {
  assert.ok(port.includes('XDRIVE_OFFLINE_CHUNK_BYTES = 8 * 1024 * 1024'))
  assert.ok(port.includes('xDriveValidOfflineFilename'))
  assert.ok(panel.includes('chunk.arrayBuffer()'))
  assert.ok(panel.includes('for (let offset = 0, index = 0; offset < file.size;'))
  assert.ok(panel.includes('port.putChunk('))
  assert.ok(panel.includes('port.finalize('))
  assert.ok(panel.includes('xDriveValidOfflineDigest(manifestSHA)'))
  assert.ok(panel.includes('xDriveValidOfflineDigest(goSHA)'))
  assert.ok(panel.includes('status?.ready_to_verify'))
  assert.ok(panel.includes('confirmOpen'))
  assert.ok(panel.includes('port.start(id, manifestSHA, goSHA, backupFiles)'))
  assert.equal(panel.includes('docker.sock'), false)
  assert.equal(panel.includes('exec('), false)
})

test('Web transport uses only the admin Go API and independently trusted Hash fields', () => {
  for (const route of [
    '/api/v1/admin/update/offline/imports',
    '/files/', '/chunks/', '/finalize',
    'X-XDrive-Chunk-SHA256', 'trusted_manifest_sha256',
    'trusted_installer_sha256',
  ]) assert.ok(api.includes(route), route)
  assert.ok(api.includes("source: 'offline', channel: 'master'"))
  assert.ok(api.includes('encodeURIComponent(id)'))
  assert.ok(api.includes('encodeURIComponent(name)'))
  assert.ok(panel.includes('state/update-imports/{id}/'))
  assert.equal(panel.includes('trusted-manifest-sha256 from uploaded file'), false)
})
