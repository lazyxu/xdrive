const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const serverModel = read('internal', 'meta', 'file_organization.go')
const serverQuickModel = read('internal', 'meta', 'file_quick_access.go')
const serverAPI = read('internal', 'api', 'file_organization.go')
const serverQuickAPI = read('internal', 'api', 'file_quick_access.go')
const serverSearch = read('internal', 'api', 'search.go')
const router = read('internal', 'api', 'router.go')
const serverMain = read('cmd', 'server', 'main.go')
const goClient = read('internal', 'client', 'client.go')
const sharedModel = read('ui', 'shared', 'src', 'file-explorer-organization.ts')
const searchModel = read('ui', 'shared', 'src', 'file-explorer-search.ts')
const searchController = read('ui', 'shared', 'src', 'mui', 'FileExplorerSearch.ts')
const searchFilters = read('ui', 'shared', 'src', 'mui', 'FileExplorerSearchFilters.tsx')
const organizationController = read('ui', 'shared', 'src', 'mui', 'FileExplorerOrganizationController.ts')
const tagDialog = read('ui', 'shared', 'src', 'mui', 'FileTagDialog.tsx')
const columnView = read('ui', 'shared', 'src', 'mui', 'FileExplorerColumnView.tsx')
const explorer = read('ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
const navigation = read('ui', 'shared', 'src', 'mui', 'FileExplorerNavigation.ts')
const pane = read('ui', 'shared', 'src', 'mui', 'FileExplorerNavigationPane.tsx')
const quickController = read('ui', 'shared', 'src', 'mui', 'FileExplorerQuickAccessController.ts')
const webAPI = read('web', 'src', 'api.ts')
const web = read('web', 'src', 'WebFileExplorer.tsx')
const agentCloud = read('cmd', 'xdrive-agent', 'cloud_files.go')
const agentIPC = read('cmd', 'xdrive-agent', 'desktop_ipc.go')
const agentClient = read('desktop', 'src', 'main', 'agent_client.cts')
const desktopMain = read('desktop', 'src', 'main', 'index.cts')
const preload = read('desktop', 'src', 'preload', 'index.cts')
const rendererTypes = read('desktop', 'src', 'renderer', 'global.d.ts')
const desktop = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
const app = read('desktop', 'src', 'renderer', 'App.tsx')

test('Tags are first-class owner-scoped file organization, not Gallery tags', () => {
  for (const token of [
    'type FileTag struct',
    'type FileNodeTag struct',
    'xd_file_tags',
    'xd_file_node_tags',
    'OwnerID',
    'NodeID',
    'TagID',
  ]) assert.ok(serverModel.includes(token), 'server tag model missing: ' + token)

  for (const token of [
    'GET("/file-tags", s.listFileTags)',
    'POST("/file-tags", s.createFileTag)',
    'PATCH("/file-tags/:id", s.updateFileTag)',
    'DELETE("/file-tags/:id", s.deleteFileTag)',
    'POST("/nodes/tags/query", s.queryFileNodeTags)',
    'PUT("/file-tags/:id/nodes", s.addFileTagNodes)',
    'DELETE("/file-tags/:id/nodes", s.removeFileTagNodes)',
  ]) assert.ok(router.includes(token), 'server tag route missing: ' + token)

  for (const token of [
    'TagID        uint64',
    'c.Query("tag_id")',
    'FROM xd_file_node_tags node_tag',
    'JOIN xd_file_tags tag',
    'node_tag.tag_id = ?',
  ]) assert.ok(serverSearch.includes(token), 'server-side tag search missing: ' + token)

  assert.ok(serverMain.includes('&meta.FileTag{}'))
  assert.ok(serverMain.includes('&meta.FileNodeTag{}'))
  assert.ok(searchModel.includes('tagID?: number'))
  assert.ok(searchFilters.includes("label={filters.tagID ? `标签："))
  assert.ok(tagDialog.includes('编辑标签'))
  assert.ok(tagDialog.includes('onUpdateTag'))
  assert.ok(tagDialog.includes('批量设置标签'))
  assert.ok(explorer.includes("id: 'tags'"))
  assert.ok(explorer.includes("label: '标签…'"))
  assert.ok(explorer.includes('onManageTags'))

  for (const source of [web, desktop]) {
    assert.ok(source.includes('XDriveFileTagDialog'), 'both clients must use the shared tag dialog')
    assert.ok(source.includes('organization.setTagNodes'), 'both clients must use shared tag assignment state')
    assert.ok(source.includes('tagOptions={'), 'both clients must expose tag search filters')
  }
})

test('Smart Folder is a persisted server-side Search contract with full sidebar lifecycle', () => {
  for (const token of [
    'type FileSavedSearch struct',
    'xd_file_saved_searches',
    'Query',
    'FiltersJSON',
    'Position',
  ]) assert.ok(serverModel.includes(token), 'saved-search model missing: ' + token)

  for (const token of [
    'GET("/file-saved-searches", s.listFileSavedSearches)',
    'POST("/file-saved-searches", s.createFileSavedSearch)',
    'PATCH("/file-saved-searches/:id", s.updateFileSavedSearch)',
    'DELETE("/file-saved-searches/:id", s.deleteFileSavedSearch)',
    'PUT("/file-saved-searches/order", s.reorderFileSavedSearches)',
  ]) assert.ok(router.includes(token), 'saved-search route missing: ' + token)

  assert.ok(serverMain.includes('&meta.FileSavedSearch{}'))
  assert.ok(sharedModel.includes('export type XDriveFileSavedSearch'))
  assert.ok(sharedModel.includes('xDriveFileExplorerPersistedSearchFilters'))
  assert.ok(searchFilters.includes('保存搜索'))
  assert.ok(searchController.includes('const applySearch = useCallback'))
  assert.ok(organizationController.includes('createSavedSearch'))
  assert.ok(organizationController.includes('updateSavedSearch'))
  assert.ok(organizationController.includes('reorderSavedSearches'))

  for (const token of [
    '智能文件夹',
    'onActivateSavedSearch',
    'onRenameSavedSearch',
    'onReplaceSavedSearch',
    '更新为当前搜索',
    'onDeleteSavedSearch',
    'onReorderSavedSearches',
  ]) assert.ok(pane.includes(token), 'Smart Folder sidebar behavior missing: ' + token)

  for (const source of [web, desktop]) {
    assert.ok(source.includes('mode="saved-search"'), 'both clients must use the shared Smart Folder name dialog')
    assert.ok(source.includes('organization.createSavedSearch'), 'both clients must create Smart Folders through the shared controller')
    assert.ok(source.includes('organization.updateSavedSearch'), 'both clients must rename/update Smart Folders')
    assert.ok(source.includes('void applySearch(savedSearch.query, savedSearch.filters)'), 'both clients must execute Smart Folders through shared Search')
  }
})

test('Column View is a real shared view mode with stale-request fencing and paged columns', () => {
  assert.ok(explorer.includes("export type XDriveFileExplorerViewMode = 'details' | 'grid' | 'columns'"))
  assert.ok(navigation.includes("stored === 'grid' || stored === 'columns'"))
  assert.ok(navigation.includes("tab.viewMode !== 'details' && tab.viewMode !== 'grid' && tab.viewMode !== 'columns'"))
  assert.ok(explorer.includes('<XDriveFileExplorerColumnView'))
  assert.ok(explorer.includes("viewMode === 'columns'"))
  assert.ok(explorer.includes("if (viewMode === 'columns') return"), 'marquee/virtual grid logic must not run against Column View')

  for (const token of [
    'controllersRef.current.get(key)?.abort()',
    'generationRef.current.get(key) !== generation',
    'activeKeys',
    'Object.entries(current).filter(([key]) => activeKeys.has(key))',
    'XDriveAutoLoadSentinel',
    'onItemContextMenu',
  ]) assert.ok(columnView.includes(token), 'Column View concurrency/paging contract missing: ' + token)

  assert.ok(webAPI.includes('signal?: AbortSignal'), 'Web column paging must support transport cancellation')
  assert.ok(web.includes('loadColumnPage='))
  assert.ok(desktop.includes('loadColumnPage='))
  assert.ok(desktop.includes('cloudChildrenPage(Number(parentID)'), 'Desktop Column View must reuse Agent paged children')
})

test('Sidebar supports persisted customization and real manual sorting', () => {
  for (const token of [
    'XDriveFileExplorerSidebarPreferences',
    'loadSidebarPreferences',
    "quickAccessSort: 'manual' | 'name'",
    '排序和自定义侧边栏',
    '显示栏目',
    '手动排序（可拖动）',
    '按名称排序',
    'onReorderQuickAccess',
    'onReorderSavedSearches',
  ]) assert.ok(pane.includes(token), 'sidebar customization missing: ' + token)

  assert.ok(serverQuickModel.includes('Position  int'))
  assert.ok(serverQuickAPI.includes('reorderFileQuickAccess'))
  assert.ok(serverQuickAPI.includes('ORDER BY p.position ASC'))
  assert.ok(quickController.includes('const reorder = useCallback'))
  assert.ok(webAPI.includes('reorderFileQuickAccess'))
  assert.ok(web.includes('quickAccess.reorder(nodeIDs)'))
  assert.ok(desktop.includes('quickAccess.reorder(nodeIDs)'))
})

test('Quick Actions stay lightweight and reuse existing non-destructive actions', () => {
  for (const token of [
    'const inspectorQuickActions = inspectorItem ? [',
    "id: 'tags'",
    'getItemMenuItems?.(inspectorItem)',
    '!item.danger',
    "['rename', 'delete', 'properties', 'cut', 'copy', 'move', 'version-history']",
    '].slice(0, 4)',
  ]) assert.ok(explorer.includes(token), 'lightweight Quick Actions contract missing: ' + token)

  assert.equal(explorer.includes('Markup'), false)
  assert.equal(explorer.includes('Trim video'), false)
  assert.equal(explorer.includes('Create PDF'), false)
})

test('Tags and Smart Folder cross Web, Go client, Agent and Electron without renderer credentials', () => {
  for (const token of [
    'FileTags(ctx context.Context)',
    'QueryFileNodeTags(ctx context.Context',
    'SetFileTagNodes(ctx context.Context',
    'FileSavedSearches(ctx context.Context)',
    'CreateFileSavedSearch(ctx context.Context',
    'UpdateFileSavedSearch(ctx context.Context',
    'ReorderFileSavedSearches(ctx context.Context',
  ]) assert.ok(goClient.includes(token), 'Go client organization bridge missing: ' + token)

  for (const token of [
    'CloudFileTags',
    'CloudQueryFileNodeTags',
    'CloudSetFileTagNodes',
    'CloudFileSavedSearches',
    'CloudCreateFileSavedSearch',
    'CloudUpdateFileSavedSearch',
  ]) assert.ok(agentCloud.includes(token), 'Agent organization bridge missing: ' + token)

  for (const token of ['"file-tags"', '"file-saved-searches"']) {
    assert.ok(agentIPC.includes(token), 'Agent capability missing: ' + token)
    assert.ok(app.includes("capabilities.includes('" + token.slice(1, -1) + "')"), 'Desktop capability gate missing: ' + token)
  }

  for (const token of [
    'AgentFileTag',
    'AgentFileNodeTags',
    'AgentFileSavedSearch',
    'cloudFileTags()',
    'cloudFileSavedSearches()',
  ]) assert.ok(agentClient.includes(token), 'Electron Agent client organization contract missing: ' + token)

  for (const token of [
    "ipcMain.handle('agent:cloud-tags'",
    "ipcMain.handle('agent:cloud-saved-searches'",
    "requireAgentCapability(hello, 'file-tags')",
    "requireAgentCapability(hello, 'file-saved-searches')",
  ]) assert.ok(desktopMain.includes(token), 'Electron main organization bridge missing: ' + token)

  for (const token of ['cloudFileTags:', 'cloudFileSavedSearches:']) assert.ok(preload.includes(token))
  for (const token of ['AgentFileTag', 'AgentFileSavedSearch']) assert.ok(rendererTypes.includes(token))
})
