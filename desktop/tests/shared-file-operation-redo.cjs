const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const model = read('ui', 'shared', 'src', 'file-operations.ts')
const actions = read('ui', 'shared', 'src', 'mui', 'FileOperationActions.ts')
const center = read('ui', 'shared', 'src', 'mui', 'FileOperationCenter.tsx')
const taskController = read('ui', 'shared', 'src', 'mui', 'TaskCenterController.ts')
const taskPage = read('ui', 'shared', 'src', 'mui', 'TaskCenterPage.tsx')
const explorer = read('ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
const webApi = read('web', 'src', 'api.ts')
const webApp = read('web', 'src', 'App.tsx')
const webExplorer = read('web', 'src', 'WebFileExplorer.tsx')
const desktopApp = read('desktop', 'src', 'renderer', 'App.tsx')
const desktopExplorer = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
const main = read('desktop', 'src', 'main', 'index.cts')
const preload = read('desktop', 'src', 'preload', 'index.cts')
const types = read('desktop', 'src', 'renderer', 'global.d.ts')
const agentClient = read('desktop', 'src', 'main', 'agent_client.cts')
const agentCloud = read('cmd', 'xdrive-agent', 'cloud_files.go')
const agentIPC = read('cmd', 'xdrive-agent', 'desktop_ipc.go')
const goClient = read('internal', 'client', 'client.go')
const serverRouter = read('internal', 'api', 'router.go')
const serverOperation = read('internal', 'api', 'file_operations.go')
const serverUndo = read('internal', 'api', 'file_operations_undo.go')
const serverRedo = read('internal', 'api', 'file_operations_redo.go')
const meta = read('internal', 'meta', 'file_operations.go')

test('persistent operation model exposes redo lineage and bidirectional selection', () => {
  for (const token of [
    "XDriveFileOperationType = 'copy' | 'move' | 'delete' | 'undo' | 'redo'",
    'redo_of_id?: string',
    'redone_by_id?: string',
    'redoable?: boolean',
    'xDriveLatestRedoableFileOperation',
    "operation.status === 'completed' && operation.redoable",
    "operation.type === 'undo' || operation.type === 'redo'",
    "case 'redo': return '重做文件操作'",
    'redo_conflict',
  ]) assert.ok(model.includes(token), 'shared redo model missing: ' + token)

  for (const token of [
    'FileOperationTypeRedo',
    'RedoOfID',
    'RedoneByID',
    'RedoPlanJSON',
  ]) assert.ok(meta.includes(token), 'server redo persistence missing: ' + token)
})

test('Undo produces an exact redo plan and Redo produces a fresh undo plan', () => {
  for (const token of [
    'redoPlan := fileOperationRedoPlan{Kind: plan.Kind}',
    'storeFileOperationRedoPlanTx',
    'fileOperationRedoTree',
    'fileOperationRedoMove',
    'fileOperationTrashNodeRefsTx',
    'fileOperationNodeRefsWithRevision',
  ]) assert.ok(serverUndo.includes(token), 'Undo-to-Redo projection missing: ' + token)

  for (const token of [
    'fileOperationRedoable',
    'enqueueFileOperationRedo',
    'executeQueuedRedo',
    'executeRedoCopyTx',
    'executeRedoMoveTx',
    'executeRedoDeleteTx',
    'storeFileOperationUndoPlanTx',
    'fileOperationNodeRefsMatch',
    'redo_conflict',
    'releaseFileOperationRedoReservationTx',
    'releaseFileOperationLineageReservationTx',
  ]) assert.ok(serverRedo.includes(token), 'Redo executor missing: ' + token)

  for (const token of [
    'case meta.FileOperationTypeRedo:',
    'executeQueuedRedo(operationCtx, operation)',
    'operation.Type != meta.FileOperationTypeUndo && operation.Type != meta.FileOperationTypeRedo',
    'fileOperationRedoable(operation)',
    'Redoable:',
    'cancellingLineageOperations',
    'releaseFileOperationLineageReservationTx',
  ]) assert.ok(serverOperation.includes(token), 'persistent worker redo integration missing: ' + token)

  assert.ok(serverRouter.includes('POST("/file-operations/:id/redo", s.redoFileOperation)'), 'Server redo route is missing')
})

test('Redo crosses Web, Go client, Agent, Electron and renderer bridges', () => {
  assert.ok(webApi.includes('redoFileOperation(id: string)'), 'Web redo API is missing')
  assert.ok(webApi.includes('/file-operations/${encodeURIComponent(id)}/redo'), 'Web redo endpoint is missing')
  assert.ok(goClient.includes('func (c *Client) RedoFileOperation'), 'Go client redo method is missing')
  assert.ok(goClient.includes('/api/v1/file-operations/"+url.PathEscape(id)+"/redo'), 'Go client redo endpoint is missing')

  for (const token of [
    'CloudRedoFileOperation',
    'cli.RedoFileOperation(ctx, strings.TrimSpace(id))',
  ]) assert.ok(agentCloud.includes(token), 'Agent cloud redo bridge missing: ' + token)

  for (const token of [
    '"file-operation-redo"',
    'CloudRedoFileOperation(context.Context, string)',
    'POST /v1/cloud/file-operation/redo',
    'cloudRedoFileOperation',
  ]) assert.ok(agentIPC.includes(token), 'Agent IPC redo bridge missing: ' + token)

  assert.ok(agentClient.includes('cloudRedoFileOperation(id: string)'), 'Electron Agent client redo method is missing')
  assert.ok(agentClient.includes("'/v1/cloud/file-operation/redo'"), 'Electron Agent client redo endpoint is missing')
  assert.ok(main.includes("ipcMain.handle('agent:cloud-file-operation-redo'"), 'Electron main redo handler is missing')
  assert.ok(main.includes("requireAgentCapability(hello, 'file-operation-redo')"), 'Electron main must capability-gate redo')
  assert.ok(preload.includes("cloudRedoFileOperation: (id: string) => ipcRenderer.invoke('agent:cloud-file-operation-redo', id)"), 'preload redo bridge is missing')
  assert.ok(types.includes('cloudRedoFileOperation: (id: string) => Promise<DesktopResult<AgentCloudFileOperation>>'), 'renderer redo type is missing')
})

test('Task Center exposes Redo through the shared action controller', () => {
  for (const token of [
    '`redo:${string}`',
    'redoOperation?: (id: string) => Promise<TOperation>',
    'const redo = useCallback(async (id: string) =>',
    "onFeedback?.('重做操作已加入队列。')",
    "redoingID: action.startsWith('redo:')",
    'redoOperation: redo',
  ]) assert.ok(actions.includes(token), 'shared redo action orchestration missing: ' + token)

  for (const token of [
    'operation.redoable && onRedo',
    'loading={redoing}',
    'loadingLabel="正在重做…"',
    '重做',
  ]) assert.ok(center.includes(token), 'Task Center redo control missing: ' + token)

  for (const token of [
    'operationRedoingID: operationActions.redoingID',
    'void operationActions.redoOperation(id)',
  ]) assert.ok(taskController.includes(token), 'Task Center redo view-model missing: ' + token)

  assert.ok(taskPage.includes('operationRedoingID'), 'Task Center page redo loading id is missing')
  assert.ok(taskPage.includes('onRedoOperation'), 'Task Center page redo callback is missing')
})

test('FileExplorer supports Redo through the shared keyboard command resolver without stealing editor redo', () => {
  for (const token of [
    'onRedo?: () => void',
    'canRedo?: boolean',
    '<RedoRoundedIcon',
    '重做',
    "command === 'redo' && canRedo && onRedo",
    "command === 'undo' && canUndo && onUndo",
  ]) assert.ok(explorer.includes(token), 'FileExplorer redo affordance missing: ' + token)

  const editable = explorer.indexOf('if (isEditableTarget(event.target)) return')
  const redoShortcut = explorer.indexOf("command === 'redo' && canRedo && onRedo")
  assert.ok(editable >= 0 && redoShortcut > editable, 'Redo command must not override native text editing redo')

  for (const [label, app, adapter] of [
    ['Web', webApp, webExplorer],
    ['Desktop', desktopApp, desktopExplorer],
  ]) {
    assert.ok(app.includes('xDriveLatestRedoableFileOperation'), label + ' must select redo from shared operation history')
    assert.ok(adapter.includes('canRedo={!trashActive && canRedo}'), label + ' Explorer must receive shared redo availability')
    assert.ok(adapter.includes('onRedo={trashActive ? undefined : onRedo}'), label + ' Explorer must receive shared redo action')
  }
  assert.ok(webApp.includes('redoOperation: (id) => api.redoFileOperation(id)'), 'Web must keep only the REST redo adapter')
  assert.ok(desktopApp.includes("capabilities.includes('file-operation-redo')"), 'Desktop must gate redo on Agent capability')
  assert.ok(desktopApp.includes('cloudRedoFileOperation(id)'), 'Desktop must keep only the Agent redo adapter')
})
