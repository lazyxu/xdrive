const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const shared = read('ui', 'shared', 'src', 'mui', 'TransferCenter.tsx')
const taskCenter = read('ui', 'shared', 'src', 'mui', 'TaskCenterPage.tsx')
const actionController = read('ui', 'shared', 'src', 'mui', 'FileOperationActions.ts')
const taskCenterController = read('ui', 'shared', 'src', 'mui', 'TaskCenterController.ts')
const sidebarNav = read('ui', 'shared', 'src', 'mui', 'SidebarNav.tsx')
const sharedModel = read('ui', 'shared', 'src', 'transfers.ts')
const desktop = read('desktop', 'src', 'renderer', 'App.tsx')
const web = read('web', 'src', 'App.tsx')
const webApi = read('web', 'src', 'api.ts')
const webStore = read('web', 'src', 'transfers.ts')
const agentCloudFiles = read('cmd', 'xdrive-agent', 'cloud_files.go')
const agentController = read('cmd', 'xdrive-agent', 'controller.go')
const agentIPC = read('cmd', 'xdrive-agent', 'desktop_ipc.go')
const transferModel = read('internal', 'transfer', 'model.go')
const desktopPreload = read('desktop', 'src', 'preload', 'index.cts')

test('shared transfer center exposes detailed progress and history fields', () => {
  for (const token of [
    'XDriveTransferCenter',
    'LinearProgress',
    '当前大小',
    '总大小',
    '百分比',
    '状态',
    '开始时间',
    '已耗时',
    '预计剩余',
    '完成时间',
    '当前速度',
    '平均速度',
    '进行中',
    '已完成',
    '失败',
  ]) {
    assert.ok(shared.includes(token), `shared transfer center missing: ${token}`)
  }
  assert.ok(sharedModel.includes('xDriveTransferEtaMs'), 'shared transfer model must calculate ETA')
  assert.ok(sharedModel.includes("direction: 'upload' | 'download' | 'local' | string"), 'shared transfer direction contract is missing')
})

test('Web and Desktop both render the shared task center workspace', () => {
  assert.ok(taskCenter.includes('XDriveFileOperationCenter'), 'shared task center must render file operations')
  assert.ok(taskCenter.includes('XDriveTransferCenter'), 'shared task center must render transfers')
  assert.ok(taskCenter.includes('清空历史'), 'shared task center must own the unified clear-history action')
  assert.ok(taskCenter.includes('loading={clearHistory.loading}'), 'shared task center clear-history action must expose loading state')
  assert.ok(taskCenter.includes('loadingLabel="正在清空…"'), 'shared task center clear-history action must expose loading feedback')
  assert.equal((desktop.match(/<XDriveTaskCenterPage\b/g) || []).length, 1, 'Desktop must render the shared task center directly')
  assert.equal(fs.existsSync(path.join(repo, 'desktop', 'src', 'renderer', 'DesktopTransfersPage.tsx')), false, 'Desktop must not keep a pass-through Task Center wrapper')
  assert.equal((web.match(/<XDriveTaskCenterPage\b/g) || []).length, 1, 'Web must render the shared task center')
  assert.equal((desktop.match(/<XDriveTransferCenter\b/g) || []).length, 0, 'Desktop must not duplicate the transfer-center workspace')
  assert.equal((web.match(/<XDriveTransferCenter\b/g) || []).length, 0, 'Web must not duplicate the transfer-center workspace')
  assert.ok(sidebarNav.includes('primary="传输"'), 'shared core navigation must expose Transfers')
  assert.ok(web.includes('<XDriveWorkspaceSidebar'), 'Web must consume the shared workspace sidebar')
  assert.ok(desktop.includes('<XDriveWorkspaceSidebar'), 'Desktop must consume the shared workspace sidebar')
})

test('Web upload and download operations feed persistent transfer history', () => {
  assert.ok(webApi.includes('webTransferStore.create'), 'Web API must create transfer records')
  assert.ok(webApi.includes("kind: 'upload'"), 'Web upload must be tracked')
  assert.ok(webApi.includes("kind: 'download'"), 'Web download must be tracked')
  assert.ok(webApi.includes('response.body.getReader()'), 'Web download must stream bytes for progress reporting')
  assert.ok(webApi.includes('webTransferStore.progress'), 'Web API must publish byte progress')
  assert.ok(webApi.includes('webTransferStore.complete'), 'Web API must persist completed transfers')
  assert.ok(webApi.includes('webTransferStore.fail'), 'Web API must persist failed transfers')
  assert.ok(webStore.includes("xdrive.web.transfer_history"), 'Web transfer history must survive navigation/reload')
  assert.ok(webStore.includes('MAX_HISTORY = 200'), 'Web transfer history must be bounded')
  assert.ok(webStore.includes('页面刷新后无法继续跟踪该传输'), 'stale active Web transfers must fail closed after reload')
})


test('Desktop manual upload and download operations feed the Agent transfer manager', () => {
  assert.ok(agentCloudFiles.includes('transfer.KindUpload'), 'Desktop manual upload must create an upload transfer')
  assert.ok(agentCloudFiles.includes('UploadFileResumable(ctx'), 'Desktop manual upload must report resumable byte progress')
  assert.ok(agentCloudFiles.includes('transfer.KindDownload'), 'Desktop manual download must create a download transfer')
  assert.ok(agentCloudFiles.includes('DownloadToProgress(ctx'), 'Desktop manual download must report streamed byte progress')
  assert.ok(agentCloudFiles.includes('finishAgentCloudTransfer'), 'Desktop manual transfers must retain success/failure history')
})

test('unified Task Center history clearing preserves active work on Web and Desktop', () => {
  assert.ok(webApi.includes("clearFileOperationHistory()"), 'Web API must expose server file-operation history clearing')
  assert.ok(webApi.includes("method: 'DELETE'"), 'Web file-operation history clearing must use DELETE')
  assert.ok(actionController.includes('await clearOperationHistory()'), 'shared action controller must orchestrate file-operation history clearing')
  assert.ok(actionController.includes('const transferResult = await clearTransferHistory()'), 'shared action controller must orchestrate transfer-history clearing')
  assert.ok(actionController.includes('await refreshOperations()'), 'shared action controller must refresh operation state after history clearing')
  assert.ok(web.includes('clearOperationHistory: () => api.clearFileOperationHistory()'), 'Web must keep server history clearing in its REST adapter')
  assert.ok(web.includes('clearTransferHistory: async () => { api.clearTransferHistory() }'), 'Web must keep local transfer-history clearing in its adapter')
  assert.ok(taskCenterController.includes('loading: operationActions.clearHistoryLoading'), 'shared Task Center controller must expose clear-history loading state')
  assert.ok(web.includes('operationActions: fileOperationActions'), 'Web must delegate Task Center action presentation to the shared controller')

  assert.ok(transferModel.includes('func (m *Manager) ClearHistory()'), 'Desktop transfer manager must have history-only clearing')
  assert.ok(transferModel.includes('StateCompleted || e.task.State == StateFailed'), 'Desktop transfer history clearing must target only terminal transfers')
  assert.ok(agentController.includes('c.transfers.ClearHistory()'), 'Desktop controller must use history-only transfer clearing')
  assert.ok(agentIPC.includes('DELETE /v1/transfers'), 'Desktop Agent IPC must expose transfer history clearing')
  assert.ok(agentIPC.includes('DELETE /v1/cloud/file-operations'), 'Desktop Agent IPC must expose file-operation history clearing')
  assert.ok(desktopPreload.includes("clearTransferHistory: () => ipcRenderer.invoke('agent:clear-transfer-history')"), 'Desktop preload transfer-history bridge is missing')
  assert.ok(desktopPreload.includes("cloudClearFileOperationHistory: () => ipcRenderer.invoke('agent:cloud-file-operations-clear')"), 'Desktop preload file-operation-history bridge is missing')
  assert.ok(desktop.includes('window.xdriveDesktop.agent.cloudClearFileOperationHistory()'), 'Desktop must keep server history clearing in its Agent adapter')
  assert.ok(desktop.includes('window.xdriveDesktop.agent.clearTransferHistory()'), 'Desktop must keep transfer-history clearing in its Agent adapter')
  assert.ok(desktop.includes('onTransferHistoryCleared: setTransfers'), 'Desktop must apply the cleared transfer-history result locally')
  assert.ok(desktop.includes('operationActions: fileOperationActions'), 'Desktop must delegate Task Center action presentation to the shared controller')
})
