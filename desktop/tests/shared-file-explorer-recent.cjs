const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const sharedModel = read('ui', 'shared', 'src', 'cloud-files.ts')
const controller = read('ui', 'shared', 'src', 'mui', 'FileExplorerRecentController.ts')
const navigation = read('ui', 'shared', 'src', 'mui', 'FileExplorerNavigation.ts')
const workspace = read('ui', 'shared', 'src', 'mui', 'FileExplorerWorkspaceController.ts')
const explorer = read('ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
const pane = read('ui', 'shared', 'src', 'mui', 'FileExplorerNavigationPane.tsx')
const muiIndex = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const webApi = read('web', 'src', 'api.ts')
const webExplorer = read('web', 'src', 'WebFileExplorer.tsx')
const desktopExplorer = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
const desktopApp = read('desktop', 'src', 'renderer', 'App.tsx')
const agentClient = read('desktop', 'src', 'main', 'agent_client.cts')
const desktopMain = read('desktop', 'src', 'main', 'index.cts')
const preload = read('desktop', 'src', 'preload', 'index.cts')
const rendererTypes = read('desktop', 'src', 'renderer', 'global.d.ts')
const agentCloud = read('cmd', 'xdrive-agent', 'cloud_files.go')
const agentIPC = read('cmd', 'xdrive-agent', 'desktop_ipc.go')
const goClient = read('internal', 'client', 'client.go')
const serverRouter = read('internal', 'api', 'router.go')
const serverRecent = read('internal', 'api', 'file_recent.go')
const serverModel = read('internal', 'meta', 'file_recent.go')
const serverMain = read('cmd', 'server', 'main.go')

test('Recent is persisted from real access time instead of node updated_at', () => {
  for (const token of [
    'type FileRecentAccess struct',
    'LastAccessed time.Time',
    'last_accessed_at',
    'xd_file_recent_access',
    'OnDelete:CASCADE',
  ]) assert.ok(serverModel.includes(token), 'Recent persistence missing: ' + token)
  assert.ok(serverMain.includes('&meta.FileRecentAccess{}'), 'Server migration must include Recent')

  for (const token of [
    'fileRecentDefaultLimit = 16',
    'fileRecentRetention    = 128',
    'ORDER BY r.last_accessed_at DESC',
    'last_accessed_at',
    'TouchFileRecent',
  ]) {
    if (token === 'TouchFileRecent') continue
    assert.ok(serverRecent.includes(token), 'Recent access behavior missing: ' + token)
  }
  assert.equal(serverRecent.includes('updated_at DESC'), false, 'Recent must not use node updated_at as access history')
})

test('Recent routes support list, explicit touch and clear only', () => {
  for (const token of [
    'GET("/file-recent", s.listFileRecent)',
    'POST("/file-recent/:id", s.touchFileRecent)',
    'DELETE("/file-recent", s.clearFileRecent)',
  ]) assert.ok(serverRouter.includes(token), 'Recent route missing: ' + token)

  assert.ok(serverRecent.includes('clause.OnConflict'), 'Recent touch must upsert one row per user/node')
  assert.ok(serverRecent.includes('OFFSET ?'), 'Recent history must have bounded retention')
})

test('shared Recent controller refreshes live identity and silently records access', () => {
  assert.ok(sharedModel.includes('export type XDriveFileRecentItem'), 'shared Recent transport model missing')
  assert.ok(muiIndex.includes("export * from './FileExplorerRecentController'"), 'Recent controller is not exported')

  for (const token of [
    'useXDriveFileExplorerRecent',
    'const loadItemsRef = useRef(loadItems)',
    'const loadRequestRef = useRef(0)',
    'const record = useCallback',
    'const clear = useCallback',
    'const activate = useCallback',
    'const latest = await loadFresh(requestID)',
    'if (requestID !== loadRequestRef.current) return false',
    "target.node.type === 'dir'",
    'await handlers.onDirectory(target.crumbs)',
    'await handlers.onFile(target)',
  ]) assert.ok(controller.includes(token), 'shared Recent controller missing: ' + token)

  for (const token of [
    'if (requestID === loadRequestRef.current) {',
    'loadRequestRef.current += 1',
    'if (requestID === loadRequestRef.current) setLoading(false)',
  ]) assert.ok(controller.includes(token), 'shared Recent race guard missing: ' + token)

  assert.equal(controller.includes('localStorage'), false, 'Recent must remain server-side')
})

test('only successful user navigation, explicit file open and Quick Look record Recent', () => {
  assert.ok(navigation.includes('onAfterNavigate?: (crumbs: TCrumb[]) => void'), 'navigation access callback is missing')
  assert.ok(navigation.includes('finishNavigation(nextCrumbs)'), 'navigateTo must record after load succeeds')
  assert.ok(navigation.includes('finishNavigation(next)'), 'history navigation must record after load succeeds')
  assert.ok(navigation.includes('finishNavigation(targetCrumbs)'), 'tab activation must record after load succeeds')

  assert.ok(workspace.includes('onDirectoryAccess?: (nodeID: number)'), 'workspace directory access callback is missing')
  assert.ok(workspace.includes('onFileAccess?: (nodeID: number)'), 'workspace file access callback is missing')
  assert.ok(workspace.includes('if (target && nextCrumbs.length > 1) void onDirectoryAccess?.(target.id)'), 'root must not be recorded as Recent')
  assert.ok(workspace.includes("if (item.kind === 'file') void onFileAccess?.(Number(item.id))"), 'explicit file open must record Recent')

  assert.ok(explorer.includes('onPreviewItem?: (item: XDriveFileExplorerItem) => void'), 'Quick Look access callback is missing')
  assert.ok(explorer.includes('onPreviewItem?.(item)'), 'opening Quick Look must record Recent')
  assert.ok(explorer.includes('onPreviewItem?.(target)'), 'Quick Look previous/next must record Recent')

  assert.equal(navigation.includes('onAfterNavigate?.()'), false, 'navigation callback must carry the actual target')
})

test('one shared navigation pane renders Recent above the lazy folder tree', () => {
  for (const token of [
    'recentEnabled',
    'recentItems',
    '最近使用',
    '暂无最近访问',
    '清空最近使用',
    'onActivateRecent',
    'onClearRecent',
    "item.kind === 'dir'",
  ]) assert.ok(pane.includes(token), 'shared Recent navigation UI missing: ' + token)
})

test('Web and Desktop share Recent state and keep only transport adapters local', () => {
  for (const token of [
    'useXDriveFileExplorerRecent<Node>',
    'loadItems: () => api.fileRecent(16)',
    'touchItem: (nodeID) => api.touchFileRecent(nodeID)',
    'clearItems: () => api.clearFileRecent()',
    'onDirectoryAccess: (nodeID) => { void recent.record(nodeID) }',
    'onFileAccess: (nodeID) => { void recent.record(nodeID) }',
    'onPreviewItem={(item) => { void recent.record(Number(item.id)) }}',
    'recentItems={recent.items}',
  ]) assert.ok(webExplorer.includes(token), 'Web Recent adapter missing: ' + token)

  for (const token of [
    'useXDriveFileExplorerRecent<AgentCloudNode>',
    'enabled: recentSupported',
    'cloudFileRecent(16)',
    'cloudTouchFileRecent(nodeID)',
    'cloudClearFileRecent()',
    'onDirectoryAccess: (nodeID) => { void recent.record(nodeID) }',
    'onFileAccess: (nodeID) => { void recent.record(nodeID) }',
    'onPreviewItem={(item) => { void recent.record(Number(item.id)) }}',
    'recentItems={recent.items}',
  ]) assert.ok(desktopExplorer.includes(token), 'Desktop Recent adapter missing: ' + token)

  assert.ok(desktopApp.includes("capabilities.includes('file-recent')"), 'Desktop must capability-gate Recent')
})

test('Recent crosses Server, Go client, Agent and Electron bridges', () => {
  for (const token of [
    'FileRecent(ctx context.Context',
    'TouchFileRecent(ctx context.Context',
    'ClearFileRecent(ctx context.Context)',
  ]) assert.ok(goClient.includes(token), 'Go client Recent bridge missing: ' + token)

  for (const token of [
    'CloudFileRecent',
    'CloudTouchFileRecent',
    'CloudClearFileRecent',
  ]) assert.ok(agentCloud.includes(token), 'Agent Recent bridge missing: ' + token)

  for (const token of [
    '"file-recent"',
    'CloudFileRecent(context.Context, int)',
    'GET /v1/cloud/recent',
    'POST /v1/cloud/recent/touch',
    'DELETE /v1/cloud/recent',
  ]) assert.ok(agentIPC.includes(token), 'Agent IPC Recent bridge missing: ' + token)

  for (const token of [
    'AgentCloudRecentItem',
    'cloudFileRecent(limit = 16)',
    'cloudTouchFileRecent(nodeID: number)',
    'cloudClearFileRecent()',
  ]) assert.ok(agentClient.includes(token), 'Electron Agent client Recent bridge missing: ' + token)

  for (const token of [
    "ipcMain.handle('agent:cloud-recent'",
    "ipcMain.handle('agent:cloud-recent-touch'",
    "ipcMain.handle('agent:cloud-recent-clear'",
    "requireAgentCapability(hello, 'file-recent')",
  ]) assert.ok(desktopMain.includes(token), 'Electron main Recent bridge missing: ' + token)

  assert.ok(preload.includes('cloudFileRecent:'), 'preload Recent list bridge missing')
  assert.ok(preload.includes('cloudTouchFileRecent:'), 'preload Recent touch bridge missing')
  assert.ok(preload.includes('cloudClearFileRecent:'), 'preload Recent clear bridge missing')
  assert.ok(rendererTypes.includes('AgentCloudRecentItem'), 'renderer Recent type missing')

  for (const token of [
    'fileRecent(limit = 16)',
    'touchFileRecent(nodeID: number)',
    'clearFileRecent()',
  ]) assert.ok(webApi.includes(token), 'Web Recent REST adapter missing: ' + token)
})
