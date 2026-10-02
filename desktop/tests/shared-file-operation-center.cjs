const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const shared = read('ui', 'shared', 'src', 'mui', 'FileOperationCenter.tsx')
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
    'xDriveFileOperationPercent',
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
    '数据量',
    '创建时间',
    '开始时间',
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

test('Web and Desktop both render the shared file-operation center inside Task Center', () => {
  assert.equal((web.match(/<XDriveFileOperationCenter\b/g) || []).length, 1, 'Web must render one shared FileOperationCenter')
  assert.equal((desktopPage.match(/<XDriveFileOperationCenter\b/g) || []).length, 1, 'Desktop must render one shared FileOperationCenter')
  assert.ok(web.includes('title="任务中心"'), 'Web transfer workspace should become Task Center')
  assert.ok(desktopPage.includes('title="任务中心"'), 'Desktop transfer workspace should become Task Center')
  assert.ok(web.includes('<XDriveTransferCenter transfers={transfers} />'), 'Web Task Center must retain upload/download history')
  assert.ok(desktopPage.includes('<XDriveTransferCenter'), 'Desktop Task Center must retain upload/download history')
})

test('Web polls persistent operations and refreshes Explorer only on terminal transitions', () => {
  for (const token of [
    'api.fileOperations(100)',
    'window.setInterval(() => void refresh(), 1500)',
    'xDriveFileOperationActive(previousStatus)',
    '!xDriveFileOperationActive(operation.status)',
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
    'xDriveFileOperationActive(previousStatus)',
    '!xDriveFileOperationActive(operation.status)',
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
  assert.ok(webExplorer.includes("api.createFileOperation(clipboard.mode === 'cut' ? 'move' : 'copy', refs, current.id)"), 'Web paste is not queued')
  assert.ok(webExplorer.includes('api.createFileOperation(operation, refs, targetNode.id)'), 'Web drag/drop is not queued')
  assert.ok(web.includes("const operation = await api.createFileOperation("), 'Web bulk delete is not queued')
  assert.ok(desktopExplorer.includes('window.xdriveDesktop.agent.cloudCreateFileOperation('), 'Desktop paste is not queued')
  assert.ok(desktopExplorer.includes('cloudCreateFileOperation(operation, refs, targetNode.id)'), 'Desktop drag/drop is not queued')
  assert.ok(desktop.includes("window.xdriveDesktop.agent.cloudCreateFileOperation("), 'Desktop bulk delete is not queued')
})
