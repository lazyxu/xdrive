const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = p => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')

const history = read('desktop/src/main/login_history.cts')
const main = read('desktop/src/main/index.cts')
const preload = read('desktop/src/preload/index.cts')
const types = read('desktop/src/renderer/global.d.ts')
const renderer = read('desktop/src/renderer/App.tsx')

test('forgetting a Desktop account is a secure, narrow Main IPC operation', () => {
  assert.match(history, /export function forgetLoginProfile/)
  assert.match(main, /ipcMain\.handle\('desktop:forget-login-profile'/)
  // A disconnected/unknown Agent is not proof of logout. The check must
  // precede any history mutation or disk write, not merely follow it.
  const handler = main.split("ipcMain.handle('desktop:forget-login-profile'")[1]
    ?.split("ipcMain.handle('desktop:get-window-state'")[0]
  assert.ok(handler)
  assert.match(handler, /if \(!agentState\.connected \|\| !agentState\.status\)/)
  assert.match(handler, /code: 'agent_status_unavailable'/)
  assert.match(handler, /if \(agentState\.status\.configured\)/)
  assert.ok(handler.indexOf('if (!agentState.connected || !agentState.status)') <
    handler.indexOf('const next = forgetLoginProfile(previous, server, username)'))
  assert.match(main, /desktopLoginIntents\.cancel\(\)/)
  assert.match(main, /const next = forgetLoginProfile\(previous, server, username\)/)
  assert.match(main, /await saveLoginHistory\(\)/)
  assert.match(main, /code: 'login_history_save_failed'/)
  assert.match(main, /mainWindow\.webContents\.send\('desktop:login-history'/)
  assert.match(preload, /forgetLoginProfile: \(server: string, username: string\)/)
  assert.match(types, /forgetLoginProfile: \(server: string, username: string\)/)
  assert.match(renderer, /window\.xdriveDesktop\.forgetLoginProfile\(selectedServer, selectedUsername\)/)
  assert.match(renderer, /loginDraftUserEditedRef\.current = true/)
  assert.match(renderer, /忘记此账号资料/)
})

test('forget profile and clear password remain separate operations', () => {
  assert.match(history, /export function clearSavedPassword/)
  assert.match(history, /profiles: normalized\.profiles\.filter\(profile =>/)
  assert.match(history, /profile\.server !== selectedServer \|\| profile\.username !== selectedUsername/)
  assert.match(history, /profiles: normalized\.profiles\.map\(\(profile\) => \{/)
  assert.doesNotMatch(preload, /forgetLoginProfile:[^\n]*(?:password|token|refresh)/i)
})
