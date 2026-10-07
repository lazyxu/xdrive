const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const sharedExplorer = read('ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
const sharedAvailability = read('ui', 'shared', 'src', 'file-explorer-availability.ts')
const navigationPane = read('ui', 'shared', 'src', 'mui', 'FileExplorerNavigationPane.tsx')
const mountState = read('internal', 'mount', 'state.go')
const mountStateWindows = read('internal', 'mount', 'state_windows.go')
const availabilitySearch = read('cmd', 'xdrive-agent', 'file_availability_search.go')
const sharedSearch = read('ui', 'shared', 'src', 'file-explorer-search.ts')
const sharedSearchFilters = read('ui', 'shared', 'src', 'mui', 'FileExplorerSearchFilters.tsx')
const desktopExplorer = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
const desktopOverview = read('desktop', 'src', 'renderer', 'DesktopOverviewPage.tsx')
const desktopApp = read('desktop', 'src', 'renderer', 'App.tsx')
const agentIPC = read('cmd', 'xdrive-agent', 'desktop_ipc.go')
const agentClient = read('desktop', 'src', 'main', 'agent_client.cts')
const preload = read('desktop', 'src', 'preload', 'index.cts')
const globalTypes = read('desktop', 'src', 'renderer', 'global.d.ts')

test('shared FileExplorer owns canonical item icons and availability badges', () => {
  for (const token of [
    'XDriveFileExplorerItemIcon',
    'FolderZipRoundedIcon',
    'XDriveFileExplorerAvailabilityBadge',
    "case 'mixed':",
    "case 'error':",
    '{availabilityIndicator(item)}',
    '{availabilityIndicator(item, true)}',
  ]) {
    assert.ok(sharedExplorer.includes(token), 'shared visual contract missing: ' + token)
  }
  for (const token of [
    "| 'mixed'",
    "| 'error'",
    "label: '混合 · 部分内容已在本地'",
    'xDriveFileExplorerAvailabilityFromSnapshot',
  ]) {
    assert.ok(sharedAvailability.includes(token), 'shared availability semantics missing: ' + token)
  }
  assert.ok(navigationPane.includes('XDriveFileExplorerItemIcon'), 'navigation must reuse shared item icons')
  assert.ok(navigationPane.includes('XDriveFileExplorerAvailabilityBadge'), 'navigation must reuse shared availability badges')
  assert.ok(navigationPane.includes('onAvailabilityItemsChange?.(navigationAvailabilityItems)'), 'loaded tree directories must join availability batching')
  assert.ok(sharedExplorer.includes('CircularProgress'), 'syncing badge should support determinate progress when available')
})

test('Desktop batches local availability instead of issuing one request per row', () => {
  assert.ok(
    agentIPC.includes('"file-availability-batch"'),
    'Agent must advertise the batch availability capability',
  )
  assert.ok(
    agentIPC.includes('mux.HandleFunc("POST /v1/file-availability/batch", h.fileAvailabilityBatch)'),
    'Agent batch availability route is missing',
  )
  assert.ok(
    agentClient.includes('fileAvailabilityBatch(paths: string[])'),
    'Electron Agent client batch method is missing',
  )
  assert.ok(
    preload.includes("getFileAvailabilityBatch: (paths: string[])"),
    'preload batch availability bridge is missing',
  )
  assert.ok(
    globalTypes.includes('getFileAvailabilityBatch: (paths: string[])'),
    'renderer batch availability type is missing',
  )
  assert.ok(
    desktopExplorer.includes('getFileAvailabilityBatch(batchPaths)'),
    'Desktop FileExplorer must batch currently loaded paths',
  )
  assert.equal(
    desktopExplorer.includes('getFileAvailability(relativePath'),
    false,
    'Desktop FileExplorer must not regress to per-item availability IPC',
  )
})

test('Desktop availability is Windows-only and preserves shared sparse collection identity', () => {
  assert.ok(
    desktopApp.includes("agent.hello?.platform === 'windows'"),
    'Desktop availability must be gated to Windows CfAPI',
  )
  assert.ok(
    desktopApp.includes("agent.hello?.capabilities.includes('file-availability-batch')"),
    'Desktop availability must require the batch capability',
  )
  for (const token of [
    'const getItemStatus = useCallback',
    'const getItemAvailability = useCallback',
    'getItemStatus={fileAvailabilitySupported ? getItemStatus : undefined}',
    'getItemAvailability={fileAvailabilitySupported ? getItemAvailability : undefined}',
    'items={trashActive ? trash.items : explorerItems}',
    'virtualCollection={trashActive ? undefined : explorerVirtualCollection}',
  ]) {
    assert.ok(desktopExplorer.includes(token), 'Desktop availability presentation adapter missing: ' + token)
  }
})

test('Desktop maps CfAPI state to shared Explorer semantics and management actions', () => {
  for (const label of [
    '已同步',
    '待同步',
    '始终保留在此设备上',
    '释放空间',
  ]) {
    assert.ok(desktopExplorer.includes(label), 'Desktop availability action/status missing: ' + label)
  }
  for (const label of [
    '正在同步',
    '仅联机',
    '云端',
    '本地可用',
    '混合 · 部分内容已在本地',
    '状态异常',
  ]) {
    assert.ok(sharedAvailability.includes(label), 'shared availability label missing: ' + label)
  }
  assert.ok(
    desktopExplorer.includes("setFileAvailability(\n        relativePath,\n        action,"),
    'Desktop management actions must use the existing Agent availability contract',
  )
  assert.ok(
    desktopExplorer.includes("onSelect: () => { void setNodeAvailability(node, 'keep') }"),
    'Always keep action is missing',
  )
  assert.ok(
    desktopExplorer.includes("onSelect: () => { void setNodeAvailability(node, 'release') }"),
    'Release space action is missing',
  )
  assert.ok(
    sharedExplorer.includes("label: '可用性', value: availability.label, section: 'general'"),
    'availability must also appear in shared Properties',
  )
})


test('Details status and availability columns reuse the existing Desktop availability batch', () => {
  for (const token of [
    "if (key === 'status') return item.statusLabel ?? getItemStatus?.(item) ?? '—'",
    "if (key === 'availability') return availabilityForItem(item)?.label ?? '—'",
    'getItemStatus?: (',
    "createdAt?: string",
  ]) {
    assert.ok(sharedExplorer.includes(token), 'shared Details metadata missing: ' + token)
  }
  assert.ok(
    desktopExplorer.includes('const entry = availabilityByID.get(Number(item.id))'),
    'Desktop status/availability must reuse the already-batched availability map',
  )
  assert.equal(
    (desktopExplorer.match(/getFileAvailabilityBatch\(batchPaths\)/g) || []).length,
    1,
    'status and availability columns must not add a second availability batch request path',
  )
})


test('Desktop availability Search is an Agent range filter, never renderer filtering', () => {
  for (const token of [
    "availability?: XDriveFileExplorerSearchAvailability",
    "filters?.availability",
    "filters?.availability ?? ''",
  ]) {
    assert.ok(sharedSearch.includes(token), 'shared Search availability identity missing: ' + token)
  }
  for (const token of [
    "availabilityOptions?: readonly XDriveFileExplorerSearchAvailabilityOption[]",
    "open('availability')",
    "可用性：",
    "menu === 'availability'",
  ]) {
    assert.ok(sharedSearchFilters.includes(token), 'shared availability filter surface missing: ' + token)
  }
  assert.ok(
    desktopExplorer.includes('availabilityOptions={fileAvailabilitySupported ? desktopSearchAvailabilityOptions : []}'),
    'Desktop must expose availability only when the local capability is authoritative',
  )
  assert.equal(
    desktopExplorer.includes('.filter((item) => getItemAvailability'),
    false,
    'renderer must not filter retained Search pages by availability',
  )
})

test('mixed folder availability is OS-derived without renderer recursion', () => {
  assert.ok(mountState.includes('Mixed            bool'), 'mount availability must expose mixed state')
  const availabilityStart = mountStateWindows.indexOf('func availabilityPlatform(')
  const availabilityEnd = mountStateWindows.indexOf('func placeholderState(', availabilityStart)
  assert.ok(availabilityStart >= 0 && availabilityEnd > availabilityStart, 'Windows availability function missing')
  const availabilityFunction = mountStateWindows.slice(availabilityStart, availabilityEnd)
  assert.ok(availabilityFunction.includes('cfPlaceholderStatePartiallyOnDisk'), 'Windows availability must use CfAPI partial state')
  assert.ok(availabilityFunction.includes('mixed := isDir && placeholder && partiallyOnDisk && !syncing'), 'directory mixed state must be bounded')
  assert.equal(availabilityFunction.includes('WalkDir'), false, 'availability reads must not recursively walk directories')
  assert.ok(availabilitySearch.includes('state.Mixed || state.Mode == "mixed"'), 'availability Search must classify mixed state')
  assert.ok(desktopExplorer.includes('desktopFileAvailabilityBatchLimit = 2048'), 'Desktop must respect the Agent batch limit')
  assert.ok(agentIPC.includes('os.IsNotExist(err)'), 'missing local placeholders must not become error badges')
  assert.ok(agentIPC.includes('Mode:             "cloud"'), 'missing local placeholders must map to cloud availability')
  assert.ok(desktopExplorer.includes('quickAccess.items'), 'Quick Access availability must join the batch')
  assert.ok(desktopExplorer.includes('favorites.items'), 'Favorites availability must join the batch')
  assert.ok(desktopExplorer.includes('recent.items'), 'Recent availability must join the batch')
  assert.ok(desktopExplorer.includes('navigationAvailabilityItems'), 'expanded tree availability must join the batch')
  assert.ok(desktopExplorer.includes('getItemAvailability={fileAvailabilitySupported ? getItemAvailability : undefined}'), 'navigation must receive shared availability')
})

test('Desktop overview reuses FileExplorer item visuals and availability semantics', () => {
  for (const token of [
    'XDriveFileExplorerThumbnailProvider',
    'XDriveFileExplorerThumbnail',
    'XDriveFileExplorerItemIcon',
    'XDriveFileExplorerAvailabilityBadge',
    'xDriveFileExplorerAvailabilityFromSnapshot',
    'getFileAvailabilityBatch(paths)',
    'overviewItemVisual(item)',
  ]) {
    assert.ok(desktopOverview.includes(token), 'Desktop overview visual contract missing: ' + token)
  }
  assert.equal(
    desktopOverview.includes('StarRoundedIcon'),
    false,
    'favorite rows must show the file visual, not replace it with a star primary icon',
  )
})
