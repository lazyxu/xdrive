const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

test('Desktop durable Gallery jobs share the Web UI and owner-scoped Task Center', () => {
  const renderer = read('desktop/src/renderer/App.tsx')
  const gallery = read('desktop/src/renderer/mediaGalleryAdapter.ts')
  const preload = read('desktop/src/preload/index.cts')
  const types = read('desktop/src/renderer/global.d.ts')
  const main = read('desktop/src/main/index.cts')
  const client = read('desktop/src/main/agent_client.cts')
  const agent = read('cmd/xdrive-agent/desktop_ipc.go')
  const ctrl = read('cmd/xdrive-agent/cloud_files.go')
  const go = read('internal/client/media.go')

  assert.match(renderer, /mediaSelectionJobsSupported/)
  assert.match(renderer, /mediaSelectionJobPort=\{view === 'transfers' \? mediaSelectionJobPort : undefined\}/)
  assert.match(renderer, /createDesktopMediaGalleryDataSource\(/)
  assert.match(gallery, /durableJobsSupported \? \{/)
  for (const name of ['submitSelectionFavoriteJob', 'getSelectionJob',
    'listSelectionJobs', 'cancelSelectionJob', 'retrySelectionJob', 'getSelectionJobFailures']) {
    assert.match(gallery, new RegExp(name + ':'))
  }
  for (const ipcName of [
    'submit-media-selection-favorite-job', 'get-media-selection-job',
    'list-media-selection-jobs', 'cancel-media-selection-job',
    'retry-media-selection-job', 'media-selection-job-failures',
  ]) {
    assert.ok(main.includes('agent:' + ipcName), 'missing Electron main IPC ' + ipcName)
    assert.ok(preload.includes('agent:' + ipcName), 'missing Preload IPC ' + ipcName)
  }
  assert.match(types, /MediaSelectionJobFailurePage/)
  assert.match(client, /mediaSelectionJobFailures\(/)
  assert.match(agent, /"media-selection-jobs"/)
  assert.match(ctrl, /CloudMediaSubmitSelectionFavoriteJob/)
  assert.match(go, /MediaSubmitSelectionFavoriteJob/)
  assert.doesNotMatch(gallery, /fetch\(|new WebSocket|archiveDownload/)
  assert.match(gallery, /deleteItems: \(items\)/, 'explicit loaded-item deletion remains independent')
})

test('older Agent never advertises durable query mutation controls', () => {
  const code = read('desktop/src/renderer/mediaGalleryAdapter.ts')
  const main = read('desktop/src/main/index.cts')
  assert.match(code, /durableJobsSupported = false/)
  assert.match(code, /durableJobsSupported \? \{/)
  assert.match(main, /requireAgentCapability\(hello, 'media-selection-jobs'\)/)
  assert.match(main, /typeof favorite !== 'boolean'/)
  assert.match(main, /Number\.isSafeInteger\(version\)/)
})
