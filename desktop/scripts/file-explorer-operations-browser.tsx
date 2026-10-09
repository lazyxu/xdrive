import { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { XDriveFileExplorer } from '__FILE_EXPLORER__'
import { useXDriveFileExplorerWorkspace } from '__WORKSPACE__'
import { useXDriveFileExplorerOperationController } from '__OPERATION_CONTROLLER__'
import { useXDriveFileOperationLifecycle } from '__OPERATION_LIFECYCLE__'
import { useXDriveFileOperationActions } from '__OPERATION_ACTIONS__'
import { XDriveTaskCenterPage } from '__TASK_CENTER__'
import { XDriveFileNameDialog } from '__FILE_NAME_DIALOG__'
import { XDriveFileExplorerDestinationDialog } from '__DESTINATION_DIALOG__'
import { XDriveFileExplorerActionFeedback } from '__ACTION_FEEDBACK__'
import { XDriveAppearanceThemeProvider } from '__THEME__'
import { xDriveFileExplorerLoadChildDirectoryPage } from '__CONTROLLER_MODEL__'

// Only Server/IPC boundaries are controlled. These fixtures execute the shared
// Workspace, operation controller, operation lifecycle/actions, and MUI surfaces.
const params = new URLSearchParams(location.search)
const scene = params.get('scene') ?? 'files'
const root = { id: 1, name: '我的文件' }
const home = { id: 2, name: '项目目录' }
const stamp = '2026-10-09T00:00:00Z'
const makeNode = (id: number, name: string, type: 'dir' | 'file', parent_id: number) => ({ id, name, type, parent_id, revision: id + 10, size: type === 'file' ? 4096 : 0, created_at: stamp, updated_at: stamp })
const directoryRows = new Map<number, any[]>([
  [1, [makeNode(2, home.name, 'dir', 1), makeNode(3, '其他目录', 'dir', 1)]],
  [2, [makeNode(20, '源文件夹', 'dir', 2), makeNode(30, '目标目录', 'dir', 2), makeNode(40, '继续加载的目录', 'dir', 2), makeNode(50, '项目归档资料'.repeat(12), 'dir', 2), makeNode(21, '报告.txt', 'file', 2), makeNode(22, '照片.jpg', 'file', 2)]],
  [20, [makeNode(200, '源文件夹的子目录', 'dir', 20), makeNode(201, '源文件.txt', 'file', 20)]],
  [30, [makeNode(300, '目标子目录', 'dir', 30), makeNode(301, '目标文件.txt', 'file', 30)]],
  [300, [makeNode(3000, '目标深层目录', 'dir', 300)]],
  [3000, []], [40, []], [50, []], [200, []], [3, []],
])
const harness = ((window as any).operationsHarness = {
  selectedIDs: [] as any[], events: [] as any[], requests: [] as any[], pending: [] as any[],
  renameMode: 'resolve', renameError: '测试：名称已存在，请使用其他名称', holdOperation: false, failNextOperation: false, failNextTree: false,
  holdAction: false, failNextAction: false,
  holdTreeID: null as number | null, operations: [] as any[],
})
const record = (type: string, value?: any) => harness.events.push({ type, value })
const onError = (error: unknown) => record('handled-error', String((error as Error)?.message || error))
const onSelectionChange = (ids: any[]) => { harness.selectedIDs = [...ids]; record('selection', [...ids]) }
const loadRoot = async () => root
const findChildDirectory = async (id: number, name: string) => directoryRows.get(id)?.find((item) => item.type === 'dir' && item.name === name) ?? null
const searchCrumbsForResult = (result: any) => result.crumbs
async function loadSearchRange(query: string, filters: any, grouping: any, sort: any, offset: number, limit: number) {
  harness.requests.push({ type: 'search', query, filters, grouping, sort, offset, limit })
  const count = 128
  return { offset, limit, totalCount: count, groups: [], items: Array.from({ length: Math.max(0, Math.min(limit, count - offset)) }, (_, i) => {
    const index = offset + i
    const node = index === 0 ? directoryRows.get(2)![4] : makeNode(1000 + index, `${query}-结果-${index}.txt`, 'file', 2)
    return { node, path: `/项目目录/${node.name}`, crumbs: [root, home] }
  }) }
}
async function renameBoundary(target: any, name: string) {
  const request = { type: 'rename', target: { ...target }, name }
  harness.requests.push(request)
  if (harness.renameMode === 'reject') throw new Error(harness.renameError)
  if (harness.renameMode === 'hold') await new Promise<void>((resolve, reject) => harness.pending.push({ type: 'rename', resolve, reject, request }))
  record('rename-complete', request)
  if (Number.isFinite(Number(target.id))) {
    for (const [id, rows] of directoryRows) {
      if (rows.some((node) => node.id === Number(target.id))) directoryRows.set(id, rows.map((node) => node.id === Number(target.id) ? { ...node, name, revision: node.revision + 1 } : node))
    }
    harness.publishDirectory?.()
  }
}
const operationValue = (id: string, type: string, status: string, extra: any = {}) => ({
  id, type, status, total_items: 2, processed_items: 0, total_bytes: 4096, processed_bytes: 0,
  percent: 0, retryable: false, created_at: stamp, updated_at: stamp, ...extra,
})
const loadOperations = async (limit: number) => { harness.requests.push({ type: 'operations', limit }); return harness.operations.map((operation: any) => ({ ...operation })) }
async function submitOperation(plan: any) {
  harness.requests.push({ type: 'operation-submit', plan: JSON.parse(JSON.stringify(plan)) })
  if (harness.failNextOperation) { harness.failNextOperation = false; throw new Error('测试：提交失败，请重试') }
  if (harness.holdOperation) await new Promise<void>((resolve) => harness.pending.push({ type: 'operation', resolve }))
  const operation = operationValue(`operation-${harness.operations.length + 1}`, plan.operation, 'queued', { total_items: plan.count })
  harness.operations.unshift(operation)
  return operation
}
async function operationAction(action: string, id: string, policy?: string) {
  harness.requests.push({ type: `operation-${action}`, id, policy })
  if (harness.failNextAction) { harness.failNextAction = false; throw new Error('测试：任务操作暂时不可用') }
  if (harness.holdAction) await new Promise<void>((resolve, reject) => harness.pending.push({ type: 'action', resolve, reject }))
  const original = harness.operations.find((operation: any) => operation.id === id)
  const next = action === 'cancel'
    ? { ...original, status: 'cancel_requested' }
    : { ...original, id: `${id}-${action}-${harness.operations.length}`, status: 'queued', retry_of_id: id, retryable: false, conflict_policy: policy, failure_code: undefined, error: undefined }
  if (action === 'cancel') harness.operations = harness.operations.map((operation: any) => operation.id === id ? next : operation)
  else harness.operations.unshift(next)
  return next
}
const loadDirectoryPage = (parentID: number, cursor?: string) => xDriveFileExplorerLoadChildDirectoryPage({
  parentID, cursor,
  loadPage: async (id: number, options: any) => {
    harness.requests.push({ type: 'tree', id, options: { ...options } })
    if (options.limit !== 200 || options.sort !== 'name' || options.order !== 'asc') throw new Error('Unexpected directory transport options')
    if (harness.failNextTree) { harness.failNextTree = false; throw new Error('测试：目录暂时不可用') }
    if (harness.holdTreeID === id) await new Promise<void>((resolve) => harness.pending.push({ type: 'tree', id, resolve }))
    const offset = options.cursor ? Number(String(options.cursor).replace('page:', '')) : 0
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Unexpected directory cursor')
    const rows = directoryRows.get(id) ?? []
    const items = rows.slice(offset, offset + 2)
    const has_more = offset + items.length < rows.length
    return { items, has_more, next_cursor: has_more ? `page:${offset + items.length}` : '' }
  },
})
harness.release = (kind: string, reject = false) => {
  for (const pending of harness.pending.filter((value: any) => value.type === kind)) {
    if (reject && pending.reject) pending.reject(new Error('测试：名称已存在，请使用其他名称'))
    else pending.resolve()
  }
  harness.pending = harness.pending.filter((value: any) => value.type !== kind)
}

function NameDialogFixture() {
  const [target, setTarget] = useState({ key: 'target-a', name: '原始名称.txt', open: true })
  harness.replaceNameTarget = () => setTarget({ key: 'target-b', name: '替换目标.txt', open: true })
  harness.nameState = target
  return <XDriveFileNameDialog {...({ open: target.open, mode: 'rename', initialValue: target.name, lifecycleKey: target.key,
    onSubmit: (name: string) => renameBoundary({ id: target.key, name: target.name }, name),
    onClose: () => { record('name-close', target.key); setTarget((value) => ({ ...value, open: false })) }, onError,
  } as any)} />
}

function FilesFixture() {
  const [session, setSession] = useState('operation-session-1')
  const [directory, setDirectory] = useState({ id: 2, crumbs: [root, home] })
  const [, setDirectoryVersion] = useState(0)
  const [feedbackID, setFeedbackID] = useState('')
  const [taskOpen, setTaskOpen] = useState(scene === 'tasks')
  const [taskFocus, setTaskFocus] = useState({ id: '', requestID: 0 })
  const items = directoryRows.get(directory.id) ?? []
  const onLoadDirectory = useCallback(async (id: number, crumbs: any[]) => {
    harness.requests.push({ type: 'directory', id, crumbs: crumbs.map((crumb) => ({ ...crumb })) })
    setDirectory((value) => value.id === id ? value : { id, crumbs: crumbs.map((crumb) => ({ ...crumb })) })
    return true
  }, [])
  const initialNavigationState = useMemo(() => ({
    activeTabID: 'tab-1', tabs: [{ id: 'tab-1', history: [[root, home]], historyIndex: 0,
      viewMode: 'details', sort: { key: 'name', direction: 'asc' }, grouping: { groupBy: 'none', foldersFirst: true } }],
  }), [])
  const workspace = useXDriveFileExplorerWorkspace({
    items, crumbs: directory.crumbs, viewModeStorageKey: 'xdrive.operations-fixture.view', navigationSessionStorageKey: session,
    initialNavigationState: initialNavigationState as any, onLoadDirectory, loadSearchRange, loadRoot, findChildDirectory, searchCrumbsForResult, onError,
  })
  const lifecycle = useXDriveFileOperationLifecycle({ enabled: true, lifecycleKey: session, taskCenterVisible: taskOpen, loadOperations, onRefreshError: onError })
  const operationController = useXDriveFileExplorerOperationController({
    lifecycleKey: session, nodeByID: workspace.nodeByID, currentID: directory.id, maxItems: 200,
    planPaste: workspace.planPaste, completePaste: workspace.completePaste, canPaste: workspace.canPaste,
    clearSearch: workspace.clearSearch, submitOperation,
    onQueued: (operation: any) => { lifecycle.rememberOperation(operation); setFeedbackID(operation.id); record('queued', operation.id) },
    onFeedback: (_tone: string, message: string) => record('feedback', message), onError,
  })
  const actions = useXDriveFileOperationActions({
    lifecycleKey: session, cancelOperation: (id: string) => operationAction('cancel', id),
    retryOperation: (id: string) => operationAction('retry', id), resolveConflict: (id: string, policy: string) => operationAction('resolve', id, policy),
    clearOperationHistory: async () => { harness.operations = [] }, clearTransferHistory: async () => undefined,
    rememberOperation: lifecycle.rememberOperation, refreshOperations: lifecycle.refreshOperations, onError,
  })
  const destination = (operationController as any).destinationRequest ?? null
  const openDestination = (operation: 'move' | 'copy', selected: any[]) => (operationController as any).openDestination(operation, selected, directory.crumbs)
  const feedbackOperation = lifecycle.operations.find((operation: any) => operation.id === feedbackID)
  const showTask = (id: string) => { setTaskFocus((value) => ({ id, requestID: value.requestID + 1 })); setTaskOpen(true) }
  harness.current = workspace
  harness.operationController = operationController
  harness.loadDirectoryPage = loadDirectoryPage
  harness.publishDirectory = () => setDirectoryVersion((value) => value + 1)
  harness.mutateSourceMetadata = () => {
    directoryRows.set(2, (directoryRows.get(2) ?? []).map((node) => node.id === 20 || node.id === 21 ? { ...node, revision: node.revision + 100, name: `${node.name}-changed` } : node))
    setDirectoryVersion((value) => value + 1)
  }
  harness.showTask = showTask
  harness.refreshOperations = lifecycle.refreshOperations
  harness.seedConflict = () => {
    harness.operations = [operationValue('operation-conflict-1', 'copy', 'failed', { failure_code: 'name_conflict', current_item: '同名的项目文件.txt', error: '测试：目标已存在同名项目', failed_item_id: 21 })]
    void lifecycle.refreshOperations()
  }
  harness.setOperationStatus = (id: string, status: string, extra: any = {}) => {
    harness.operations = harness.operations.map((operation: any) => operation.id === id ? { ...operation, status, ...extra } : operation)
    void lifecycle.refreshOperations()
  }
  harness.seedOperation = (status: string, extra: any = {}) => {
    harness.operations = [operationValue('operation-seeded-1', 'copy', status, extra)]
    void lifecycle.refreshOperations()
  }
  harness.changeSession = () => setSession((value) => `${value}-new`)
  harness.state = {
    directoryID: directory.id, crumbs: directory.crumbs.map((crumb) => ({ ...crumb })), query: workspace.searchState.query,
    searchValue: workspace.searchValue, searchActive: workspace.searchResults !== null, searchReady: workspace.searchReady,
    historyKey: workspace.activeHistoryEntryKey, canGoBack: workspace.canGoBack, canGoForward: workspace.canGoForward,
    selectedIDs: harness.selectedIDs, destination, operationBusy: operationController.busy, actionBusy: actions.busy,
    clipboardPlan: workspace.planPaste(30), operations: lifecycle.operations, taskFocus, taskOpen, session,
    destinationAvailable: Boolean(XDriveFileExplorerDestinationDialog),
  }
  useEffect(() => { if (params.get('scope') === 'search') void workspace.applySearch('原搜索', {}) }, [])
  const openItem = (item: any) => workspace.openItem(item, (node: any) => record('file-open', node.id))

  return <div style={{ width: '100%', height: '100dvh', minHeight: 0, display: 'flex', overflow: 'hidden' }}>
    <div style={{ display: taskOpen ? 'none' : 'contents' }}>
      <XDriveFileExplorer {...({
        presentation: 'workspace', interactionLifecycleKey: session, keyboardProfile: 'windows',
        items: workspace.explorerItems, crumbs: workspace.explorerCrumbs, virtualCollection: workspace.explorerVirtualCollection,
        viewState: workspace.explorerViewState, viewMode: workspace.viewMode, onViewModeChange: workspace.setViewMode,
        externallySorted: workspace.externallySorted, sort: workspace.sort, onSortChange: workspace.changeSort,
        grouping: workspace.grouping, onGroupingChange: workspace.changeGrouping,
        onSelectionChange, onOpenItem: openItem, onRenameItem: renameBoundary,
        onCrumbClick: (_crumb: any, index: number) => workspace.navigateToCrumb(index), onBack: workspace.goBack, onForward: workspace.goForward, onUp: workspace.goUp,
        canGoBack: workspace.canGoBack, canGoForward: workspace.canGoForward, canGoUp: workspace.canGoUp,
        onRefresh: workspace.refresh, onPathSubmit: workspace.submitPath,
        searchValue: workspace.searchValue, onSearchValueChange: workspace.changeSearchValue, onSearch: workspace.submitSearch,
        searchSummary: workspace.searchResults !== null ? { query: workspace.searchState.query, conditions: [], resultCount: workspace.searchReady ? 128 : null, onClear: workspace.clearSearch } : undefined,
        onCopyItems: workspace.copyItems, onCutItems: workspace.cutItems,
        onMoveItemsTo: (selected: any[]) => openDestination('move', selected), onCopyItemsTo: (selected: any[]) => openDestination('copy', selected),
        onPaste: operationController.pasteClipboard, canPaste: operationController.canPaste,
        onDeleteItems: (selected: any[]) => record('delete', selected.map((item) => item.id)),
        actionFeedback: feedbackOperation ? <XDriveFileExplorerActionFeedback value={{ kind: 'operation', operation: feedbackOperation as any }} onViewTask={showTask} onDismiss={() => setFeedbackID('')} /> : undefined,
      } as any)} />
    </div>
    {XDriveFileExplorerDestinationDialog ? <XDriveFileExplorerDestinationDialog
      open={Boolean(destination)} lifecycleKey={session} operation={destination?.operation ?? 'copy'} sources={destination?.sources ?? []}
      initialCrumbs={destination?.initialCrumbs ?? []} loadDirectoryPage={loadDirectoryPage}
      onSubmit={(crumbs: any[]) => (operationController as any).submitDestination(crumbs)}
      onClose={() => (operationController as any).closeDestination()}
    /> : null}
    {taskOpen ? <div style={{ width: '100%', height: '100%', overflowY: 'auto' }} data-fixture-task-scroll>
      <XDriveTaskCenterPage {...({ transfers: [], operations: lifecycle.operations, operationFocusID: taskFocus.id, operationFocusRequestID: taskFocus.requestID,
        operationCancellingID: actions.cancellingID, operationRetryingID: actions.retryingID,
        operationResolvingID: actions.resolvingID, operationResolvingPolicy: actions.resolvingPolicy,
        onCancelOperation: actions.cancelOperation, onRetryOperation: actions.retryOperation, onResolveOperationConflict: params.get('capability') === 'limited' ? undefined : actions.resolveConflict,
      } as any)} />
    </div> : null}
  </div>
}

createRoot(document.getElementById('root')!).render(<XDriveAppearanceThemeProvider appearance="light">
  {scene === 'name-dialog' ? <NameDialogFixture /> : <FilesFixture />}
</XDriveAppearanceThemeProvider>)
