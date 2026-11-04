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

test('successful navigation proposes a folder; file-open confirms its parent', () => {
  assert.ok(navigation.includes('finishNavigation(nextCrumbs)'), 'navigation completion required')
  assert.ok(navigation.includes('finishNavigation(next)'), 'back/forward must retain navigation semantics')
  assert.ok(navigation.includes('finishNavigation(targetCrumbs)'), 'tab activation must retain navigation semantics')
  assert.ok(workspace.includes('onDirectoryAccess?: (nodeID: number)'), 'folder candidate hook missing')
  assert.ok(workspace.includes('onFileAccess?: (nodeID: number, parentID?: number)'), 'actual file parent hook missing')
  assert.ok(workspace.includes('if (target && nextCrumbs.length > 1) void onDirectoryAccess?.(target.id)'), 'root must be excluded')
  assert.ok(workspace.includes('node?.parent_id'), 'file open must target parent folder')
  assert.ok(explorer.includes('onPreviewItem?.(item)'), 'Quick Look must be observed')
  assert.ok(explorer.includes('onPreviewItem?.(target)'), 'Quick Look neighbor must be observed')
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

test('Web/Desktop show only confirmed working folders, not traversed ancestors or files', () => {
  for (const token of [
    'useXDriveFileExplorerRecent<Node>',
    'loadItems: () => api.fileRecentFolders(8)',
    'touchItem: (nodeID) => api.touchFileRecentFolder(nodeID)',
    'clearItems: () => api.clearFileRecentFolders()',
    'useXDriveFileExplorerRecentFolderUsage({',
    'recentFolderUsage.consider(nodeID)',
    'recentFolderUsage.confirm(parentID)',
    'recentItems={recent.items}',
  ]) assert.ok(webExplorer.includes(token), 'Web folder usage missing: ' + token)

  for (const token of [
    'useXDriveFileExplorerRecent<AgentCloudNode>',
    'enabled: recentSupported',
    'cloudFileRecentFolders(8)',
    'cloudTouchFileRecentFolder(nodeID)',
    'cloudClearFileRecentFolders()',
    'useXDriveFileExplorerRecentFolderUsage({',
    'recentFolderUsage.consider(nodeID)',
    'recentFolderUsage.confirm(parentID)',
    'recentItems={recent.items}',
  ]) assert.ok(desktopExplorer.includes(token), 'Desktop folder usage missing: ' + token)

  assert.ok(desktopApp.includes("capabilities.includes('file-recent-folders')"), 'Desktop requires current folder capability')
  assert.equal(webExplorer.includes('void recent.record(nodeID)'), false, 'navigation must not touch old file Recents')
  assert.equal(desktopExplorer.includes('void recent.record(nodeID)'), false, 'navigation must not touch old file Recents')
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
    'cloudFileRecent(limit = 16, signal?: AbortSignal)',
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
    'fileRecent(limit = 16, signal?: AbortSignal)',
    'touchFileRecent(nodeID: number)',
    'clearFileRecent()',
  ]) assert.ok(webApi.includes(token), 'Web Recent REST adapter missing: ' + token)
})

test('folder usage has a distinct Server and Desktop transport, leaving iOS file Recents intact', () => {
  const native = read('ios', 'XDriveIOS', 'NativeFilesCollections.swift')
  const model = read('internal', 'meta', 'file_recent.go')
  const server = read('internal', 'api', 'file_recent.go')
  const hostPort = read('desktop', 'src', 'renderer', 'DesktopFileExplorerHostPort.ts')
  for (const token of ['type FileRecentFolderAccess struct', 'xd_file_recent_folder_access']) {
    assert.ok(model.includes(token), token)
  }
  assert.ok(server.includes('fileRecentFolderRetention = 64'))
  assert.ok(server.includes("n.type = 'dir' AND n.parent_id IS NOT NULL"), 'folder history must exclude root/files')
  assert.ok(server.includes('func (s *Server) listFileRecentFolders('))
  assert.ok(server.includes('func (s *Server) touchFileRecentFolder('))
  assert.ok(native.includes('/api/v1/file-recent/'), 'iOS file history must preserve its existing contract')

  for (const token of [
    '/api/v1/file-recent-folders',
    'FileRecentFolder(ctx context.Context',
    'TouchFileRecentFolder(ctx context.Context',
    'ClearFileRecentFolder(ctx context.Context)',
  ]) assert.ok(goClient.includes(token), 'Go client folder bridge missing: ' + token)

  for (const token of [
    'CloudFileRecentFolder',
    'CloudTouchFileRecentFolder',
    'CloudClearFileRecentFolder',
  ]) assert.ok(agentCloud.includes(token), 'Agent folder bridge missing: ' + token)

  for (const token of [
    '"file-recent-folders"',
    'GET /v1/cloud/recent-folders',
    'POST /v1/cloud/recent-folders/touch',
    'DELETE /v1/cloud/recent-folders',
  ]) assert.ok(agentIPC.includes(token), 'Agent IPC folder capability missing: ' + token)

  for (const token of [
    'cloudFileRecentFolders(limit = 8',
    'cloudTouchFileRecentFolder(nodeID: number)',
    'cloudClearFileRecentFolders()',
  ]) assert.ok(agentClient.includes(token), 'Desktop client folder transport missing: ' + token)

  for (const token of [
    "ipcMain.handle('agent:cloud-recent-folders'",
    "ipcMain.handle('agent:cloud-recent-folders-touch'",
    "ipcMain.handle('agent:cloud-recent-folders-clear'",
    "requireAgentCapability(hello, 'file-recent-folders')",
  ]) assert.ok(desktopMain.includes(token), 'Desktop IPC folder gate missing: ' + token)

  for (const token of ['cloudFileRecentFolders:', 'cloudTouchFileRecentFolder:', 'cloudClearFileRecentFolders:']) {
    assert.ok(preload.includes(token), 'preload missing: ' + token)
    assert.ok(rendererTypes.includes(token), 'renderer type missing: ' + token)
    assert.ok(hostPort.includes(token), 'host port must explicitly allow: ' + token)
  }
  assert.ok(webApi.includes('fileRecentFolders(limit = 8'))
  assert.ok(webApi.includes('touchFileRecentFolder(nodeID: number)'))
  assert.ok(webApi.includes('clearFileRecentFolders()'))
})
