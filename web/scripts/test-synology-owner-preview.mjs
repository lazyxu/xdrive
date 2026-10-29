#!/usr/bin/env node
// Execute the actual DSM page controller with deterministic hooks and Agent
// promises. Native type stripping needs Node >=22.13 (the DSM job uses 22.x).
// This covers adapter state/callback behavior; ordinary CI still typechecks
// and builds the complete React/MUI view and packages the optional SPK.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const read = name => fs.readFileSync(repo + name, 'utf8')
const page = read('ui/shared/src/mui/SynologyOwnerFilesPage.tsx')
const start = page.indexOf('const pageSize =')
const end = page.indexOf('\n  return (\n    <XDriveFilesWorkspacePage')
assert.ok(start >= 0 && end > start, 'DSM controller prelude must be identifiable')
const inspection = `
  return { displayedItems, previewItem, readyDownload, download, notice,
    downloadSelectedFiles, refreshAuthenticatedOwner, setCrumbs, setSort,
    openFilePreview: typeof openFilePreview === 'function' ? openFilePreview : null,
    movePreview: typeof movePreview === 'function' ? movePreview : null,
    previewPositionLabel: typeof previewPositionLabel === 'string' ? previewPositionLabel : '',
    previewActions: typeof previewActions === 'object' ? previewActions : [],
    getDownloadDisabledReason: typeof getDownloadDisabledReason === 'function' ? getDownloadDisabledReason : null,
    cancelDownload: typeof cancelDownload === 'function' ? cancelDownload : null,
  }
}`
const controllerSource = stripTypeScriptTypes(page.slice(start, end) + inspection)
  .replace('export function XDriveSynologyOwnerFilesPage', 'function XDriveSynologyOwnerFilesPage')

function loadPlainModule(filename, names, bindings = {}) {
  const stripped = stripTypeScriptTypes(read(filename))
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export (?=(?:async )?(?:function|const)\b)/gm, '')
  return new Function(...Object.keys(bindings), stripped + '\nreturn {' + names.join(',') + '}')(...Object.values(bindings))
}
const classification = loadPlainModule('ui/shared/src/file-preview.ts', ['xDriveFileSupportsTextPreview'])
const range = { XDRIVE_SYNOLOGY_MEDIA_RANGE_BYTES: 256 << 10 }
const media = loadPlainModule('ui/shared/src/synology-media-preview.ts',
  ['xDriveSynologyPreviewMIME', 'XDRIVE_SYNOLOGY_MEDIA_BLOB_MAX_BYTES'], range)
const stream = loadPlainModule('ui/shared/src/synology-media-stream.ts', ['xDriveSynologyPlaybackMIME'], range)
const scope = loadPlainModule('ui/shared/src/synology-owner-files-scope.ts',
  ['xDriveSynologyOwnerFilesScopeKey', 'xDriveSynologyOwnerFilesNearEnd'])

// The actual Owner-identity guard is part of the mounted controller, not a
// synthetic test bypass: stale/forged rows must be rejected by the same code.
const ownerIdentity = loadPlainModule(
  'ui/shared/src/mui/FileExplorerVerifiedOwnerSelection.ts',
  ['xDriveFindVerifiedOwnerSelection'],
)

const node = (id, name, size, type = 'file') => ({ id, name, size, type,
  revision: 7, parent_id: 1, created_at: '', updated_at: '' })
const rows = [node(2, 'a.txt', 1), node(3, 'folder', 0, 'dir'),
  node(4, 'b.jpg', 32 << 20), node(5, 'large.jpg', (32 << 20) + 1),
  node(6, 'c.mp4', 64 << 20), node(7, 'empty.txt', 0), node(8, 'archive.zip', 10)]
const same = (a, b) => a?.length === b?.length && a.every((value, i) => Object.is(value, b[i]))

async function mount() {
  const slots = [], requests = [], revoked = [], timers = [], listeners = new Map()
  let cursor = 0, dirty = true, snapshot, pending = [], urlSequence = 0
  const hooks = {
    useState(initial) {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[index].value, next => {
        const value = typeof next === 'function' ? next(slots[index].value) : next
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true }
      }]
    },
    useRef(initial) { const index = cursor++; return (slots[index] ??= { current: initial }) },
    useMemo(factory, deps) {
      const index = cursor++
      if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: factory(), deps }
      return slots[index].value
    },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps) },
    useEffect(effect, deps) {
      const index = cursor++
      if (!slots[index] || !same(slots[index].deps, deps)) pending.push({ index, effect, deps })
    },
    useLayoutEffect(effect, deps) { hooks.useEffect(effect, deps) },
  }
  // Evaluate the real shared Owner fence with this harness's deterministic
  // React hooks. No test-only bypass of the Owner/session checks.
  const ownerFence = loadPlainModule(
    'ui/shared/src/mui/FileExplorerOwnerFence.ts',
    ['useXDriveFileExplorerOwnerFence'],
    hooks,
  )
  const readStrategy = loadPlainModule(
    'ui/shared/src/mui/FileExplorerDirectoryReadStrategy.ts',
    ['xDriveFileExplorerReadDirectoryPage'],
  )
  const cursorDirectory = loadPlainModule(
    'ui/shared/src/mui/FileExplorerCursorDirectoryController.ts',
    ['useXDriveFileExplorerCursorDirectory'],
    { ...hooks, ...ownerFence, ...readStrategy, AbortController },
  )
  // Test the *real* shared quota hook rather than omitting its dependency.
  // A verified, within-quota Server Owner response must not disturb Viewer
  // and download lifecycle tests or create artificial background jobs.
  const quota = loadPlainModule(
    'ui/shared/src/mui/FileExplorerOwnerQuota.ts',
    ['useXDriveFileExplorerOwnerQuota'],
    hooks,
  )
  // Load the actual Host-neutral preference hook after its UI extraction.
  // A per-mounted-page storage fake keeps appearance state separate without
  // granting any Owner or Agent capability to the fixture.
  const viewModeStorage = new Map()
  const viewPreference = loadPlainModule(
    'ui/shared/src/mui/FileExplorerViewPreference.ts',
    ['XDRIVE_HOST_FILES_PREFERENCES', 'useXDriveFileExplorerPersistedViewMode'],
    { ...hooks, window: { localStorage: {
      getItem: key => viewModeStorage.get(key) ?? null,
      setItem: (key, value) => viewModeStorage.set(key, value),
    } } },
  )
  const viewerSelection = loadPlainModule(
    'ui/shared/src/mui/FileExplorerReadOnlyViewerSelection.ts',
    ['xDriveFileExplorerReadOnlyViewerSelection'],
  )
  const readOnlyDownload = loadPlainModule(
    'ui/shared/src/mui/FileExplorerReadOnlyDownloadAdmission.ts',
    ['xDriveFileExplorerReadOnlyDownloadReason'],
    ownerIdentity,
  )
  const client = {
    async ownerFilesRoot() { return { id: 1, name: 'Owner' } },
    async ownerFilesPage() { return { items: rows, has_more: false } },
    async ownerQuota() { return { over_quota: false } },
  }
  let currentClient = client
  const bindings = { ...hooks, ...ownerFence, ...cursorDirectory, ...quota, ...viewPreference,
    ...viewerSelection, ...readOnlyDownload,
    ...ownerIdentity, ...classification, ...media, ...stream, ...scope,
    XDRIVE_SYNOLOGY_OWNER_DOWNLOAD_MAX_BYTES: 32 << 20,
    xDriveFileSupportsThumbnail: () => false,
    xDriveSynologyLoadOwnerThumbnail: () => { throw Error('Controller must not preload media') },
    xDriveSynologyLoadBoundedMediaPreview: () => { throw Error('Controller must not preload originals') },
    xDriveSynologyLoadNativeMediaStream: () => { throw Error('Controller must not preload a player') },
    xDriveSynologyFetchVerifiedDownload(_client, item, signal, onProgress) {
      return new Promise((resolve, reject) => {
        requests.push({ item, signal, onProgress, resolve: () => resolve({ filename: item.name,
          blob: new Blob(['verified fixture']) }), reject })
      })
    },
    AbortController,
    URL: { createObjectURL: () => 'blob:fixture-' + (++urlSequence),
      revokeObjectURL: value => revoked.push(value) },
    window: { setTimeout: fn => { timers.push(fn); return timers.length } },
    document: { visibilityState: 'visible', addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: name => listeners.delete(name) },
  }
  const Component = new Function(...Object.keys(bindings), controllerSource +
    '\nreturn XDriveSynologyOwnerFilesPage')(...Object.values(bindings))
  const render = () => {
    cursor = 0; dirty = false; pending = []
    snapshot = Component({ client: currentClient })
    const effects = pending
    for (const { index } of effects) slots[index]?.cleanup?.()
    for (const { index, effect, deps } of effects) slots[index] = { deps, cleanup: effect() }
  }
  const flush = async () => {
    for (let i = 0; i < 16; i++) { if (dirty) render(); await Promise.resolve() }
    assert.equal(dirty, false, 'controller must settle')
  }
  await flush()
  return { get state() { return snapshot }, flush, requests, revoked, timers,
    replaceClient() { currentClient = { ...client }; dirty = true; render() },
    unmount() { for (const slot of slots) slot?.cleanup?.() } }
}

test('rejecting an empty-file download must not revoke a previously verified save link', async () => {
  const app = await mount()
  app.state.downloadSelectedFiles([app.state.displayedItems[0]]); await app.flush()
  app.requests[0].resolve(); await app.flush()
  const ready = app.state.readyDownload.url
  app.state.downloadSelectedFiles([app.state.displayedItems.find(item => item.id === 7)])
  await app.flush()
  assert.equal(app.revoked.includes(ready), false, 'unsupported download discarded the valid saved result')
  assert.equal(app.state.readyDownload?.url, ready)
})

test('a callback captured before Owner refresh cannot start a new download after identical rows return', async () => {
  const app = await mount()
  const item = app.state.displayedItems[0]
  const old = app.state.downloadSelectedFiles
  app.state.refreshAuthenticatedOwner(); await app.flush()
  old([item]); await app.flush()
  assert.equal(app.requests.length, 0, 'old Owner callback started work in the replacement scope')
})

test('one shared Quick Look handles keyboard/menu and double-click, suspending list thumbnails', async () => {
  const app = await mount()
  assert.equal(typeof app.state.openFilePreview, 'function', 'DSM needs one preview entry controller')
  assert.match(page, /onOpenQuickLook=\{[^}]*openFilePreview/s)
  assert.match(page, /onOpenItem=\{[\s\S]*?openFilePreview\(item\)/)
  assert.match(page, /suspendBackgroundThumbnails=\{previewItem !== null\}/)
  app.state.openFilePreview(app.state.displayedItems[0]); await app.flush()
  assert.equal(app.state.previewItem.id, 2)
  assert.equal(app.requests.length, 0, 'opening must not download or preload originals in the controller')
})

test('download capability is identical for list, Viewer and actual dispatch', async () => {
  const app = await mount()
  assert.equal(typeof app.state.getDownloadDisabledReason, 'function')
  const reason = app.state.getDownloadDisabledReason
  const byID = id => app.state.displayedItems.find(item => item.id === id)
  assert.equal(reason([byID(2)]), null, '1 B remains supported')
  assert.equal(reason([byID(4)]), null, 'exact 32 MiB remains supported')
  for (const id of [3, 5, 6, 7]) {
    assert.ok(reason([byID(id)]))
    app.state.downloadSelectedFiles([byID(id)])
  }
  assert.ok(reason([byID(2), byID(4)]))
  assert.ok(reason([{ ...byID(2), revision: 8 }]))
  assert.equal(app.requests.length, 0, 'refused requests have no transport side effects')
  app.state.openFilePreview(byID(7)); await app.flush()
  assert.equal(app.state.previewActions[0].disabled, true)
})

test('legal Viewer download reveals progress and save; invalid attempts preserve the ready URL', async () => {
  const app = await mount()
  const item = app.state.displayedItems[0]
  app.state.openFilePreview(item); await app.flush()
  assert.equal(app.state.previewActions[0].disabled, false)
  app.state.previewActions[0].onSelect(); await app.flush()
  assert.equal(app.state.previewItem, null, 'download must expose the page behind the modal')
  assert.equal(app.requests.length, 1)
  assert.equal(app.state.download.name, item.name)
  assert.ok(app.state.getDownloadDisabledReason([item]), 'busy is immediate in every entry')
  app.requests[0].onProgress(1, 1); await app.flush()
  assert.equal(app.state.download.loaded, 1)
  app.requests[0].resolve(); await app.flush()
  const ready = app.state.readyDownload
  assert.ok(ready?.url)
  app.state.downloadSelectedFiles([app.state.displayedItems.find(entry => entry.id === 7)])
  await app.flush()
  assert.equal(app.state.readyDownload.url, ready.url)
  assert.equal(app.revoked.includes(ready.url), false)
  assert.equal(app.requests.length, 1)
  app.timers[0](); await app.flush()
  assert.equal(app.state.readyDownload, null)
  assert.ok(app.revoked.includes(ready.url))
})

test('loaded-file and selected-file navigation preserve order and stop at both bounds', async () => {
  const app = await mount()
  const image = app.state.displayedItems.find(item => item.id === 4)
  app.state.openFilePreview(image); await app.flush()
  assert.equal(app.state.previewPositionLabel, '2 / 4 已加载')
  app.state.movePreview(1); await app.flush()
  assert.equal(app.state.previewItem.id, 6, 'skip an unsupported oversized image')
  app.state.openFilePreview(image, [2, 4, 6]); await app.flush()
  assert.equal(app.state.previewPositionLabel, '2 / 3 已选择')
  app.state.movePreview(1); await app.flush()
  assert.equal(app.state.previewPositionLabel, '3 / 3 已选择')
  app.state.movePreview(1); await app.flush()
  assert.equal(app.state.previewItem.id, 6, 'do not wrap at the last selected item')
  app.state.movePreview(-1); app.state.movePreview(-1); await app.flush()
  assert.equal(app.state.previewItem.id, 2)
  app.state.movePreview(-1); await app.flush()
  assert.equal(app.state.previewItem.id, 2)
  assert.equal(app.requests.length, 0)
})

test('refresh and unmount revoke stale actions even when new Owner rows reuse identical IDs', async () => {
  const app = await mount()
  const item = app.state.displayedItems[0]
  const oldDownload = app.state.downloadSelectedFiles
  const oldOpen = app.state.openFilePreview
  app.state.refreshAuthenticatedOwner(); await app.flush()
  oldDownload([item]); oldOpen(item); await app.flush()
  assert.equal(app.requests.length, 0)
  assert.equal(app.state.previewItem, null)
  const liveDownload = app.state.downloadSelectedFiles
  app.unmount(); liveDownload([item])
  assert.equal(app.requests.length, 0)
})

test('folder and sort changes cancel obsolete reads and Viewer but preserve a user download', async () => {
  for (const transition of [state => state.setCrumbs([{ id: 9, name: 'Other' }]),
    state => state.setSort({ key: 'name', direction: 'desc' })]) {
    const app = await mount()
    const item = app.state.displayedItems[0]
    app.state.downloadSelectedFiles([item]); await app.flush()
    const request = app.requests[0]
    app.state.openFilePreview(item); await app.flush()
    assert.equal(app.state.previewItem?.id, item.id)
    transition(app.state); await app.flush()
    assert.equal(request.signal.aborted, false,
      'same verified Owner folder/sort navigation must not cancel an explicit download')
    assert.equal(app.state.previewItem, null,
      'old folder Viewer must not remain visible in the new directory scope')
    request.resolve(); await app.flush()
    assert.equal(app.state.readyDownload?.filename, item.name,
      'verified same-Owner download must remain available for the real Save click')
    assert.equal(app.state.download, null)
    assert.equal(app.revoked.includes(app.state.readyDownload.url), false)
    app.unmount()
  }
})

test('explicit Owner root revalidation still aborts a pending download after navigation', async () => {
  const app = await mount()
  const item = app.state.displayedItems[0]
  app.state.downloadSelectedFiles([item]); await app.flush()
  const request = app.requests[0]
  app.state.setSort({ key: 'name', direction: 'desc' }); await app.flush()
  assert.equal(request.signal.aborted, false)
  app.state.refreshAuthenticatedOwner(); await app.flush()
  assert.equal(request.signal.aborted, true,
    'root/session replacement must cancel Owner-scoped pending download')
  request.resolve(); await app.flush()
  assert.equal(app.state.readyDownload, null,
    'late obsolete verified bytes cannot become a cross-session Save link')
  app.unmount()
})

test('replacing the Agent client never presents prior Owner rows as verified in the first render', async () => {
  const app = await mount()
  const item = app.state.displayedItems[0]
  app.replaceClient()
  assert.equal(app.state.displayedItems.length, 0, 'old Owner rows escaped before root reauthentication')
  assert.ok(app.state.getDownloadDisabledReason([item]))
  await app.flush()
  assert.equal(app.state.getDownloadDisabledReason([app.state.displayedItems[0]]), null)
})

test('cancel then retry ignores old progress/completion; an old expiry cannot revoke a new URL', async () => {
  const app = await mount()
  const item = app.state.displayedItems[0]
  app.state.downloadSelectedFiles([item]); await app.flush()
  const old = app.requests[0]
  app.state.cancelDownload()
  app.state.downloadSelectedFiles([item]); await app.flush()
  assert.equal(old.signal.aborted, true)
  old.onProgress(999, 999); old.resolve(); await app.flush()
  assert.equal(app.state.download.loaded, 0)
  assert.equal(app.state.readyDownload, null)
  app.requests[1].resolve(); await app.flush()
  const previous = app.state.readyDownload.url
  app.state.downloadSelectedFiles([item]); await app.flush()
  app.requests[2].resolve(); await app.flush()
  const current = app.state.readyDownload.url
  assert.notEqual(previous, current)
  app.timers[0](); await app.flush()
  assert.equal(app.state.readyDownload.url, current)
  assert.equal(app.revoked.includes(current), false)
})
