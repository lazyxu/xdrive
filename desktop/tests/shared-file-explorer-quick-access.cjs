const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const sharedModel = read('ui', 'shared', 'src', 'cloud-files.ts')
const controller = read('ui', 'shared', 'src', 'mui', 'FileExplorerQuickAccessController.ts')
const navigation = read('ui', 'shared', 'src', 'mui', 'FileExplorerNavigationPane.tsx')
const actions = read('ui', 'shared', 'src', 'mui', 'FileExplorerActions.tsx')
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
const serverQuickAccess = read('internal', 'api', 'file_quick_access.go')
const serverModel = read('internal', 'meta', 'file_quick_access.go')
const serverMain = read('cmd', 'server', 'main.go')

test('Quick Access is a user-node relation with live server-side breadcrumbs', () => {
  for (const token of [
    'type FileQuickAccess struct',
    'OwnerID',
    'NodeID',
    'xd_file_quick_access',
    'constraint:OnUpdate:CASCADE,OnDelete:CASCADE',
  ]) assert.ok(serverModel.includes(token), 'server quick-access model missing: ' + token)

  assert.ok(serverMain.includes('&meta.FileQuickAccess{}'), 'server migration must include quick access')
  for (const token of [
    'fileQuickAccessLimit = 64',
    'fileQuickAccessItems(',
    'FROM xd_file_quick_access q',
    "n.type = 'dir'",
    'only non-root folders can be pinned',
    'quick access limit reached',
  ]) assert.ok(serverQuickAccess.includes(token), 'server quick-access behavior missing: ' + token)

  for (const token of [
    'GET("/file-quick-access", s.listFileQuickAccess)',
    'PUT("/file-quick-access/:id", s.pinFileQuickAccess)',
    'DELETE("/file-quick-access/:id", s.unpinFileQuickAccess)',
  ]) assert.ok(serverRouter.includes(token), 'server quick-access route missing: ' + token)
})

test('shared controller owns quick-access state and refreshes identity before navigation', () => {
  assert.ok(sharedModel.includes('export type XDriveFileQuickAccessItem'), 'shared quick-access transport model is missing')
  assert.ok(muiIndex.includes("export * from './FileExplorerQuickAccessController'"), 'quick-access controller is not exported')

  for (const token of [
    'useXDriveFileExplorerQuickAccess',
    'const loadItemsRef = useRef(loadItems)',
    'const loadRequestRef = useRef(0)',
    'const loadFresh = useCallback',
    'const pinnedIDs = useMemo',
    'const pin = useCallback',
    'const unpin = useCallback',
    'const toggle = useCallback',
    'const navigate = useCallback',
    'const latest = await loadFresh(requestID)',
    'if (requestID !== loadRequestRef.current) return false',
    'const target = latest.find((item) => item.id === nodeID)',
    'await onNavigate(target.crumbs)',
  ]) assert.ok(controller.includes(token), 'shared quick-access controller missing: ' + token)

  for (const token of [
    'if (requestID === loadRequestRef.current) setItems(next)',
    'if (requestID === loadRequestRef.current) setLoading(false)',
    'loadRequestRef.current += 1',
  ]) assert.ok(controller.includes(token), 'shared quick-access race guard missing: ' + token)

  assert.equal(controller.includes('localStorage'), false, 'Quick Access identity must stay server-side, not in localStorage')
})

test('shared navigation pane renders one Quick Access section above the lazy folder tree', () => {
  for (const token of [
    'quickAccessEnabled',
    'quickAccessItems',
    'currentQuickAccessPinned',
    '快速访问',
    '固定当前文件夹',
    '取消固定当前文件夹',
    'onNavigateQuickAccess',
    'onUnpinQuickAccess',
    'role="tree"',
    'aria-label="文件夹树"',
    'expandedSections.tree',
  ]) assert.ok(navigation.includes(token), 'shared navigation Quick Access UI missing: ' + token)
})

test('folder context menus reuse the shared Quick Access controller', () => {
  for (const token of [
    'onToggleQuickAccess,',
    'quickAccessPinned = false',
    'quickAccessDisabled = false',
    "id: 'toggle-quick-access'",
    "label: quickAccessPinned ? '从快速访问取消固定' : '固定到快速访问'",
    'disabled: primaryDisabled || quickAccessDisabled',
    'onSelect: onToggleQuickAccess',
  ]) assert.ok(actions.includes(token), 'shared folder Quick Access menu missing: ' + token)

  for (const token of [
    "onToggleQuickAccess: node.type === 'dir'",
    'void quickAccess.toggle(node.id)',
    'quickAccessPinned: quickAccess.pinnedIDs.has(node.id)',
    'quickAccessDisabled: quickAccess.busyID !== null',
  ]) assert.ok(webExplorer.includes(token), 'Web folder Quick Access menu adapter missing: ' + token)

  for (const token of [
    "onToggleQuickAccess: node.type === 'dir' && quickAccessSupported",
    'void quickAccess.toggle(node.id)',
    'quickAccessPinned: quickAccess.pinnedIDs.has(node.id)',
    'quickAccessDisabled: quickAccess.busyID !== null',
  ]) assert.ok(desktopExplorer.includes(token), 'Desktop folder Quick Access menu adapter missing: ' + token)
})

test('Web and Desktop use the same Quick Access controller with transport-only adapters', () => {
  for (const token of [
    'useXDriveFileExplorerQuickAccess<Node>',
    'loadItems: () => api.fileQuickAccess()',
    'pinItem: (nodeID) => api.pinFileQuickAccess(nodeID)',
    'unpinItem: (nodeID) => api.unpinFileQuickAccess(nodeID)',
    'quickAccessItems={quickAccess.items}',
    'quickAccess.navigate(',
  ]) assert.ok(webExplorer.includes(token), 'Web Quick Access adapter missing: ' + token)

  for (const token of [
    'useXDriveFileExplorerQuickAccess<AgentCloudNode>',
    'enabled: quickAccessSupported',
    'cloudFileQuickAccess()',
    'cloudPinFileQuickAccess(nodeID)',
    'cloudUnpinFileQuickAccess(nodeID)',
    'quickAccessItems={quickAccess.items}',
    'quickAccess.navigate(',
  ]) assert.ok(desktopExplorer.includes(token), 'Desktop Quick Access adapter missing: ' + token)

  assert.ok(desktopApp.includes("capabilities.includes('file-quick-access')"), 'Desktop must capability-gate Quick Access')
  assert.equal(webExplorer.includes('useState<XDriveFileExplorerQuickAccess'), false, 'Web must not own duplicate Quick Access state')
  assert.equal(desktopExplorer.includes('useState<XDriveFileExplorerQuickAccess'), false, 'Desktop must not own duplicate Quick Access state')
})

test('Quick Access crosses Server, Go client, Agent and Electron bridges', () => {
  for (const token of [
    'FileQuickAccess(ctx context.Context)',
    'PinFileQuickAccess(ctx context.Context',
    'UnpinFileQuickAccess(ctx context.Context',
    '/api/v1/file-quick-access',
  ]) assert.ok(goClient.includes(token), 'Go client Quick Access bridge missing: ' + token)

  for (const token of [
    'CloudFileQuickAccess',
    'CloudPinFileQuickAccess',
    'CloudUnpinFileQuickAccess',
  ]) assert.ok(agentCloud.includes(token), 'Agent cloud Quick Access bridge missing: ' + token)

  for (const token of [
    '"file-quick-access"',
    'CloudFileQuickAccess(context.Context)',
    'GET /v1/cloud/quick-access',
    'POST /v1/cloud/quick-access/pin',
    'POST /v1/cloud/quick-access/unpin',
  ]) assert.ok(agentIPC.includes(token), 'Agent IPC Quick Access bridge missing: ' + token)

  for (const token of [
    'AgentCloudQuickAccessItem',
    'cloudFileQuickAccess()',
    'cloudPinFileQuickAccess(nodeID: number)',
    'cloudUnpinFileQuickAccess(nodeID: number)',
  ]) assert.ok(agentClient.includes(token), 'Electron Agent client Quick Access bridge missing: ' + token)

  for (const token of [
    "ipcMain.handle('agent:cloud-quick-access'",
    "ipcMain.handle('agent:cloud-quick-access-pin'",
    "ipcMain.handle('agent:cloud-quick-access-unpin'",
    "requireAgentCapability(hello, 'file-quick-access')",
  ]) assert.ok(desktopMain.includes(token), 'Electron main Quick Access bridge missing: ' + token)

  assert.ok(preload.includes('cloudFileQuickAccess:'), 'preload Quick Access list bridge is missing')
  assert.ok(preload.includes('cloudPinFileQuickAccess:'), 'preload Quick Access pin bridge is missing')
  assert.ok(preload.includes('cloudUnpinFileQuickAccess:'), 'preload Quick Access unpin bridge is missing')
  assert.ok(rendererTypes.includes('AgentCloudQuickAccessItem'), 'renderer Quick Access type is missing')
  assert.ok(rendererTypes.includes('cloudFileQuickAccess:'), 'renderer Quick Access list method is missing')

  for (const token of [
    'fileQuickAccess()',
    'pinFileQuickAccess(nodeID: number)',
    'unpinFileQuickAccess(nodeID: number)',
  ]) assert.ok(webApi.includes(token), 'Web Quick Access REST adapter missing: ' + token)
})
