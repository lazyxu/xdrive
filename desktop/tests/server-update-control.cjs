const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const sharedCard = read('ui', 'shared', 'src', 'mui', 'ServerUpdateCard.tsx')
const sharedModel = read('ui', 'shared', 'src', 'server-update.ts')
const sharedSettings = read('ui', 'shared', 'src', 'mui', 'SettingsDialog.tsx')
const web = read('web', 'src', 'App.tsx') + sharedSettings
const webApi = read('web', 'src', 'api.ts')
const desktop = read('desktop', 'src', 'renderer', 'App.tsx') + sharedSettings
const preload = read('desktop', 'src', 'preload', 'index.cts')
const desktopMain = read('desktop', 'src', 'main', 'index.cts')
const agentIPC = read('cmd', 'xdrive-agent', 'desktop_ipc.go')
const apiRouter = read('internal', 'api', 'router.go')
const apiUpdate = read('internal', 'api', 'admin_update.go')
const compose = read('deploy', 'docker-compose.yml')
const installer = read('deploy', 'install-server.sh')
const hostManager = read('scripts', 'xdrive-server-host.sh')
const hostControl = read('scripts', 'server-control.sh')

test('shared server update UI exposes source, channel, status and progress', () => {
  for (const token of [
    'XDriveServerUpdateCard',
    '服务端更新',
    '更新来源',
    '更新通道',
    'GitHub',
    'GitLab',
    'stable',
    'master',
    'LinearProgress',
    '下载进度',
    '开始时间',
    '完成时间',
    '请求 ID',
  ]) {
    assert.ok(sharedCard.includes(token) || sharedModel.includes(token), `missing server update UI token: ${token}`)
  }
})

test('Web and Desktop use the same server update card', () => {
  assert.equal(((web + sharedSettingsDialog).match(/<XDriveServerUpdateCard\b/g) || []).length, 1)
  assert.equal(((desktop + sharedSettingsDialog).match(/<XDriveServerUpdateCard\b/g) || []).length, 1)
  assert.ok(webApi.includes("'/api/v1/admin/update'"), 'Web API server update endpoint missing')
  assert.ok(preload.includes('getServerUpdate'), 'Desktop preload server update getter missing')
  assert.ok(preload.includes('startServerUpdate'), 'Desktop preload server update action missing')
  assert.ok(desktopMain.includes("requireAgentCapability(hello, 'server-update')"), 'Desktop main must gate server update by capability')
  assert.ok(agentIPC.includes('"server-update"'), 'Agent IPC server-update capability missing')
  assert.ok(web.includes('确认更新服务端？'), 'Web server update must require confirmation')
  assert.ok(desktop.includes('确认更新服务端？'), 'Desktop server update must require confirmation')
})

test('server update command boundary never mounts Docker socket into the API container', () => {
  assert.ok(apiRouter.includes('admin.GET("/update"'), 'admin update status route missing')
  assert.ok(apiRouter.includes('admin.POST("/update"'), 'admin update start route missing')
  assert.ok(apiUpdate.includes('input.Source != "github" && input.Source != "gitlab"'), 'API source whitelist missing')
  assert.ok(apiUpdate.includes('input.Channel != "stable" && input.Channel != "master"'), 'API channel whitelist missing')
  assert.ok(compose.includes('XD_HOST_CONTROL_DIR: /host-control'), 'server host-control mount env missing')
  assert.ok(compose.includes(':/host-control'), 'server host-control bind mount missing')
  assert.equal(compose.includes('/var/run/docker.sock'), false, 'server API must never receive Docker socket access')
})

test('host control reuses transactional xdrive-server update and installer progress', () => {
  assert.ok(hostManager.includes('control) control_cmd "$@"'), 'host manager control dispatcher missing')
  assert.ok(hostControl.includes('"$MANAGER" update --source "$source" --channel "$channel"'), 'host control must reuse xdrive-server update')
  assert.ok(hostControl.includes('case "$source" in github|gitlab)'), 'host runner source whitelist missing')
  assert.ok(hostControl.includes('case "$channel" in stable|master)'), 'host runner channel whitelist missing')
  assert.ok(hostControl.includes('heartbeat'), 'host runner heartbeat missing')
  assert.ok(hostControl.includes('exec 9>&-'), 'host runner must drop inherited installer lock fd')
  assert.ok(hostControl.includes('chmod 2770 "$dir"'), 'host-control bridge must not be world-writable')
  assert.equal(hostControl.includes('chmod 0777 "$dir"'), false, 'host-control bridge must not be 0777')
  assert.ok(hostControl.includes('request_time_is_fresh'), 'host runner must reject stale requests')
  assert.ok(hostControl.includes('host update interrupted before completion'), 'host runner must recover interrupted updates')
  assert.ok(hostControl.includes('9>&- &'), 'host runner must not inherit the installer transaction lock fd')
  assert.ok(installer.includes('XD_INSTALL_PROGRESS_FILE'), 'installer progress bridge missing')
  assert.ok(installer.includes('write_install_progress'), 'installer progress writer missing')
  assert.ok(installer.includes('server-control.sh'), 'installer must install host-control helper')
})
