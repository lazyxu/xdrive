const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')
const hooks = {
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useMemo: (factory) => factory(),
  useCallback: (callback) => callback,
  useEffect: () => {},
  useRef: (initial) => ({ current: initial }),
}
const jsx = (type, props) => ({ type, props })
function load(relative, overrides = {}) {
  const source = fs.readFileSync(path.join(repo, relative), 'utf8')
  const result = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  } })
  const module = { exports: {} }
  const localRequire = (name) => {
    if (name in overrides) return overrides[name]
    if (name === 'react') return hooks
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' }
    if (name.startsWith('@mui/icons-material/')) return { __esModule: true, default: name }
    return require(name)
  }
  new Function('require', 'module', 'exports', result.outputText)(localRequire, module, module.exports)
  return module.exports
}

test('Sidebar exposes personal Tasks, with Global Tasks only for an administrator', () => {
  const nav = load('ui/shared/src/mui/WorkspaceNavigation.tsx')
  const ordinary = nav.xDriveCoreWorkspaceDestinations({ transferBadge: 2 })
  assert.equal(ordinary.find((item) => item.key === 'transfers')?.label, '任务')
  assert.equal(ordinary.some((item) => item.key === 'global-tasks'), false)
  assert.equal(ordinary.some((item) => item.label === '传输'), false)
  const admin = nav.xDriveCoreWorkspaceDestinations({ showGlobalTasks: true, transferBadge: 2 })
  assert.equal(admin.find((item) => item.key === 'global-tasks')?.label, '全局任务')
  assert.equal(admin.find((item) => item.key === 'transfers')?.badge, 2)
  const compact = nav.xDriveCompactWorkspaceNavigation({ showGlobalTasks: true })
  assert.equal(compact.primary.find((item) => item.key === 'transfers')?.label, '任务')
  assert.equal(compact.moreSections.flatMap((section) => section.items).some((item) => item.key === 'global-tasks'), true)
})

test('workspace task navigation preserves independent mine/global routes and back links', () => {
  const registry = load('web/src/webApps.ts')
  assert.equal(typeof registry.xDriveWebAppRouteForWorkspaceKey, 'function')
  assert.deepEqual(registry.xDriveWebAppRouteForWorkspaceKey('transfers'), { app: 'tasks', params: { scope: 'mine' } })
  assert.deepEqual(registry.xDriveWebAppRouteForWorkspaceKey('global-tasks'), { app: 'tasks', params: { scope: 'global' } })
  assert.equal(registry.xDriveWebAppWorkspaceKey('tasks', { scope: 'global' }), 'global-tasks')
  assert.equal(registry.xDriveWebAppWorkspaceKey('tasks', { scope: 'mine' }), 'transfers')
  assert.equal(registry.xDriveWebAppWorkspaceKey('tasks'), 'transfers')
  assert.equal(registry.xDriveWebAppRouteForWorkspaceKey('not-an-app'), null)
})

function task(id, direction, state = 'running') {
  return {
    id, kind: direction === 'local' ? 'dehydration' : direction, direction,
    file_name: id, path: id, state, phase: 'transferring', bytes_done: 10,
    bytes_total: 100, percent: 10, instant_bytes_per_second: 10,
    average_bytes_per_second: 10, elapsed_ms: 1000, retry_count: 0, retryable: false,
    started_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:00:01Z',
  }
}
function controller(input) {
  const transfers = load('ui/shared/src/transfers.ts')
  const operations = load('ui/shared/src/file-operations.ts')
  const background = load('ui/shared/src/background-tasks.ts', { './format': { formatBytes: String } })
  return load('ui/shared/src/mui/TaskCenterController.ts', {
    '..': { ...transfers, ...operations, ...background }, '../transfers': transfers,
  }).useXDriveTaskCenterController({
    transfers: [], operations: [], operationActions: { busy: false, clearHistoryLoading: false },
    ...input,
  })
}

test('network transfers leave the Sidebar badge and task list while local work remains', () => {
  const upload = task('upload', 'upload')
  const download = task('download', 'download')
  const local = task('release-cache', 'local')
  const result = controller({ transfers: [upload, download, local], operations: [{ id: 'copy', status: 'running' }] })
  assert.equal(result.activeTransferCount, 3)
  assert.equal(result.badgeCount, 2, 'one local task and one file operation; upload/download belong to the topbar')
  assert.deepEqual(result.pageProps.transfers.map((item) => item.id), ['release-cache'])
})

test('Task history action cannot be enabled solely by completed network transfers', () => {
  const result = controller({ transfers: [task('download', 'download', 'completed')] })
  assert.equal(result.pageProps.clearHistory.disabled, true)
})

test('external global navigation honors the administrator gate', () => {
  const port = { loadMinePage: async () => ({}), loadGlobalPage: async () => ({}) }
  const ordinary = controller({ backgroundScope: 'global', backgroundTaskPort: port, globalTasksEnabled: false })
  assert.equal(ordinary.backgroundScope, 'mine')
  const admin = controller({ backgroundScope: 'global', backgroundTaskPort: port, globalTasksEnabled: true })
  assert.equal(admin.backgroundScope, 'global')
})

function renderTaskPage(props) {
  return load('ui/shared/src/mui/TaskCenterPage.tsx', {
    '@mui/material': { Box: 'Box', CircularProgress: 'CircularProgress', Divider: 'Divider', Stack: 'Stack', Typography: 'Typography' },
    './ActionButton': { XDriveActionButton: 'ActionButton' },
    './BackgroundTaskCenter': { XDriveBackgroundTaskList: 'BackgroundTaskList', XDriveBackgroundTaskTable: 'BackgroundTaskTable' },
    './FileOperationCenter': { XDriveFileOperationCenter: 'FileOperationCenter' },
    './TransferCenter': { XDriveTransferCenter: 'TransferCenter' },
    './WorkspaceSurface': { XDriveWorkspaceSurface: 'WorkspaceSurface' },
  }).XDriveTaskCenterPage({ transfers: [], operations: [], ...props })
}

function elements(tree, type) {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap((child) => elements(child, type))
  return [...(tree.type === type ? [tree] : []), ...elements(tree.props?.children, type)]
}

test('Tasks keeps archive preparation and other server work without duplicating file operations or sync runs', () => {
  const tree = renderTaskPage({
    backgroundTasksAvailable: true,
    backgroundTasks: [
      { id: 'file', domain: 'file_operation', kind: 'file.copy' },
      { id: 'sync-run', domain: 'sync_run', kind: 'source.sync' },
      { id: 'sync-scheduled', domain: 'scheduler', kind: 'source.sync' },
      { id: 'index', domain: 'scheduler', kind: 'media.index' },
      { id: 'archive', domain: 'archive_prepare', kind: 'archive.prepare' },
      { id: 'other', domain: 'other_background_work', kind: 'other' },
    ],
  })
  assert.equal(tree.props.title, '任务')
  const lists = elements(tree, 'BackgroundTaskList')
  assert.deepEqual(lists[0].props.tasks.map((item) => item.id), ['sync-run', 'sync-scheduled'])
  assert.deepEqual(lists[1].props.tasks.map((item) => item.id), ['index', 'archive', 'other'])
})

test('Global Tasks renders an independent administrator page and ordinary users fall back to Tasks', () => {
  const data = [{ id: 'global-job' }]
  const admin = renderTaskPage({ globalTasksEnabled: true, backgroundScope: 'global', globalBackgroundTasks: data })
  assert.equal(admin.props.title, '全局任务')
  assert.equal(elements(admin, 'BackgroundTaskTable')[0].props.tasks, data)
  assert.equal(elements(admin, 'FileOperationCenter').length, 0)
  const ordinary = renderTaskPage({ backgroundScope: 'global', globalBackgroundTasks: data })
  assert.equal(ordinary.props.title, '任务')
  assert.equal(elements(ordinary, 'BackgroundTaskTable').length, 0)
})
