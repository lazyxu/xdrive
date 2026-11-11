'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..', '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const desktop = read('desktop/src/renderer/App.tsx')
const card = read('ui/shared/src/mui/ReleaseBundleCard.tsx')
const agent = read('cmd/xdrive-agent/cloud_release_bundle.go')
const ipc = read('desktop/src/main/index.cts')

test('Desktop current Server Bundle port is invalidated on identity changes', () => {
  const start = desktop.indexOf('const releaseBundlePort = useMemo<')
  const end = desktop.indexOf('// Ordinary Desktop users may install', start)
  assert.ok(start !== -1 && end > start)
  const port = desktop.slice(start, end)
  for (const field of [
    'agent.connected', 'configured', 'status?.server', 'status?.username',
    'status?.auth_status', "agent.hello?.capabilities.includes('release-bundle-current')",
  ]) {
    assert.ok(port.includes(field), `missing Bundle session scope: ${field}`)
  }
  assert.match(port, /if \(!agent\.connected \|\| !configured \|\| !status\?\.server \|\| !status\?\.username/)
  assert.match(port, /\}, \[agent\.connected, configured, status\?\.server, status\?\.username, status\?\.auth_status,/)
  assert.ok(desktop.includes('clientReleaseBundlePort'))
  assert.ok(desktop.includes('retry: undefined'), 'Owner install must not expose admin cache retry')
})

test('shared Bundle card discards stale polls, pending confirmation and old install feedback', () => {
  assert.ok(card.includes('latestRefresh.current++'))
  assert.ok(card.includes('actionGeneration.current++'))
  assert.ok(card.includes('setState(null)'))
  assert.ok(card.includes('setPendingInstall(null)'))
  assert.ok(card.includes('setActionFeedback(null)'))
  assert.ok(card.includes('requestNumber !== latestRefresh.current'))
  assert.ok(card.includes('actionNumber !== actionGeneration.current'))
})

test('Owner-scoped Desktop transport still delegates to authenticated Agent without tokens', () => {
  assert.ok(agent.includes('cli.CurrentReleaseBundle(ctx)'))
  assert.ok(agent.includes('cli.DownloadCurrentReleaseArtifact('))
  assert.ok(ipc.includes("requireAgentCapability(hello, 'release-bundle-current')"))
  assert.ok(ipc.includes("ipcMain.handle('agent:install-release-bundle'"))
  assert.ok(!desktop.slice(desktop.indexOf('const releaseBundlePort = useMemo<'),
    desktop.indexOf('// Ordinary Desktop users may install')).includes('Authorization: Bearer'))
})
