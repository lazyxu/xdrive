const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

test('P1-PH1a has one fixed Photo Intelligence host intent, separate from global auto admission', () => {
  const server = read('internal/api/admin_photo_host_desired.go')
  const models = read('internal/meta/admin_photo_host_setting.go')
  const routing = read('internal/api/router.go')
  const migration = read('cmd/server/main.go')
  for (const key of [
    'AdminPhotoHostSetting', 'AdminPhotoHostRevision',
  ]) {
    assert.ok(models.includes(key))
    assert.ok(migration.includes('meta.' + key))
  }
  assert.ok(server.includes('photoHostSettingName = "photo-intelligence-host"'))
  assert.ok(server.includes('ApplySupported: false'))
  assert.ok(server.includes('HostRuntimeState: "unknown"'))
  assert.ok(server.includes('result.HostProfileConfigured = &profile'))
  assert.ok(server.includes('state = "pending"'))
  assert.ok(server.includes('recordPhotoHostRevisionTx(tx, *input.Revision, before, origin)'))
  assert.ok(server.includes('recordAuditTx(tx, auditEventFromContext('))
  assert.ok(server.includes('return errPhotoHostRevisionConflict'))
  assert.ok(server.includes('tx.Clauses(clause.OnConflict{DoNothing: true})'))
  for (const endpoint of [
    'admin.GET("/services/photo-intelligence/host"',
    'admin.PUT("/services/photo-intelligence/host"',
    'admin.GET("/services/photo-intelligence/host/revisions"',
    'admin.POST("/services/photo-intelligence/host/rollback"',
  ]) assert.ok(routing.includes(endpoint), endpoint)
  assert.ok(routing.includes('admin.Use(s.requireAdmin())'))
  assert.ok(routing.includes('admin.POST("/services/photo-intelligence/host/apply", s.adminPhotoHostApply)'))
  for (const forbidden of ['docker.sock', 'docker exec', 'docker compose', 'HostControlDir =', 'SourceCredential']) {
    assert.equal(server.includes(forbidden), false, 'host desired Server must not execute host ops: ' + forbidden)
  }
})

test('Photo host desired lifecycle uses the same authenticated Go client and Desktop Agent IPC transport', () => {
  const paths = [
    'internal/client/client.go',
    'cmd/xdrive-agent/cloud_files.go',
    'cmd/xdrive-agent/desktop_ipc.go',
    'desktop/src/main/agent_client.cts',
    'desktop/src/main/index.cts',
    'desktop/src/preload/index.cts',
    'desktop/src/renderer/global.d.ts',
  ]
  const contents = Object.fromEntries(paths.map(p => [p, read(p)]))
  const c = contents['internal/client/client.go']
  for (const method of ['AdminPhotoHostConfig', 'UpdateAdminPhotoHost', 'AdminPhotoHostRevisions', 'RollbackAdminPhotoHost']) {
    assert.ok(c.includes(method), method)
    assert.ok(contents['cmd/xdrive-agent/cloud_files.go'].includes(method), 'agent forward '+method)
  }
  const ipc = contents['cmd/xdrive-agent/desktop_ipc.go']
  for (const operation of ['cloudAdminPhotoHost', 'cloudSetAdminPhotoHost', 'cloudAdminPhotoHostRevisions', 'cloudRollbackAdminPhotoHost']) {
    assert.ok(ipc.includes(operation), operation)
  }
  assert.ok(ipc.includes('input.Enabled == nil'), 'false must be distinguishable from omitted enabled')
  assert.ok(ipc.includes('input.TargetRevision >= *input.Revision'))
  assert.ok(contents['desktop/src/main/index.cts'].includes("requireAgentCapability(hello, 'admin-services')"))
  for (const operation of ['cloudAdminPhotoHostConfig', 'cloudSetAdminPhotoHost', 'cloudAdminPhotoHostRevisions', 'cloudRollbackAdminPhotoHost']) {
    assert.ok(contents['desktop/src/main/agent_client.cts'].includes(operation))
    assert.ok(contents['desktop/src/renderer/global.d.ts'].includes(operation))
  }
  assert.ok(contents['desktop/src/preload/index.cts'].includes("agent:cloud-set-admin-photo-host"))
})

test('shared Web/Desktop/Mobile Web panel separates saving, audited enable and real model effect proof', () => {
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  const model = read('ui/shared/src/service-dependencies.ts')
  const panel = read('ui/shared/src/mui/PhotoHostDesiredPanel.tsx')
  const web = read('web/src/App.tsx')
  const desktop = read('desktop/src/renderer/App.tsx')
  const webAPI = read('web/src/api.ts')
  const exports = read('ui/shared/src/mui/index.tsx')
  assert.ok(model.includes('export type XDrivePhotoHostConfig'))
  assert.ok(model.includes('apply_supported: boolean'))
  assert.ok(exports.includes("export * from './PhotoHostDesiredPanel'"))
  assert.ok(page.includes("case 'photo-face': return ['status', 'config', 'verify', 'history']"))
  assert.ok(page.includes("selectedPage === 'photo-face' && currentTab !== 'status'"))
  assert.ok(page.includes("XDrivePhotoHostDesiredPanel source={source}"))
  assert.ok(page.includes("onDirtyChange={currentTab === 'config' ? setChildDirty : undefined}"),
    'only mutable Config can report a dirty draft; Verify/History cannot reset it')
  assert.ok(page.includes("service: 'photo-face', tab: 'config'"))
  for (const m of ['loadPhotoHostConfig', 'savePhotoHostConfig', 'loadPhotoHostRevisions', 'rollbackPhotoHost']) {
    assert.ok(web.includes(m))
    assert.ok(desktop.includes(m))
    assert.ok(page.includes(m) || panel.includes(m))
  }
  for (const m of ['adminPhotoHostConfig', 'adminSavePhotoHost', 'adminPhotoHostRevisions', 'adminRollbackPhotoHost']) {
    assert.ok(webAPI.includes(m), m)
  }
  assert.ok(panel.includes('config.apply_state ==='))
  assert.ok(panel.includes('config.host_observed'))
  assert.ok(panel.includes('期望启用共享 Photo Intelligence 容器'))
  assert.ok(panel.includes('保存期望配置（不应用）'))
  assert.ok(panel.includes('创建回滚修订（不应用宿主）'))
  assert.ok(panel.includes('没有操作任何宿主容器'))
  assert.ok(panel.includes("section === 'history' && source.loadPhotoHostRevisions"))
  assert.ok(panel.includes('source.applyPhotoHost({ revision: config.revision })'))
  assert.ok(panel.includes('安全启用共享宿主（仅启用）'))
  assert.ok(panel.includes('具体模型尚未验证') || panel.includes('模型尚未验证'))
  assert.equal(panel.includes('docker.sock'), false)
})
