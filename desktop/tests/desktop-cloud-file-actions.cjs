const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const main = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'main', 'index.cts'), 'utf8')
const preload = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'preload', 'index.cts'), 'utf8')
const types = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'renderer', 'global.d.ts'), 'utf8')
const agentClient = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'main', 'agent_client.cts'), 'utf8')
const agentIPC = fs.readFileSync(path.join(repoRoot, 'cmd', 'xdrive-agent', 'desktop_ipc.go'), 'utf8')
const cloudFiles = fs.readFileSync(path.join(repoRoot, 'cmd', 'xdrive-agent', 'cloud_files.go'), 'utf8')

test('Desktop exposes real cloud file mutation primitives through Agent IPC', () => {
  for (const token of [
    'CloudCreateDir(context.Context',
    'CloudRename(context.Context',
    'CloudCopy(context.Context',
    'CloudMove(context.Context',
    'CloudDelete(context.Context',
    'CloudUpload(context.Context',
    'CloudDownload(context.Context',
    'POST /v1/cloud/directories',
    'PATCH /v1/cloud/nodes',
    'POST /v1/cloud/copy',
    'PATCH /v1/cloud/move',
    'DELETE /v1/cloud/nodes',
    'POST /v1/cloud/upload',
    'POST /v1/cloud/download',
  ]) {
    assert.ok(agentIPC.includes(token), `missing Desktop Agent IPC cloud capability: ${token}`)
  }
  assert.ok(cloudFiles.includes('cli.CreateDir(ctx, parentID, name)'), 'cloud directory creation does not use the real client')
  assert.ok(cloudFiles.includes('cli.RenameMove(ctx, id, revision, &name, nil)'), 'cloud rename does not use optimistic-concurrency client mutation')
  assert.ok(cloudFiles.includes('cli.Copy(ctx, id, parentID, nil)'), 'cloud copy does not use the server-side copy primitive')
  assert.ok(cloudFiles.includes('cli.Move(ctx, id, revision, parentID)'), 'cloud move does not use revision-safe move')
  assert.ok(cloudFiles.includes('cli.Delete(ctx, id, revision)'), 'cloud delete does not use the real client')
  assert.ok(cloudFiles.includes('cli.UploadFileResumable(ctx, parentID, localPath, name, progress)'), 'cloud upload does not use resumable progress-aware client upload')
  assert.ok(cloudFiles.includes('cli.DownloadToProgress(ctx, id, tmp, progress)'), 'cloud download does not use authenticated progress-aware client download')
})

test('Desktop renderer never chooses or receives raw local paths for cloud transfer actions', () => {
  assert.ok(main.includes("dialog.showOpenDialog(mainWindow, options)"), 'cloud upload must use the native Electron file picker')
  assert.ok(main.includes("dialog.showSaveDialog(mainWindow, options)"), 'cloud download must use the native Electron save picker')
  assert.ok(main.includes("ipcMain.handle('agent:cloud-upload-files'"), 'main process upload orchestration is missing')
  assert.ok(main.includes("ipcMain.handle('agent:cloud-download'"), 'main process download orchestration is missing')
  assert.ok(preload.includes("cloudUploadFiles: (parentID: number) =>"), 'renderer upload API should accept only the cloud parent id')
  assert.ok(preload.includes("cloudDownload: (id: number, name: string) =>"), 'renderer download API should expose only cloud identity/name')
  assert.equal(preload.includes('cloudUpload: (parentID: number, localPath'), false, 'renderer must not provide arbitrary upload paths')
  assert.equal(preload.includes('cloudDownload: (id: number, destination'), false, 'renderer must not provide arbitrary download destinations')
})

test('Desktop cloud transfer paths are validated inside the Agent boundary', () => {
  assert.ok(cloudFiles.includes('filepath.IsAbs(localPath)'), 'Agent must reject relative upload paths')
  assert.ok(cloudFiles.includes('info.Mode().IsRegular()'), 'Agent must reject non-file upload paths')
  assert.ok(cloudFiles.includes('filepath.IsAbs(destination)'), 'Agent must reject relative download destinations')
  assert.ok(cloudFiles.includes('os.CreateTemp(parent, ".xdrive-download-*")'), 'downloads should stage into a temporary file before replacement')
  assert.ok(cloudFiles.includes('tmp.Chmod(0o600)'), 'download staging files should use private permissions')
  assert.ok(cloudFiles.includes('replaceDownloadedFile(tmpPath, destination)'), 'completed downloads should use the safe replacement helper')
  assert.ok(cloudFiles.includes('os.Rename(destination, backupPath)'), 'existing downloads should be backed up before replacement')
  assert.ok(cloudFiles.includes('os.Rename(backupPath, destination)'), 'failed replacement should restore the previous file')
})

test('Desktop cloud action types expose upload failures without local path leakage', () => {
  assert.ok(types.includes('type AgentCloudUploadBatchResult = {'), 'upload batch result type is missing')
  assert.ok(types.includes('failures: Array<{ name: string; message: string }>'), 'upload failures should expose filename and message only')
  assert.ok(types.includes('cloudCreateDirectory:'), 'create-directory renderer type is missing')
  assert.ok(types.includes('cloudRename:'), 'rename renderer type is missing')
  assert.ok(types.includes('cloudCopy:'), 'copy renderer type is missing')
  assert.ok(types.includes('cloudMove:'), 'move renderer type is missing')
  assert.ok(types.includes('cloudDelete:'), 'delete renderer type is missing')
  assert.ok(types.includes('cloudUploadFiles:'), 'upload renderer type is missing')
  assert.ok(types.includes('cloudDownload:'), 'download renderer type is missing')
  assert.ok(agentClient.includes('6 * 60 * 60 * 1000'), 'large cloud transfers need a long IPC timeout')
})

test('Desktop bulk download chooses one target directory and avoids renderer path exposure', () => {
  assert.ok(main.includes("ipcMain.handle('agent:cloud-download-files'"), 'Desktop main bulk-download handler is missing')
  assert.ok(main.includes("properties: ['openDirectory', 'createDirectory']"), 'bulk download should choose one destination directory')
  assert.ok(main.includes('await access(path.join(directory, candidate))'), 'bulk download should avoid overwriting existing files')
  assert.ok(main.includes("candidate = \`${stem} (${index})${ext}\`"), 'bulk download should disambiguate duplicate names')
  assert.ok(preload.includes("cloudDownloadFiles: (files: Array<{ id: number; name: string }>) =>"), 'renderer bulk-download contract is missing')
  assert.ok(types.includes('type AgentCloudDownloadBatchResult = {'), 'bulk-download result type is missing')
  assert.equal(preload.includes('cloudDownloadFiles: (files: Array<{ id: number; name: string; destination'), false, 'renderer must not supply bulk-download local paths')
})

test('Desktop uploads dropped files through webUtils without exposing arbitrary renderer paths', () => {
  assert.ok(preload.includes('webUtils'), 'preload must import Electron webUtils')
  assert.ok(preload.includes('webUtils.getPathForFile('), 'preload must resolve dropped File objects through webUtils')
  assert.ok(preload.includes("'agent:cloud-upload-paths'"), 'preload dropped-file upload channel is missing')
  assert.ok(main.includes("ipcMain.handle('agent:cloud-upload-paths'"), 'main dropped-file upload handler is missing')
  assert.ok(main.includes('!path.isAbsolute(value)'), 'main must reject non-absolute dropped-file paths')
  assert.ok(main.includes('await requireAgentClient().cloudUpload(parentID, localPath, name)'), 'dropped files must use authenticated Agent upload')
  assert.ok(types.includes('cloudUploadDroppedFiles: (parentID: number, files: File[])'), 'renderer dropped-file API should expose File[] instead of local paths')
  assert.equal(types.includes('cloudUploadDroppedFiles: (parentID: number, paths:'), false, 'renderer must not receive raw dropped-file paths')
})

test('Desktop Agent bridge exposes cursor-paged cloud children without changing the legacy list contract', () => {
  assert.ok(agentClient.includes('cloudChildrenPage(parentID: number, options: {'), 'Desktop AgentClient paged children method is missing')
  assert.ok(agentClient.includes("return this.request<AgentCloudChildrenPage>('GET'"), 'Desktop AgentClient should return a page contract')
  assert.ok(main.includes("ipcMain.handle('agent:cloud-children-page'"), 'Electron main paged children bridge is missing')
  assert.ok(preload.includes('cloudChildrenPage: ('), 'preload paged children bridge is missing')
  assert.ok(types.includes('type AgentCloudChildrenPage = XDriveCloudFilesPage<AgentCloudNode>'), 'renderer paged children type must alias the shared contract')
  assert.ok(types.includes('cloudChildren: (parentID: number)'), 'legacy cloudChildren contract should remain available')
})

test('Desktop search preserves cursor pages through Agent and Electron bridges', () => {
  assert.ok(agentIPC.includes('CloudSearch(context.Context, string, string) (agentCloudSearchPage, error)'), 'Agent IPC search page contract is missing')
  assert.ok(cloudFiles.includes('Cursor: strings.TrimSpace(cursor)'), 'Agent controller must forward the search cursor to the Go client')
  assert.ok(agentClient.includes('export type AgentCloudSearchPage = {'), 'Electron AgentClient search page type is missing')
  assert.ok(agentClient.includes("cloudSearch(queryText: string, cursor = '')"), 'Electron AgentClient cursor search method is missing')
  assert.ok(agentClient.includes("query.set('cursor', cursor.trim())"), 'Electron AgentClient must forward the search cursor')
  assert.ok(main.includes("runAgentAction<AgentCloudSearchPage>"), 'Electron main must preserve the search page result')
  assert.ok(preload.includes("cloudSearch: (query: string, cursor = '')"), 'preload search cursor bridge is missing')
  assert.ok(types.includes('type AgentCloudSearchPage = XDriveCloudFilesSearchPage<AgentCloudNode>'), 'renderer search page type must alias the shared contract')
  assert.ok(types.includes('cloudSearch: (query: string, cursor?: string) => Promise<DesktopResult<AgentCloudSearchPage>>'), 'renderer search page method type is missing')
})

test('Desktop exposes atomic cloud batch mutations through every IPC layer', () => {
  for (const token of [
    'CloudBatchCopy(context.Context, []client.BatchNodeRef, uint64)',
    'CloudBatchMove(context.Context, []client.BatchNodeRef, uint64)',
    'CloudBatchDelete(context.Context, []client.BatchNodeRef)',
    'POST /v1/cloud/batch/copy',
    'POST /v1/cloud/batch/move',
    'POST /v1/cloud/batch/delete',
  ]) {
    assert.ok(agentIPC.includes(token), `missing Agent batch IPC contract: ${token}`)
  }
  for (const token of [
    'cloudBatchCopy(items: AgentCloudBatchNodeRef[], parentID: number)',
    'cloudBatchMove(items: AgentCloudBatchNodeRef[], parentID: number)',
    'cloudBatchDelete(items: AgentCloudBatchNodeRef[])',
  ]) {
    assert.ok(agentClient.includes(token), `missing Electron Agent batch client: ${token}`)
  }
  assert.ok(main.includes("ipcMain.handle('agent:cloud-batch-copy'"), 'main batch-copy handler is missing')
  assert.ok(main.includes("ipcMain.handle('agent:cloud-batch-move'"), 'main batch-move handler is missing')
  assert.ok(main.includes("ipcMain.handle('agent:cloud-batch-delete'"), 'main batch-delete handler is missing')
  assert.ok(main.includes('normalizeCloudBatchItems(items)'), 'main must validate renderer batch items')
  assert.ok(preload.includes('cloudBatchCopy: (items: Array<{ id: number; revision: number }>, parentID: number)'), 'preload batch-copy bridge is missing')
  assert.ok(types.includes('type AgentCloudBatchResult = {'), 'renderer batch result type is missing')
  assert.ok(types.includes('cloudBatchDelete: (items: AgentCloudBatchNodeRef[])'), 'renderer batch-delete method type is missing')
})


test('Desktop exposes persistent file-operation lifecycle through every bridge layer', () => {
  for (const token of [
    'CloudCreateFileOperation(context.Context, string, []client.BatchNodeRef, uint64)',
    'CloudFileOperations(context.Context, int)',
    'CloudFileOperation(context.Context, string)',
    'CloudCancelFileOperation(context.Context, string)',
    'CloudRetryFileOperation(context.Context, string)',
    'CloudClearFileOperationHistory(context.Context)',
    'POST /v1/cloud/file-operations',
    'GET /v1/cloud/file-operations',
    'DELETE /v1/cloud/file-operations',
    'GET /v1/cloud/file-operation',
    'POST /v1/cloud/file-operation/cancel',
    'POST /v1/cloud/file-operation/retry',
  ]) {
    assert.ok(agentIPC.includes(token), `missing Agent file-operation IPC contract: ${token}`)
  }

  for (const token of [
    'cli.CreateFileOperation(ctx, operationType, items, parentID)',
    'cli.ListFileOperations(ctx, limit)',
    'cli.GetFileOperation(ctx, strings.TrimSpace(id))',
    'cli.CancelFileOperation(ctx, strings.TrimSpace(id))',
    'cli.RetryFileOperation(ctx, strings.TrimSpace(id))',
    'cli.ClearFileOperationHistory(ctx)',
  ]) {
    assert.ok(cloudFiles.includes(token), `Agent controller is not using the Go file-operation client: ${token}`)
  }

  for (const token of [
    "cloudCreateFileOperation(type: AgentCloudFileOperation['type'], items: AgentCloudBatchNodeRef[], parentID?: number)",
    'cloudFileOperations(limit = 100)',
    'cloudFileOperation(id: string)',
    'cloudCancelFileOperation(id: string)',
    'cloudRetryFileOperation(id: string)',
    'cloudClearFileOperationHistory()',
  ]) {
    assert.ok(agentClient.includes(token), `missing Electron Agent file-operation client: ${token}`)
  }

  for (const token of [
    "ipcMain.handle('agent:cloud-file-operation-create'",
    "ipcMain.handle('agent:cloud-file-operations'",
    "ipcMain.handle('agent:cloud-file-operation'",
    "ipcMain.handle('agent:cloud-file-operation-cancel'",
    "ipcMain.handle('agent:cloud-file-operation-retry'",
    "ipcMain.handle('agent:cloud-file-operations-clear'",
    'normalizeCloudBatchItems(items)',
    'normalizeCloudFileOperationType(type)',
  ]) {
    assert.ok(main.includes(token), `missing validated Electron file-operation bridge: ${token}`)
  }

  assert.ok(preload.includes('cloudCreateFileOperation:'), 'preload create-operation bridge is missing')
  assert.ok(preload.includes('cloudFileOperations:'), 'preload operation-list bridge is missing')
  assert.ok(preload.includes('cloudCancelFileOperation:'), 'preload cancel-operation bridge is missing')
  assert.ok(preload.includes('cloudRetryFileOperation:'), 'preload retry-operation bridge is missing')
  assert.ok(preload.includes('cloudClearFileOperationHistory:'), 'preload clear-operation-history bridge is missing')
  assert.ok(types.includes('type AgentCloudFileOperation = XDriveFileOperation'), 'renderer shared operation type alias is missing')
  assert.ok(types.includes('cloudCreateFileOperation:'), 'renderer create-operation method type is missing')
  assert.ok(types.includes('cloudFileOperations:'), 'renderer operation-list method type is missing')
})

test('legacy synchronous batch mutation bridges remain available for compatibility', () => {
  for (const token of [
    'cloudBatchCopy(items: AgentCloudBatchNodeRef[], parentID: number)',
    'cloudBatchMove(items: AgentCloudBatchNodeRef[], parentID: number)',
    'cloudBatchDelete(items: AgentCloudBatchNodeRef[])',
  ]) {
    assert.ok(agentClient.includes(token), `legacy Electron batch client was removed: ${token}`)
  }
  assert.ok(main.includes("ipcMain.handle('agent:cloud-batch-copy'"), 'legacy batch-copy handler was removed')
  assert.ok(main.includes("ipcMain.handle('agent:cloud-batch-move'"), 'legacy batch-move handler was removed')
  assert.ok(main.includes("ipcMain.handle('agent:cloud-batch-delete'"), 'legacy batch-delete handler was removed')
})


test('Desktop Task Center clears only terminal transfer history through every bridge layer', () => {
  assert.ok(agentIPC.includes('ClearTransferHistory() (uint64, []transfer.Task)'), 'Agent IPC controller clear-history contract is missing')
  assert.ok(agentIPC.includes('DELETE /v1/transfers'), 'Agent IPC transfer-history route is missing')
  assert.ok(agentClient.includes('clearTransferHistory()'), 'Electron AgentClient transfer-history method is missing')
  assert.ok(main.includes("ipcMain.handle('agent:clear-transfer-history'"), 'Electron main transfer-history bridge is missing')
  assert.ok(preload.includes('clearTransferHistory:'), 'preload transfer-history bridge is missing')
  assert.ok(types.includes('clearTransferHistory: () => Promise<DesktopResult<AgentTransfers>>'), 'renderer transfer-history type is missing')
})
