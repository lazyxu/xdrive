'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const desktop = read('desktop/src/renderer/App.tsx')
const dsm = read('web/src/synology.tsx')
const controller = read('ui/shared/src/mui/WorkspaceNavigationState.ts')
const app = read('ui/shared/src/mui/XDriveApp.tsx')

test('Desktop and DSM both use canonical state and shared route revision', () => {
  assert.match(desktop, /useXDriveWorkspaceNavigationState\(\{/)
  assert.match(dsm, /useXDriveWorkspaceNavigationState\(\{/)
  assert.match(desktop, /platform: 'desktop'/)
  assert.match(desktop, /adminRoleVerified: agent\.connected && agent\.status\?\.role === 'admin'/)
  assert.match(desktop, /revision=\{pageRevision\}/)
  assert.match(dsm, /revision=\{pageRevision\}/)
  assert.match(app, /<XDriveAppRouteContent/)
  assert.doesNotMatch(desktop, /setViewActual|xDriveEnterForegroundPage\(/,
    'Desktop must not own a second navigation state or foreground priority driver')
})

test('unsaved admin dependencies cannot be discarded by reentering the same route', () => {
  const guard = desktop.slice(desktop.indexOf('  const setView = useCallback('),
    desktop.indexOf('  const [systemDependenciesNavigationResetKey'))
  assert.match(guard, /next === activeViewRef\.current && next === 'admin-services'/)
  assert.match(guard, /systemDependenciesDraftRef\.current\) return false/)
  assert.match(guard, /xDriveSystemDependenciesNeedsExitConfirmation\(/)
  assert.ok(guard.indexOf("next === activeViewRef.current") <
    guard.indexOf('return navigateWorkspace(next)'))
  const click = desktop.slice(desktop.indexOf('onNavigate={(destination) => {'),
    desktop.indexOf('      overlays={'))
  assert.match(click, /const accepted = setView\(destination as View\)/)
  assert.match(click, /if \(accepted && destination === 'admin-services'\)/)
  assert.match(click, /setSystemDependenciesNavigationResetKey/)
})

test('confirmed exit travels through shared role-admitted navigation; durable work is untouched', () => {
  const start = desktop.indexOf('open={pendingSystemDependenciesExit !== null}')
  const confirm = desktop.slice(start, desktop.indexOf('      <XDriveConfirmDialog', start + 1))
  assert.match(confirm, /setSystemDependenciesDraftDirty\(false\)/)
  assert.match(confirm, /setPendingSystemDependenciesExit\(null\)/)
  assert.match(confirm, /navigateWorkspace\(next\)/)
  assert.doesNotMatch(confirm, /xDriveEnterForegroundPage|cancelUpload|cancelBackup|cancelTransfer/)
  assert.match(controller, /xDriveNextWorkspaceNavigationState\(old, destination, adminRoleVerified\)/)
  assert.match(controller, /if \(next\.selected !== old\.selected\)/)
  assert.match(controller, /pageRevision: previous\.pageRevision/)
})
