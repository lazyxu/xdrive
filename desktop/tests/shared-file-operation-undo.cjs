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
const meta = read('internal', 'meta', 'file_operations.go')

test('persistent file-operation model exposes safe undo lineage and selection', () => {
  for (const token of [
    "XDriveFileOperationType = 'copy' | 'move' | 'delete' | 'undo' | 'redo'",
    'undo_of_id?: string',
    'undone_by_id?: string',
    'undoable?: boolean',
    'xDriveLatestUndoableFileOperation',
    "operation.status === 'completed' && operation.undoable",
    "case 'undo': return '撤销文件操作'",
    'undo_conflict',
  ]) assert.ok(model.includes(token), 'shared undo model missing: ' + token)

  for (const token of [
    'FileOperationTypeUndo   = "undo"',
    'UndoOfID',
    'UndoneByID',
    'UndoPlanJSON',
  ]) assert.ok(meta.includes(token), 'server undo persistence missing: ' + token)
})

test('Server persists and executes revision-safe inverse plans for copy move and delete', () => {
  assert.ok(serverRouter.includes('POST("/file-operations/:id/undo", s.undoFileOperation)'), 'Server undo route is missing')
  for (const token of [
    'fileOperationUndoKindCopy',
    'fileOperationUndoKindMove',
    'fileOperationUndoKindDelete',
    'enqueueFileOperationUndo',
    'executeQueuedUndo',
    'executeUndoCopyTx',
    'executeUndoMoveTx',
    'executeUndoDeleteTx',
    'UndoPlanJSON',
    'undone_by_id',
    'undo_conflict',
    'releaseFileOperationUndoReservationTx',
  ]) assert.ok(serverUndo.includes(token), 'Server undo implementation missing: ' + token)

  for (const token of [
    'fileOperationUndoPlan{Kind: fileOperationUndoKindCopy}',
    'hooks.AfterNode',
    'fileOperationUndoPlan{Kind: fileOperationUndoKindMove}',
    'fileOperationUndoPlan{Kind: fileOperationUndoKindDelete}',
    'storeFileOperationUndoPlanTx',
    'case meta.FileOperationTypeUndo:',
    'executeQueuedUndo(operationCtx, operation)',
    'Undoable:          fileOperationUndoable(operation)',
  ]) assert.ok(serverOperation.includes(token), 'file-operation worker undo integration missing: ' + token)
})

test('Undo crosses Web, Go client, Agent, Electron and renderer bridges', () => {
  assert.ok(webApi.includes('undoFileOperation(id: string)'), 'Web undo API is missing')
  assert.ok(webApi.includes('/file-operations/${encodeURIComponent(id)}/undo'), 'Web undo endpoint is missing')
  assert.ok(goClient.includes('func (c *Client) UndoFileOperation'), 'Go client undo method is missing')
  assert.ok(goClient.includes('/api/v1/file-operations/"+url.PathEscape(id)+"/undo'), 'Go client undo endpoint is missing')

  for (const token of [
    'CloudUndoFileOperation',
    'cli.UndoFileOperation(ctx, strings.TrimSpace(id))',
  ]) assert.ok(agentCloud.includes(token), 'Agent cloud undo bridge missing: ' + token)

  for (const token of [
    '"file-operation-undo"',
    'CloudUndoFileOperation(context.Context, string)',
    'POST /v1/cloud/file-operation/undo',
    'cloudUndoFileOperation',
  ]) assert.ok(agentIPC.includes(token), 'Agent IPC undo bridge missing: ' + token)

  assert.ok(agentClient.includes('cloudUndoFileOperation(id: string)'), 'Electron Agent client undo method is missing')
  assert.ok(agentClient.includes("'/v1/cloud/file-operation/undo'"), 'Electron Agent client undo endpoint is missing')
  assert.ok(main.includes("ipcMain.handle('agent:cloud-file-operation-undo'"), 'Electron main undo handler is missing')
  assert.ok(preload.includes("cloudUndoFileOperation: (id: string) => ipcRenderer.invoke('agent:cloud-file-operation-undo', id)"), 'preload undo bridge is missing')
  assert.ok(types.includes('cloudUndoFileOperation: (id: string) => Promise<DesktopResult<AgentCloudFileOperation>>'), 'renderer undo type is missing')
})

test('shared Task Center exposes undo without duplicating Web/Desktop action state', () => {
  for (const token of [
    '`undo:${string}`',
    'undoOperation?: (id: string) => Promise<TOperation>',
    'const undo = useCallback(async (id: string) =>',
    "onFeedback?.('撤销操作已加入队列。')",
    "undoingID: action.startsWith('undo:')",
    'undoOperation: undo',
  ]) assert.ok(actions.includes(token), 'shared undo action orchestration missing: ' + token)

  for (const token of [
    'operation.undoable && onUndo',
    'loading={undoing}',
    'loadingLabel="正在撤销…"',
    '撤销',
  ]) assert.ok(center.includes(token), 'Task Center undo control missing: ' + token)

  for (const token of [
    'operationUndoingID: operationActions.undoingID',
    'void operationActions.undoOperation(id)',
  ]) assert.ok(taskController.includes(token), 'Task Center undo view-model missing: ' + token)

  assert.ok(taskPage.includes('operationUndoingID'), 'Task Center page undo loading id is missing')
  assert.ok(taskPage.includes('onUndoOperation'), 'Task Center page undo callback is missing')
})

test('FileExplorer exposes visible Undo and Ctrl/Cmd+Z without stealing text editing undo', () => {
  for (const token of [
    'onUndo?: () => void',
    'canUndo?: boolean',
    '<UndoRoundedIcon',
    '撤销',
    "modifier && !event.shiftKey && key === 'z' && canUndo && onUndo",
  ]) assert.ok(explorer.includes(token), 'FileExplorer undo affordance missing: ' + token)

  const editable = explorer.indexOf('if (isEditableTarget(event.target)) return')
  const shortcut = explorer.indexOf("modifier && !event.shiftKey && key === 'z' && canUndo && onUndo")
  assert.ok(editable >= 0 && shortcut > editable, 'Ctrl/Cmd+Z must not override native text-input undo')

  for (const [label, app, adapter] of [
    ['Web', webApp, webExplorer],
    ['Desktop', desktopApp, desktopExplorer],
  ]) {
    assert.ok(app.includes('xDriveLatestUndoableFileOperation'), label + ' must select undo from shared operation history')
    assert.ok(adapter.includes('canUndo={canUndo}'), label + ' Explorer must receive the shared undo availability')
    assert.ok(adapter.includes('onUndo={onUndo}'), label + ' Explorer must receive the shared undo action')
  }
  assert.ok(webApp.includes('undoOperation: (id) => api.undoFileOperation(id)'), 'Web must keep only the REST undo adapter')
  assert.ok(desktopApp.includes("capabilities.includes('file-operation-undo')"), 'Desktop must gate undo on Agent capability')
  assert.ok(desktopApp.includes('cloudUndoFileOperation(id)'), 'Desktop must keep only the Agent undo adapter')
})
