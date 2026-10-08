const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const shared = read('ui', 'shared', 'src', 'mui', 'TransferCenter.tsx')
const popover = read('ui', 'shared', 'src', 'mui', 'TransferPopover.tsx')
const taskCenter = read('ui', 'shared', 'src', 'mui', 'TaskCenterPage.tsx')
const taskCenterController = read('ui', 'shared', 'src', 'mui', 'TaskCenterController.ts')
const actionController = read('ui', 'shared', 'src', 'mui', 'FileOperationActions.ts')
const workspaceNavigation = read('ui', 'shared', 'src', 'mui', 'WorkspaceNavigation.tsx')
const sharedModel = read('ui', 'shared', 'src', 'transfers.ts')
const desktop = read('desktop', 'src', 'renderer', 'App.tsx')
const web = read('web', 'src', 'App.tsx')
const webApi = read('web', 'src', 'api.ts')
const webStore = read('web', 'src', 'transfers.ts')
const agentCloudFiles = read('cmd', 'xdrive-agent', 'cloud_files.go')

test('shared transfer center exposes detailed progress and compact rendering', () => {
  for (const token of [
    'XDriveTransferCenter', 'LinearProgress', '当前大小', '总大小', '百分比',
    '当前速度', '平均速度', '预计剩余', 'xDriveTransferTree',
    'TransferGroupItem', 'TransferLeafItem', 'compact',
  ]) assert.ok(shared.includes(token), 'shared Transfer Center missing: ' + token)
})

test('shared network classifier and speed summary avoid parent-child double counting', () => {
  for (const token of [
    'xDriveTransferNetworkDirection',
    'xDriveTransferIsNetwork',
    "task.kind === 'hydration'",
    'xDriveTransferSpeedSummary',
    'tree.flatMap(collect)',
    'staleAfterMs = 3000',
  ]) assert.ok(sharedModel.includes(token), 'shared speed model missing: ' + token)
  assert.equal(sharedModel.includes("task.kind === 'dehydration'"), false, 'dehydration must remain local task work')
})

test('network transfer UI lives in the top-right shared popover', () => {
  for (const token of [
    'XDriveTransferPopover',
    'transfers.filter(xDriveTransferIsNetwork)',
    '↑ {uploadLabel}',
    '↓ {downloadLabel}',
    '<XDriveTransferCenter',
    'downloadSpeedCaption',
  ]) assert.ok(popover.includes(token), 'transfer popover missing: ' + token)
  assert.equal((web.match(/<XDriveTransferPopover\b/g) || []).length, 1)
  assert.equal((desktop.match(/<XDriveTransferPopover\b/g) || []).length, 1)
})

test('Sidebar Tasks retains file operations, local transfers, sync and background work only', () => {
  assert.match(workspaceNavigation, /key: 'transfers',\s*label: '任务'/)
  assert.ok(taskCenter.includes('本机文件处理'))
  assert.ok(taskCenter.includes('localTransfers'))
  assert.equal(taskCenter.includes('上传与下载'), false)
  assert.ok(taskCenterController.includes('const networkTransfers = transfers.filter(xDriveTransferIsNetwork)'))
  assert.ok(taskCenterController.includes('const localTransfers = transfers.filter((task) => !xDriveTransferIsNetwork(task))'))
  assert.ok(taskCenterController.includes('const taskBadgeCount = activeBackgroundCount + activeLocalTransferCount'))
  assert.ok(actionController.includes('clearOperationHistoryOnly'))
})

test('Global Tasks is a separate administrator-only workspace in Web and Desktop', () => {
  assert.ok(taskCenter.includes("fixedScope?: 'mine' | 'global'"))
  assert.ok(taskCenter.includes("title={scope === 'global' ? '全局任务' : '任务'}"))
  assert.ok(web.includes("key: 'global-tasks'"))
  assert.ok(web.includes("profile?.role === 'admin'"))
  assert.ok(desktop.includes("key: 'global-tasks'"))
  assert.ok(desktop.includes("status?.role === 'admin'"))
})

test('Web upload/download speed sources are live and account-scoped', () => {
  assert.ok(webStore.includes("xdrive.web.transfer_history.v2:"))
  assert.ok(webStore.includes('setScope(scope: string)'))
  assert.ok(webStore.includes('baseline(id: string'))
  assert.ok(web.includes('api.setTransferScope(username)'))
  assert.ok(webApi.includes('xhr.upload.onprogress'))
  assert.ok(webApi.includes('reportProgress(completed, true)'))
  assert.ok(webApi.includes('startNativeTrackedDownload'))
  assert.ok(webApi.includes('/api/v1/download/transfers/'))
})

test('Desktop transfer speed continues to come from Agent transfer progress', () => {
  assert.ok(agentCloudFiles.includes('transfer.KindUpload'))
  assert.ok(agentCloudFiles.includes('UploadFileResumable(ctx'))
  assert.ok(agentCloudFiles.includes('transfer.KindDownload'))
  assert.ok(agentCloudFiles.includes('DownloadToProgress(ctx'))
})
