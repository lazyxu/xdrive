const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const model = read('ui', 'shared', 'src', 'file-explorer-properties.ts')
const controller = read('ui', 'shared', 'src', 'mui', 'FileExplorerPropertiesController.ts')
const explorer = read('ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
const webApi = read('web', 'src', 'api.ts')
const webExplorer = read('web', 'src', 'WebFileExplorer.tsx')
const desktopExplorer = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
const preload = read('desktop', 'src', 'preload', 'index.cts')
const main = read('desktop', 'src', 'main', 'index.cts')
const agentClient = read('desktop', 'src', 'main', 'agent_client.cts')
const agentIPC = read('cmd', 'xdrive-agent', 'desktop_ipc.go')
const server = read('internal', 'api', 'file_properties.go')

test('Folder Properties owns one shared recursive statistics contract', () => {
  for (const token of [
    'selected_count',
    'effective_root_count',
    'total_bytes',
    'file_count',
    'folder_count',
    'xDriveFileExplorerPropertiesRefs',
  ]) assert.ok(model.includes(token), 'shared Properties contract missing: ' + token)

  assert.ok(explorer.includes('loadPropertiesStats?: XDriveFileExplorerPropertiesLoader'), 'FileExplorer must accept the shared recursive stats loader')
  assert.ok(explorer.includes("'正在计算…'"), 'Folder Properties must expose calculating state')
  assert.ok(explorer.includes('propertiesStatsState.stats.total_bytes'), 'Folder Properties must display recursive bytes')
  assert.ok(explorer.includes('propertiesStatsState.stats.file_count'), 'Folder Properties must display recursive file count')
  assert.ok(explorer.includes('propertiesStatsState.stats.folder_count'), 'Folder Properties must display recursive folder count')
})

test('Folder Properties automatically cancels closed or replaced requests', () => {
  for (const token of [
    'const controller = new AbortController()',
    'const requestID = ++requestIDRef.current',
    'controller.signal.aborted || requestID !== requestIDRef.current',
    'return () => {',
    'controller.abort()',
  ]) assert.ok(controller.includes(token), 'shared Properties auto-cancel lifecycle missing: ' + token)

  assert.ok(
    explorer.includes('onClose={() => setPropertiesItems([])}'),
    'closing Properties must clear the owner selection and trigger request cleanup',
  )
  assert.equal(
    controller.includes('onError'),
    false,
    'intentional request abort must not be routed into a global error/toast callback',
  )
})

test('Web Folder Properties passes AbortSignal to the Server request', () => {
  assert.ok(webApi.includes('filePropertiesStats(items: BatchNodeRef[], signal?: AbortSignal)'), 'Web API stats signal is missing')
  assert.ok(webApi.includes("'/api/v1/nodes/properties/stats'"), 'Web API stats endpoint is missing')
  assert.ok(webApi.includes('signal,'), 'Web API must forward the AbortSignal to fetch')
  assert.ok(webExplorer.includes('xDriveFileExplorerPropertiesRefs(selected)'), 'Web must use the shared immutable selection refs')
  assert.ok(webExplorer.includes('loadPropertiesStats={loadPropertiesStats}'), 'Web FileExplorer must wire recursive Properties stats')
})

test('Desktop Folder Properties cancellation propagates through Electron and Agent', () => {
  assert.ok(desktopExplorer.includes('cloudFilePropertiesStats('), 'Desktop renderer stats request is missing')
  assert.ok(desktopExplorer.includes('cloudCancelFilePropertiesStats(requestID)'), 'Desktop renderer cancel bridge is missing')
  assert.ok(desktopExplorer.includes("signal.addEventListener('abort', cancel"), 'Desktop renderer must translate AbortSignal into IPC cancellation')
  assert.ok(preload.includes("'agent:cloud-file-properties-stats'"), 'Desktop preload stats IPC is missing')
  assert.ok(preload.includes("'agent:cloud-file-properties-stats-cancel'"), 'Desktop preload cancel IPC is missing')
  assert.ok(main.includes('const filePropertiesRequests = new Map<string, AbortController>()'), 'Electron main request AbortController registry is missing')
  assert.ok(main.includes('const cancelledFilePropertiesRequests = new Set<string>()'), 'Electron main early-cancel tombstones are missing')
  assert.ok(main.includes('rememberCancelledFilePropertiesRequest(requestID)'), 'Electron main must remember cancel-before-register races')
  assert.ok(main.includes('cancelledFilePropertiesRequests.delete(requestID)'), 'Electron main must consume or expire early-cancel tombstones')
  assert.ok(main.includes('filePropertiesRequests.get(requestID)'), 'Electron main request lookup is missing')
  assert.ok(main.includes('controller.abort()'), 'Electron main must abort the Agent request')
  assert.ok(agentClient.includes('cloudFilePropertiesStats('), 'Agent IPC client stats method is missing')
  assert.ok(agentClient.includes('signal?: AbortSignal'), 'Agent IPC client must accept the external signal')
  assert.ok(agentIPC.includes('CloudFilePropertiesStats(r.Context(), input.Items)'), 'Agent must forward request context to the cloud controller')
})

test('Server Folder Properties uses request context for recursive SQL and stays out of Task Center', () => {
  assert.ok(server.includes('c.Request.Context()'), 'Server handler must own request-scoped cancellation')
  assert.ok(server.includes('s.DB.WithContext(ctx).Transaction'), 'Server database work must use request context')
  assert.ok(server.includes('WITH RECURSIVE tree AS'), 'Server must compute Folder Properties recursively')
  assert.ok(server.includes('topLevelBatchDeleteRefs'), 'Server must remove nested selected roots before aggregation')
  assert.equal(server.includes('BackgroundTask'), false, 'Folder Properties must not become a durable Task Center job')
})


test('Properties loads metadata for a single file or folder selection without making pure multi-file summaries remote', () => {
  assert.ok(
    controller.includes("(items.length > 1 && !items.some((item) => item.kind === 'dir'))"),
    'pure multi-file Properties should stay local while single-file and folder selections may load technical metadata',
  )
  assert.ok(
    controller.includes('const controller = new AbortController()'),
    'single-file technical metadata must retain the existing cancellable request lifecycle',
  )
})

test('Properties renders explicit general, content and technical-detail sections', () => {
  const dialog = read('ui', 'shared', 'src', 'mui', 'FilePropertiesDialog.tsx')
  for (const token of [
    "export type XDriveFilePropertiesDialogSection = 'general' | 'content' | 'technical'",
    "['general', '常规']",
    "['content', '内容']",
    "['technical', '技术详情']",
    "(property.section ?? 'general') === key",
  ]) {
    assert.ok(dialog.includes(token), 'Properties section contract missing: ' + token)
  }
  assert.equal(dialog.includes('technical?: boolean'), false)
  assert.equal(dialog.includes('技术信息'), false)
})

test('Properties technical details include hash, revision, stable id and owner-scoped source bindings', () => {
  for (const token of [
    'sources?: XDriveFileExplorerPropertiesSource[]',
    "label: 'SHA-256'",
    "label: 'Revision'",
    "label: 'ID'",
    "label: '来源'",
    'propertiesStatsState.stats?.sources?.length',
    "source.name",
    "source.kind",
    "section: 'technical'",
    'sha256?: string',
  ]) {
    assert.ok(
      (model + explorer).includes(token),
      'Properties technical detail missing: ' + token,
    )
  }

  for (const token of [
    'filePropertiesSourceResponse',
    'DISTINCT s.id, s.name, s.kind',
    'JOIN xd_sources AS s ON s.id = si.source_id',
    'si.node_id = ? AND s.owner_id = ?',
    'Sources:            sources',
  ]) {
    assert.ok(server.includes(token), 'Server source-binding contract missing: ' + token)
  }
})

test('source binding reuses the existing cancellable Properties transport', () => {
  assert.ok(
    webApi.includes("filePropertiesStats(items: BatchNodeRef[], signal?: AbortSignal)"),
    'Web source metadata must stay on the existing cancellable Properties request',
  )
  assert.ok(
    desktopExplorer.includes('cloudFilePropertiesStats('),
    'Desktop source metadata must stay on the existing cancellable Agent request',
  )
  assert.equal(
    agentIPC.includes('/v1/cloud/properties/source'),
    false,
    'source metadata must not create a second Desktop IPC request path',
  )
})
