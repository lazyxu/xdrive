const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const controller = read('ui', 'shared', 'src', 'mui', 'TaskCenterController.ts')
const page = read('ui', 'shared', 'src', 'mui', 'TaskCenterPage.tsx')
const transferModel = read('ui', 'shared', 'src', 'transfers.ts')
const fileOperationModel = read('ui', 'shared', 'src', 'file-operations.ts')
const backgroundModel = read('ui', 'shared', 'src', 'background-tasks.ts')
const backgroundCenter = read('ui', 'shared', 'src', 'mui', 'BackgroundTaskCenter.tsx')
const webApi = read('web', 'src', 'api.ts')
const agentIPC = read('cmd', 'xdrive-agent', 'desktop_ipc.go')
const agentClient = read('desktop', 'src', 'main', 'agent_client.cts')
const desktopPreload = read('desktop', 'src', 'preload', 'index.cts')
const sharedMuiIndex = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const web = read('web', 'src', 'App.tsx')
const desktop = read('desktop', 'src', 'renderer', 'App.tsx')

test('shared Task Center controller owns summary, history and page-action presentation', () => {
  for (const token of [
    'useXDriveTaskCenterController',
    'xDriveActiveTransferCount(transfers)',
    'xDriveActiveFileOperationCount(operations)',
    'xDriveTransferHasHistory(transfers)',
    'xDriveFileOperationHasHistory(operations)',
    'const badgeCount = activeTransferCount + activeOperationCount',
    'disabled: !hasHistory || externalBusy || operationActions.busy',
    'loading: operationActions.clearHistoryLoading',
    'operationCancellingID: operationActions.cancellingID',
    'operationRetryingID: operationActions.retryingID',
    'operationResolvingID: operationActions.resolvingID',
    'operationResolvingPolicy: operationActions.resolvingPolicy',
    'operationDisabled: operationActions.busy',
    'void operationActions.clearHistory()',
    'void operationActions.cancelOperation(id)',
    'void operationActions.retryOperation(id)',
    'conflictResolutionEnabled',
    'void operationActions.resolveConflict(id, policy)',
    'badge: badgeCount || undefined',
  ]) {
    assert.ok(controller.includes(token), `shared Task Center controller missing: ${token}`)
  }

  assert.ok(page.includes('export interface XDriveTaskCenterPageProps'), 'Task Center page props must be reusable by the controller')
  assert.ok(transferModel.includes('export function xDriveTransferActive'), 'shared transfer model must own active-state selection')
  assert.ok(transferModel.includes('export function xDriveTransferTerminal'), 'shared transfer model must own terminal-state selection')
  assert.ok(transferModel.includes('export function xDriveActiveTransferCount'), 'shared transfer model must own active transfer counting')
  assert.ok(transferModel.includes('export function xDriveTransferHasHistory'), 'shared transfer model must own transfer history selection')
  assert.ok(fileOperationModel.includes('export function xDriveActiveFileOperationCount'), 'shared file-operation model must own active operation counting')
  assert.ok(fileOperationModel.includes('export function xDriveFileOperationHasHistory'), 'shared file-operation model must own operation history selection')
  assert.ok(sharedMuiIndex.includes("export * from './TaskCenterController'"), 'Task Center controller must be exported')
})

test('Web delegates Task Center view-model composition to shared', () => {
  for (const token of [
    'const fileOperationActions = useXDriveFileOperationActions<XDriveFileOperation>({',
    'const taskCenter = useXDriveTaskCenterController({',
    'transfers,',
    'operations: fileOperations',
    'operationActions: fileOperationActions',
    'transferBadge={taskCenter.badge}',
    '<XDriveTaskCenterPage {...taskCenter.pageProps} />',
  ]) {
    assert.ok(web.includes(token), `Web Task Center wiring missing: ${token}`)
  }

  for (const token of [
    "transfers.filter((item) => item.state === 'running' || item.state === 'retrying')",
    'fileOperations.filter((item) => xDriveFileOperationActive(item.status))',
    "transfers.some((item) => item.state === 'completed' || item.state === 'failed')",
    'fileOperations.some((item) => !xDriveFileOperationActive(item.status))',
    'fileOperationClearHistoryLoading',
    'fileOperationCancellingID',
    'fileOperationRetryingID',
    'fileOperationResolvingID',
  ]) {
    assert.equal(web.includes(token), false, `Web must not duplicate Task Center derivation: ${token}`)
  }
})

test('Desktop delegates shared Task Center composition while retaining native transfer retry', () => {
  for (const token of [
    'const fileOperationActions = useXDriveFileOperationActions<AgentCloudFileOperation, AgentTransfers>({',
    'const taskCenter = useXDriveTaskCenterController({',
    'transfers: transfers.transfers',
    'operations: cloudFileOperations',
    'operationActions: fileOperationActions',
    'externalBusy: Boolean(busy)',
    'conflictResolutionEnabled: fileOperationConflictResolveSupported',
    'transferBadge={taskCenter.badge}',
    'taskCenter.activeTransferCount',
    '{...taskCenter.pageProps}',
    "transferRetryingID={busy.startsWith('retry-transfer-')",
    'transferRetryDisabled={Boolean(busy) || fileOperationActions.clearHistoryLoading}',
    'onRetryTransfer={(id) => { void retryTransfer(id) }}',
  ]) {
    assert.ok(desktop.includes(token), `Desktop Task Center wiring missing: ${token}`)
  }

  for (const token of [
    'const activeTransfers =',
    'const activeFileOperations =',
    'const hasTaskHistory =',
    'fileOperationActionBusy',
    'fileOperationCancellingID',
    'fileOperationRetryingID',
    'fileOperationResolvingID',
    'fileOperationResolvingPolicy',
    'fileOperationClearHistoryLoading',
  ]) {
    assert.equal(desktop.includes(token), false, `Desktop must not duplicate Task Center derivation: ${token}`)
  }
})


test('shared Task Center renders sync folders, background processing and admin global view', () => {
  for (const token of ['backgroundTaskPort?: XDriveBackgroundTaskPort','backgroundTasksVisible','globalTasksEnabled','loadMine','loadGlobal','xDriveBackgroundTaskPollIntervalMs']) assert.ok(controller.includes(token), 'shared background controller missing: ' + token)
  for (const token of ['同步文件夹','后台处理','我的任务','全局任务','<XDriveBackgroundTaskList','<XDriveBackgroundTaskTable']) assert.ok(page.includes(token), 'Task Center background UI missing: ' + token)
  for (const token of ['媒体索引','缩略图生成','分析预览','人脸识别','地点识别','人物聚类','owner_username','control_actions']) assert.ok(backgroundModel.includes(token), 'background task model missing: ' + token)
  for (const token of ['用户','任务类型','优先级','资源类','触发方式','控制能力']) assert.ok(backgroundCenter.includes(token), 'global task table missing: ' + token)
})

test('Web and Desktop use adapters for the same background-task contract', () => {
  assert.ok(webApi.includes('backgroundTasks(limit = 100)'))
  assert.ok(webApi.includes('adminBackgroundTasks(limit = 100)'))
  assert.ok(web.includes('backgroundTaskPort'))
  assert.ok(web.includes("globalTasksEnabled: profile?.role === 'admin'"))
  assert.ok(agentIPC.includes('"background-tasks"'))
  assert.ok(agentIPC.includes('GET /v1/cloud/background-tasks'))
  assert.ok(agentClient.includes('cloudBackgroundTasks(global = false, limit = 100)'))
  assert.ok(desktopPreload.includes('cloudBackgroundTasks: (global = false, limit = 100)'))
  assert.ok(desktop.includes('backgroundTasksSupported'))
  assert.ok(desktop.includes("globalTasksEnabled: status?.role === 'admin'"))
})


test('background task controls use server capabilities and scope-aware polling', () => {
  for (const token of [
    "control?: (",
    "backgroundScope",
    "backgroundControlKey",
    "backgroundTaskPort.control(task.id, action, global)",
    "effectiveScope === 'global'",
    "port.loadGlobal(XDRIVE_BACKGROUND_TASK_LIMIT)",
    "port.loadMine(XDRIVE_BACKGROUND_TASK_LIMIT)",
  ]) assert.ok(controller.includes(token), 'background control controller missing: ' + token)

  for (const token of [
    'onBackgroundScopeChange',
    'onBackgroundTaskControl',
    'backgroundControlKey',
  ]) assert.ok(page.includes(token), 'background control page wiring missing: ' + token)

  for (const token of [
    '<XDriveActionButton',
    'task.control_actions',
    'xDriveBackgroundTaskControlLabel',
    'onControl(task, action)',
  ]) assert.ok(backgroundCenter.includes(token), 'background control surface missing: ' + token)

  assert.ok(webApi.includes('controlBackgroundTask('), 'Web unified background control API missing')
  assert.ok(web.includes('api.controlBackgroundTask(id, action, global)'), 'Web background control adapter missing')
})


test('shared Task Center renders distributed lease deferral consistently', () => {
  assert.ok(
    backgroundModel.includes("case 'waiting_for_cluster_lease': return '等待其他服务器'"),
    'shared background model must label cluster lease deferral',
  )
  assert.equal(
    web.includes('waiting_for_cluster_lease'),
    false,
    'Web must not duplicate cluster lease wording',
  )
  assert.equal(
    desktop.includes('waiting_for_cluster_lease'),
    false,
    'Desktop must not duplicate cluster lease wording',
  )
})
