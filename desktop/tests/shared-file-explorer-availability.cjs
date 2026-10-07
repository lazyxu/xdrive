const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const sharedExplorer = read('ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
const desktopExplorer = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
const desktopApp = read('desktop', 'src', 'renderer', 'App.tsx')
const agentIPC = read('cmd', 'xdrive-agent', 'desktop_ipc.go')
const agentClient = read('desktop', 'src', 'main', 'agent_client.cts')
const preload = read('desktop', 'src', 'preload', 'index.cts')
const globalTypes = read('desktop', 'src', 'renderer', 'global.d.ts')

test('shared FileExplorer renders a neutral optional availability marker', () => {
  for (const token of [
    'export type XDriveFileExplorerAvailability',
    'availability?: XDriveFileExplorerAvailability',
    'const availabilityIndicator =',
    'aria-label={availability.label}',
    '{availabilityIndicator(item)}',
    '{availabilityIndicator(item, true)}',
  ]) {
    assert.ok(sharedExplorer.includes(token), 'shared availability marker missing: ' + token)
  }
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
    desktopExplorer.includes('getFileAvailabilityBatch(paths)'),
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

test('Desktop maps CfAPI state to Explorer labels and management actions', () => {
  for (const label of [
    '正在同步',
    '已同步',
    '待同步',
    '始终保留在此设备上',
    '仅联机',
    '云端',
    '本地可用',
    '释放空间',
  ]) {
    assert.ok(desktopExplorer.includes(label), 'availability label missing: ' + label)
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
    (desktopExplorer.match(/getFileAvailabilityBatch\(paths\)/g) || []).length,
    1,
    'status and availability columns must not add a second availability batch request path',
  )
})
