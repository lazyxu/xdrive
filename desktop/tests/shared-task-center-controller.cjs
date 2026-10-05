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
