const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const sharedModel = read('ui', 'shared', 'src', 'cloud-files.ts')
const controller = read('ui', 'shared', 'src', 'mui', 'FileExplorerFavoriteController.ts')
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
const serverFavorites = read('internal', 'api', 'file_favorites.go')
const serverModel = read('internal', 'meta', 'file_favorite.go')
const serverMain = read('cmd', 'server', 'main.go')

test('file favorites stay separate from folder Quick Access and Gallery favorite', () => {
  for (const token of ['type FileFavorite struct','OwnerID','NodeID','xd_file_favorites','constraint:OnUpdate:CASCADE,OnDelete:CASCADE']) {
    assert.ok(serverModel.includes(token), 'server favorite model missing: ' + token)
  }
  assert.ok(serverMain.includes('&meta.FileFavorite{}'))
  for (const token of ['fileFavoriteLimit = 256','fileFavoriteItems(','FROM xd_file_favorites q',"n.type = 'file'",'only files can be favorited']) {
    assert.ok(serverFavorites.includes(token), 'server favorite behavior missing: ' + token)
  }
  assert.equal(serverFavorites.includes('PhotoMetadata'), false)
  assert.equal(serverFavorites.includes('xd_file_quick_access'), false)
})

test('favorites cross Server, Go client, Agent and Electron bridges', () => {
  for (const token of ['GET("/file-favorites", s.listFileFavorites)','PUT("/file-favorites/:id", s.favoriteFile)','DELETE("/file-favorites/:id", s.unfavoriteFile)']) {
    assert.ok(serverRouter.includes(token), 'server favorite route missing: ' + token)
  }
  for (const token of ['FileFavorites(ctx context.Context)','FavoriteFile(ctx context.Context','UnfavoriteFile(ctx context.Context','/api/v1/file-favorites']) {
    assert.ok(goClient.includes(token), 'Go client favorite bridge missing: ' + token)
  }
  for (const token of ['CloudFileFavorites','CloudFavoriteFile','CloudUnfavoriteFile']) assert.ok(agentCloud.includes(token))
  for (const token of ['"file-favorites"','CloudFileFavorites(context.Context)','GET /v1/cloud/favorites','POST /v1/cloud/favorites/favorite','POST /v1/cloud/favorites/unfavorite']) {
    assert.ok(agentIPC.includes(token), 'Agent IPC favorite bridge missing: ' + token)
  }
  for (const token of ['AgentCloudFavoriteItem','cloudFileFavorites()','cloudFavoriteFile(nodeID: number)','cloudUnfavoriteFile(nodeID: number)']) assert.ok(agentClient.includes(token))
  for (const token of ["ipcMain.handle('agent:cloud-favorites'","ipcMain.handle('agent:cloud-favorite'","ipcMain.handle('agent:cloud-unfavorite'","requireAgentCapability(hello, 'file-favorites')"]) assert.ok(desktopMain.includes(token))
  for (const token of ['cloudFileFavorites:','cloudFavoriteFile:','cloudUnfavoriteFile:']) assert.ok(preload.includes(token))
  assert.ok(rendererTypes.includes('AgentCloudFavoriteItem'))
})

test('shared controller and UI own file Star semantics', () => {
  assert.ok(sharedModel.includes('export type XDriveFileFavoriteItem'))
  assert.ok(muiIndex.includes("export * from './FileExplorerFavoriteController'"))
  for (const token of ['useXDriveFileExplorerFavorites','const favoriteIDs = useMemo','const favorite = useCallback','const unfavorite = useCallback','const toggle = useCallback','const activate = useCallback']) assert.ok(controller.includes(token))
  for (const token of ['favoritesEnabled','favoriteItems','暂无收藏文件','onActivateFavorite','onUnfavorite','快速访问','收藏']) assert.ok(navigation.includes(token))
  for (const token of ['onToggleFavorite',"id: 'toggle-favorite'","label: favorite ? '取消收藏' : '添加到收藏'",'favoriteDisabled']) assert.ok(actions.includes(token))
  assert.ok(actions.includes("id: 'toggle-quick-access'"))
})

test('Web and Desktop use the shared favorite controller with transport-only adapters', () => {
  for (const token of ['useXDriveFileExplorerFavorites<Node>','loadItems: () => api.fileFavorites()','favoriteItem: (nodeID) => api.favoriteFile(nodeID)','unfavoriteItem: (nodeID) => api.unfavoriteFile(nodeID)','favoriteItems={favorites.items}','void favorites.toggle(node.id)']) assert.ok(webExplorer.includes(token))
  for (const token of ['fileFavorites()','favoriteFile(nodeID: number)','unfavoriteFile(nodeID: number)']) assert.ok(webApi.includes(token))
  for (const token of ['useXDriveFileExplorerFavorites<AgentCloudNode>','enabled: favoritesSupported','cloudFileFavorites()','cloudFavoriteFile(nodeID)','cloudUnfavoriteFile(nodeID)','favoriteItems={favorites.items}']) assert.ok(desktopExplorer.includes(token))
  assert.ok(desktopApp.includes("capabilities.includes('file-favorites')"))
})
