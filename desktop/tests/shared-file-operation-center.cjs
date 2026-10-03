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
    'api.fileOperations(100)',
    'window.setInterval(() => void refresh(), 1500)',
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
    'cloudFileOperations(100)',
    'window.setInterval(() => void refresh(), 1500)',
    'xDriveFileOperationTransitionSnapshot(',
    'transition.hasTerminalTransition',
    'void refreshCloudQuota()',
    'void loadCloudDirectory(',
    'cloudCancelFileOperation(id)',
    'cloudRetryFileOperation(id)',
  ]) {
    assert.ok(desktop.includes(token), `Desktop persistent-operation lifecycle missing: ${token}`)
  }
  assert.ok(desktopExplorer.includes('onOperationQueued(result.data)'), 'Desktop Explorer must seed newly queued operations')
})

test('Explorer multi-select copy move delete queue one operation instead of N renderer requests', () => {
  assert.ok(webExplorer.includes('api.createFileOperation(plan.operation, plan.items, plan.parentID)'), 'Web paste/drop is not queued')
  assert.ok(webExplorer.includes('xDriveFileExplorerClipboardOperationPlan('), 'Web paste must use the shared operation plan')
  assert.ok(webExplorer.includes('xDriveFileExplorerDropOperationPlan(operation, nodes, targetNode.id)'), 'Web drag/drop must use the shared operation plan')
  assert.ok(web.includes('xDriveFileExplorerDeleteOperationPlan(nodes)'), 'Web bulk delete must use the shared delete plan')
  assert.ok(web.includes('api.createFileOperation(plan.operation, plan.items)'), 'Web bulk delete is not queued')
  assert.ok(desktopExplorer.includes('window.xdriveDesktop.agent.cloudCreateFileOperation('), 'Desktop paste is not queued')
  assert.ok(desktopExplorer.includes('plan.operation,\n        plan.items,\n        plan.parentID,'), 'Desktop paste/drop must execute the shared operation plan')
  assert.ok(desktopExplorer.includes('xDriveFileExplorerClipboardOperationPlan('), 'Desktop paste must use the shared operation plan')
  assert.ok(desktopExplorer.includes('xDriveFileExplorerDropOperationPlan(operation, nodes, targetNode.id)'), 'Desktop drag/drop must use the shared operation plan')
  assert.ok(desktop.includes('xDriveFileExplorerDeleteOperationPlan(nodes)'), 'Desktop bulk delete must use the shared delete plan')
  assert.ok(desktop.includes('plan.operation,\n            plan.items,'), 'Desktop bulk delete is not queued')
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
