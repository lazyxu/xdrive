const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const shared = read('ui', 'shared', 'src', 'mui', 'FileOperationCenter.tsx')
const taskCenter = read('ui', 'shared', 'src', 'mui', 'TaskCenterPage.tsx')
const sharedModel = read('ui', 'shared', 'src', 'file-operations.ts')
const sharedIndex = read('ui', 'shared', 'src', 'index.ts')
const sharedMuiIndex = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const web = read('web', 'src', 'App.tsx')
const webApi = read('web', 'src', 'api.ts')
const webExplorer = read('web', 'src', 'WebFileExplorer.tsx')
const desktop = read('desktop', 'src', 'renderer', 'App.tsx')
const desktopPage = read('desktop', 'src', 'renderer', 'DesktopTransfersPage.tsx')
const desktopExplorer = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')

test('shared file-operation model covers the persistent server lifecycle', () => {
  for (const token of [
    "XDriveFileOperationType = 'copy' | 'move' | 'delete'",
    "'queued'",
    "'running'",
    "'cancel_requested'",
    "'cancelled'",
    "'completed'",
    "'failed'",
    'xDriveFileOperationActive',
    'xDriveFileOperationTransitionSnapshot',
    'hasTerminalTransition',
    'xDriveFileOperationPercent',
    'xDriveFileOperationElapsedMs',
    'xDriveFileOperationEtaMs',
    'xDriveFileOperationAverageBytesPerSecond',
    'xDriveFileOperationAverageItemsPerSecond',
    'XDRIVE_FILE_OPERATION_HISTORY_LIMIT = 200',
    'XDRIVE_FILE_OPERATION_ACTIVE_POLL_MS = 1_500',
    'XDRIVE_FILE_OPERATION_VISIBLE_IDLE_POLL_MS = 3_000',
    'XDRIVE_FILE_OPERATION_IDLE_POLL_MS = 15_000',
    'xDriveFileOperationPollIntervalMs',
    'xDriveFileOperationFailureMessage',
    'xDriveFileOperationFailureItemLabel',
    'revision_conflict',
    'name_conflict',
    'failure_code?: string',
    'retryable: boolean',
  ]) {
    assert.ok(sharedModel.includes(token), `shared operation model missing: ${token}`)
  }
  assert.ok(sharedIndex.includes("export * from './file-operations'"), 'shared operation model is not exported')
})

test('shared FileOperationCenter renders progress, history, cancel and retry actions', () => {
  for (const token of [
    'XDriveFileOperationCenter',
    'LinearProgress',
    '当前：',
    '项目进度',
    '当前大小',
    '总大小',
    '百分比',
    '开始时间',
    '已耗时',
    '预计剩余',
    '平均处理速度',
    '完成时间',
    '失败项目',
    '错误代码',
    'xDriveFileOperationFailureMessage',
    '任务 ID',
    '取消',
    '重试',
    '失败或取消',
  ]) {
    assert.ok(shared.includes(token), `shared FileOperationCenter missing: ${token}`)
  }
  assert.ok(sharedMuiIndex.includes("export * from './FileOperationCenter'"), 'shared FileOperationCenter is not exported')
})

test('Web and Desktop both render the shared file-operation center through Task Center', () => {
  assert.equal((taskCenter.match(/<XDriveFileOperationCenter\b/g) || []).length, 1, 'shared Task Center must render one FileOperationCenter')
  assert.equal((taskCenter.match(/<XDriveTransferCenter\b/g) || []).length, 1, 'shared Task Center must retain upload/download history')
  assert.ok(taskCenter.includes('title="任务中心"'), 'shared workspace should own the Task Center title')
  assert.equal((web.match(/<XDriveTaskCenterPage\b/g) || []).length, 1, 'Web must render one shared Task Center')
  assert.equal((desktopPage.match(/<XDriveTaskCenterPage\b/g) || []).length, 1, 'Desktop must render one shared Task Center')
  assert.equal((web.match(/<XDriveFileOperationCenter\b/g) || []).length, 0, 'Web must not duplicate FileOperationCenter composition')
  assert.equal((desktopPage.match(/<XDriveFileOperationCenter\b/g) || []).length, 0, 'Desktop must not duplicate FileOperationCenter composition')
})

test('Web polls persistent operations and refreshes Explorer only on terminal transitions', () => {
  for (const token of [
    'api.fileOperations(XDRIVE_FILE_OPERATION_HISTORY_LIMIT)',
    'window.setInterval(() => void refresh(), fileOperationPollIntervalMs)',
    'xDriveFileOperationTransitionSnapshot(',
    'transition.hasTerminalTransition',
    'void loadDirectory(current.id, crumbs',
    'void refreshQuota()',
    'cancelFileOperation(id: string)',
    'retryFileOperation(id: string)',
  ]) {
    assert.ok((web + webApi).includes(token), `Web persistent-operation lifecycle missing: ${token}`)
  }
  assert.ok(webExplorer.includes('onOperationQueued(queued)'), 'Web Explorer must seed newly queued operations')
})

test('Desktop polls persistent operations and refreshes cloud Explorer only on terminal transitions', () => {
  for (const token of [
    'cloudFileOperations(XDRIVE_FILE_OPERATION_HISTORY_LIMIT)',
    'window.setInterval(() => void refresh(), fileOperationPollIntervalMs)',
    'xDriveFileOperationTransitionSnapshot(',
    'transition.hasTerminalTransition',
    'void refreshCloudQuota()',
    'void loadCloudDirectory(',
    'cloudCancelFileOperation(id)',
    'cloudRetryFileOperation(id)',
  ]) {
    assert.ok(desktop.includes(token), `Desktop persistent-operation lifecycle missing: ${token}`)
  }
  assert.ok(desktopExplorer.includes('onQueued: (queued) => onOperationQueued(queued)'), 'Desktop Explorer must seed newly queued operations through the shared queue controller')
})

test('Explorer multi-select copy move delete queue one operation instead of N renderer requests', () => {
  assert.ok(webExplorer.includes('xDriveFileExplorerRunQueuedOperation({'), 'Web paste/drop must use shared queued-operation completion')
  assert.ok(webExplorer.includes('api.createFileOperation(plan.operation, plan.items, plan.parentID)'), 'Web paste/drop is not queued')
  assert.ok(webExplorer.includes('const plan = planPaste(current.id)'), 'Web paste must use the shared clipboard controller')
  assert.ok(webExplorer.includes('xDriveFileExplorerDropItemsPlan(operation, selected, target, nodeByID)'), 'Web drag/drop must use the shared drop-item plan')
  assert.ok(web.includes('xDriveFileExplorerDeleteOperationPlan(nodes)'), 'Web bulk delete must use the shared delete plan')
  assert.ok(web.includes('api.createFileOperation(plan.operation, plan.items)'), 'Web bulk delete is not queued')
  assert.ok(web.includes('xDriveFileExplorerDeleteOperationPlan([node])'), 'Web single delete must use the shared delete plan')
  assert.ok(web.includes('rememberFileOperation(operation)'), 'Web single delete must seed Task Center state')
  assert.ok(desktopExplorer.includes('xDriveFileExplorerRunQueuedOperation({'), 'Desktop paste/drop must use shared queued-operation completion')
  assert.ok(desktopExplorer.includes('window.xdriveDesktop.agent.cloudCreateFileOperation('), 'Desktop paste is not queued')
  assert.ok(desktopExplorer.includes('plan.operation,\n        plan.items,\n        plan.parentID,'), 'Desktop paste/drop must execute the shared operation plan')
  assert.ok(desktopExplorer.includes('const plan = planPaste(current.id)'), 'Desktop paste must use the shared clipboard controller')
  assert.ok(desktopExplorer.includes('xDriveFileExplorerDropItemsPlan(operation, selected, target, nodeByID)'), 'Desktop drag/drop must use the shared drop-item plan')
  assert.ok(desktop.includes('xDriveFileExplorerDeleteOperationPlan(nodes)'), 'Desktop bulk delete must use the shared delete plan')
  assert.ok(desktop.includes('plan.operation,\n            plan.items,'), 'Desktop bulk delete is not queued')
  assert.ok(desktop.includes('xDriveFileExplorerDeleteOperationPlan([node])'), 'Desktop single delete must use the shared delete plan')
  assert.ok(desktop.includes('rememberCloudFileOperation(result.data)'), 'Desktop single delete must seed Task Center state')
})

test('shared file-operation upsert owns dedupe and newest-first ordering', () => {
  for (const token of [
    'xDriveFileOperationUpsert',
    'operation,',
    'operations.filter((item) => item.id !== operation.id)',
  ]) {
    assert.ok(sharedModel.includes(token), `shared file-operation upsert missing: ${token}`)
  }
  assert.ok(web.includes('xDriveFileOperationUpsert(currentOperations, operation)'), 'Web must use shared operation upsert')
  assert.ok(desktop.includes('xDriveFileOperationUpsert(currentOperations, operation)'), 'Desktop must use shared operation upsert')
  assert.equal(web.includes('...currentOperations.filter((item) => item.id !== operation.id)'), false, 'Web must not duplicate operation dedupe')
  assert.equal(desktop.includes('...currentOperations.filter((item) => item.id !== operation.id)'), false, 'Desktop must not duplicate operation dedupe')
})

test('shared file-operation transition snapshot owns active-to-terminal refresh decisions', () => {
  for (const token of [
    'xDriveFileOperationTransitionSnapshot',
    'const statuses = new Map<string, string>()',
    'xDriveFileOperationActive(previousStatus)',
    '!xDriveFileOperationActive(operation.status)',
    'hasTerminalTransition = true',
    'statuses.set(operation.id, operation.status)',
    'return { statuses, hasTerminalTransition }',
  ]) {
    assert.ok(sharedModel.includes(token), `shared file-operation transition logic missing: ${token}`)
  }
  assert.equal(web.includes('const previous = fileOperationStatusRef.current'), false, 'Web must not duplicate transition scanning')
  assert.equal(desktop.includes('const previous = cloudFileOperationStatusRef.current'), false, 'Desktop must not duplicate transition scanning')
  assert.ok(web.includes('fileOperationStatusRef.current = transition.statuses'), 'Web must persist the shared transition snapshot')
  assert.ok(desktop.includes('cloudFileOperationStatusRef.current = transition.statuses'), 'Desktop must persist the shared transition snapshot')
})

test('shared FileExplorer delete plan owns refs, count and queued feedback', () => {
  const controller = read('ui', 'shared', 'src', 'file-explorer-controller.ts')
  for (const token of [
    'xDriveFileExplorerDeleteOperationPlan',
    "operation: 'delete' as const",
    'items: nodes.map((node) => ({ id: node.id, revision: node.revision }))',
    'const count = nodes.length',
    '加入删除任务',
  ]) {
    assert.ok(controller.includes(token), `shared FileExplorer delete plan missing: ${token}`)
  }
  assert.equal(web.includes("nodes.map((node) => ({ id: node.id, revision: node.revision }))"), false, 'Web must not build bulk-delete refs locally')
  assert.equal(desktop.includes("nodes.map((node) => ({ id: node.id, revision: node.revision }))"), false, 'Desktop must not build bulk-delete refs locally')
  assert.ok(web.includes('setFeedback({ tone: \'good\', message: plan.message })'), 'Web must use the shared delete queued message')
  assert.ok(desktop.includes('setNotice(plan.message)'), 'Desktop must use the shared delete queued message')
})

test('Task Center uses the full retained file-operation history window', () => {
  assert.ok(sharedModel.includes('XDRIVE_FILE_OPERATION_HISTORY_LIMIT = 200'), 'shared operation history limit must match Server retention')
  assert.ok(web.includes('api.fileOperations(XDRIVE_FILE_OPERATION_HISTORY_LIMIT)'), 'Web must request the full retained operation history')
  assert.ok(desktop.includes('cloudFileOperations(XDRIVE_FILE_OPERATION_HISTORY_LIMIT)'), 'Desktop must request the full retained operation history')
  assert.equal(web.includes('api.fileOperations(100)'), false, 'Web must not truncate retained operation history to 100 entries')
  assert.equal(desktop.includes('cloudFileOperations(100)'), false, 'Desktop must not truncate retained operation history to 100 entries')
})

test('Task Center exposes structured file-operation failure diagnostics', () => {
  for (const token of [
    '失败项目',
    '错误代码',
    'xDriveFileOperationFailureMessage(operation)',
    'xDriveFileOperationFailureItemLabel(operation)',
    "operation.failure_code || '—'",
  ]) {
    assert.ok(shared.includes(token), `shared failure diagnostics missing: ${token}`)
  }
  for (const token of [
    "revision_conflict: '项目版本已变化，请刷新目录后重新发起操作。'",
    "name_conflict: '目标位置存在同名项目，请处理冲突后重新操作。'",
    "managed_source_target: '该路径由同步来源管理，不能执行此操作。'",
  ]) {
    assert.ok(sharedModel.includes(token), `shared failure explanation missing: ${token}`)
  }
})

test('Task Center polling adapts to active, visible-idle and background-idle states', () => {
  for (const token of [
    'XDRIVE_FILE_OPERATION_ACTIVE_POLL_MS = 1_500',
    'XDRIVE_FILE_OPERATION_VISIBLE_IDLE_POLL_MS = 3_000',
    'XDRIVE_FILE_OPERATION_IDLE_POLL_MS = 15_000',
    'xDriveFileOperationPollIntervalMs',
    'operations.some((operation) => xDriveFileOperationActive(operation.status))',
  ]) {
    assert.ok(sharedModel.includes(token), `shared adaptive polling missing: ${token}`)
  }

  assert.ok(
    web.includes("xDriveFileOperationPollIntervalMs(\n    fileOperations,\n    appView === 'transfers',"),
    'Web must compute polling cadence from active operations and Task Center visibility',
  )
  assert.ok(
    desktop.includes("xDriveFileOperationPollIntervalMs(\n    cloudFileOperations,\n    view === 'transfers',"),
    'Desktop must compute polling cadence from active operations and Task Center visibility',
  )
  assert.ok(web.includes('window.setInterval(() => void refresh(), fileOperationPollIntervalMs)'), 'Web must use shared adaptive polling cadence')
  assert.ok(desktop.includes('window.setInterval(() => void refresh(), fileOperationPollIntervalMs)'), 'Desktop must use shared adaptive polling cadence')
  assert.equal(web.includes('window.setInterval(() => void refresh(), 1500)'), false, 'Web must not keep a permanent 1.5s polling loop')
  assert.equal(desktop.includes('window.setInterval(() => void refresh(), 1500)'), false, 'Desktop must not keep a permanent 1.5s polling loop')
})
