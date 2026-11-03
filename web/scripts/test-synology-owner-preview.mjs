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
    thumbnailOnlyPreview: typeof thumbnailOnlyPreview === 'boolean' ? thumbnailOnlyPreview : false,
    ownerDerivedPreview: typeof ownerDerivedPreview === 'boolean' ? ownerDerivedPreview : false,
    loadOwnerLivePhotoMotion: typeof loadOwnerLivePhotoMotion === 'function' ? loadOwnerLivePhotoMotion : null,
    quickLookPreviewURLLoader: typeof quickLookPreviewURLLoader === 'function'
      ? quickLookPreviewURLLoader : null,
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
const classification = loadPlainModule('ui/shared/src/file-preview.ts',
  ['xDriveFileSupportsTextPreview', 'xDriveClassifyFilePreview',
    'xDriveFileNeedsBrowserCompatibleImagePreview'])
// Use the actual 4K derivative classifier without discarding the existing
// thumbnail-only eligibility introduced in the current DSM Viewer.
const derived = loadPlainModule('ui/shared/src/synology-viewer-preview.ts',
  ['xDriveSynologyViewerNeedsDerived'], classification)
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

async function mount(extraRows = []) {
  const slots = [], requests = [], viewerLoads = [], motionLoads = [], revoked = [], timers = [], listeners = new Map()
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
    async ownerFilesPage() { return { items: [...rows, ...extraRows], has_more: false } },
    async ownerQuota() { return { over_quota: false } },
  }
  let currentClient = client
  const bindings = { ...hooks, ...ownerFence, ...cursorDirectory, ...quota, ...viewPreference,
    ...viewerSelection, ...readOnlyDownload,
    ...ownerIdentity, ...classification, ...derived, ...media, ...stream, ...scope,
    XDRIVE_SYNOLOGY_OWNER_DOWNLOAD_MAX_BYTES: 32 << 20,
    // Test the real Controller's fallback admission, modeling only the
    // existing presentation helper's eligible image/video extensions.
    xDriveFileSupportsThumbnail: name =>
      /\.(?:jpg|jpeg|png|gif|webp|heic|heif|dng|tif|tiff|arw|nef|cr3|avif|bmp|livp|mov|mp4)$/i.test(name),
    xDriveSynologyLoadOwnerThumbnail: () => { throw Error('Controller must not preload media') },
    xDriveSynologyLoadBoundedMediaPreview: () => { throw Error('Controller must not preload originals') },
    xDriveSynologyLoadNativeMediaStream: () => { throw Error('Controller must not preload a player') },
    xDriveSynologyLoadOwnerLiveMotion(actualClient, id, revision, isCurrent, signal, onProgress) {
      assert.strictEqual(actualClient, currentClient)
      const attempt = { id, revision, isCurrent, signal, finish: null }
      motionLoads.push(attempt)
      return new Promise(resolve => {
        attempt.finish = (url = 'blob:verified-motion') => {
          if (signal?.aborted || !isCurrent()) { resolve(null); return }
          onProgress?.(8, 8, null)
          resolve(url)
        }
      })
    },
    xDriveSynologyLoadViewerPreview(_client, item, signal) {
      viewerLoads.push({ item, signal })
      return Promise.resolve('blob:verified-4k')
    },
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
  return { get state() { return snapshot }, flush, requests, viewerLoads, motionLoads, revoked, timers,
    replaceClient() { currentClient = { ...client }; dirty = true; render() },
    unmount() { for (const slot of slots) slot?.cleanup?.() } }
}

test('shared QuickLook preserves thumb fallback and connects current Owner 4K image source', () => {
  const quickLook = read('ui/shared/src/mui/FileQuickLookDialog.tsx')
  assert.match(quickLook, /subtitle=\{subtitle\}/)
  assert.match(page, /subtitle=\{thumbnailOnlyPreview/)
  assert.match(page, /loadPreviewURL=\{quickLookPreviewURLLoader\}/)
  assert.match(page, /loadImagePreview=\{loadOwnerThumbnail\}/)
  assert.match(page, /quickLookPreviewURLLoader\s*=\s*thumbnailOnlyPreview && !ownerDerivedPreview/)
  assert.match(page, /不直接读取原件；优先加载已认证的 4K 派生图/)
})

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
  assert.equal(app.state.previewPositionLabel, '2 / 5 已加载')
  app.state.movePreview(1); await app.flush()
  assert.equal(app.state.previewItem.id, 5, 'large image retains an authenticated thumbnail-only Viewer')
  assert.equal(app.state.thumbnailOnlyPreview, true)
  app.state.movePreview(1); await app.flush()
  assert.equal(app.state.previewItem.id, 6)
  assert.equal(app.state.thumbnailOnlyPreview, false)
  app.state.movePreview(-1); await app.flush()
  assert.equal(app.state.previewItem.id, 5)
  app.state.movePreview(-1); await app.flush()
  assert.equal(app.state.previewItem.id, 4)
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

test('DSM large PDF opens the same shared Viewer without broadening download limits', async () => {
  const app = await mount([node(9, 'manual.pdf', (32 << 20) + 1)])
  const item = app.state.displayedItems.find(row => row.id === 9)
  assert.ok(item)
  app.state.openFilePreview(item); await app.flush()
  assert.equal(app.state.previewItem?.id, 9)
  assert.equal(app.state.previewActions[0].disabled, true)
  app.state.movePreview(-1); await app.flush()
  assert.notEqual(app.state.previewItem?.id, 9)
  app.unmount()
})

test('DSM Files LIVP opens the common on-hold motion reader with a current Owner/revision fence', async () => {
  const quickLook = read('ui/shared/src/mui/FileQuickLookDialog.tsx')
  assert.match(page, /loadLivePhotoMotion=\{previewItem\?\.kind === 'file'/)
  assert.match(quickLook, /loadLivePhotoMotion=\{loadLivePhotoMotion\}/)
  const app = await mount([node(13, 'live.livp', 1024), node(14, 'video.mp4', 2048)])
  const livp = app.state.displayedItems.find(item => item.id === 13)
  assert.ok(livp)
  assert.equal(await app.state.loadOwnerLivePhotoMotion(livp), null,
    'an unopened LIVP cannot start motion')
  assert.equal(app.motionLoads.length, 0)
  app.state.openFilePreview(livp); await app.flush()
  assert.strictEqual(app.state.previewItem, livp)
  assert.equal(app.motionLoads.length, 0, 'opening Viewer must not preload motion')
  const controller = new AbortController()
  const progress = []
  const first = app.state.loadOwnerLivePhotoMotion(livp, (...args) => progress.push(args), controller.signal)
  assert.equal(app.motionLoads.length, 1)
  assert.deepEqual([app.motionLoads[0].id, app.motionLoads[0].revision], [13,7])
  assert.strictEqual(app.motionLoads[0].signal, controller.signal)
  assert.equal(app.motionLoads[0].isCurrent(), true)
  app.motionLoads[0].finish()
  assert.equal(await first, 'blob:verified-motion')
  assert.deepEqual(progress, [[8,8,null]])
  assert.equal(await app.state.loadOwnerLivePhotoMotion({ ...livp, name: 'forged.livp' }), null)
  assert.equal(await app.state.loadOwnerLivePhotoMotion({ ...livp, name: 'video.mp4' }), null)
  assert.equal(app.motionLoads.length, 1, 'a forged row must not request motion')

  const obsolete = app.state.loadOwnerLivePhotoMotion(livp)
  assert.equal(app.motionLoads.length, 2)
  app.state.movePreview(-1); await app.flush()
  assert.notEqual(app.state.previewItem?.id, livp.id)
  assert.equal(app.motionLoads[1].isCurrent(), false, 'switching files retires old hold')
  app.motionLoads[1].finish()
  assert.equal(await obsolete, null, 'stale motion cannot publish a Blob')
  assert.equal(await app.state.loadOwnerLivePhotoMotion(livp), null,
    'old callback cannot restart a nonselected LIVP')

  app.state.openFilePreview(livp); await app.flush()
  const cancelled = new AbortController()
  const pending = app.state.loadOwnerLivePhotoMotion(livp, undefined, cancelled.signal)
  assert.equal(app.motionLoads.length, 3)
  cancelled.abort()
  app.motionLoads[2].finish()
  assert.equal(await pending, null)
  app.state.refreshAuthenticatedOwner(); await app.flush()
  assert.equal(await app.state.loadOwnerLivePhotoMotion(livp), null,
    'a root refresh must revoke old Viewer motion selection')
  assert.equal(app.motionLoads.length, 3)
  app.unmount()
})

test('DSM Files QuickLook reaches Owner 4K WebP/JPEG without losing thumbnail-only fallback', async () => {
  const app = await mount([
    node(9, 'cloud.heic', 24 << 20), node(10, 'raw.dng', 64 << 20),
    node(11, 'large.png', 128 << 20), node(12, 'legacy.bmp', 4 << 20),
    node(13, 'live.livp', 16 << 20), node(14, 'danger.exe', 1 << 20),
  ])
  for (const [id, kind] of [[9, 'image'], [10, 'image'], [11, 'image'], [13, 'live_photo']]) {
    const item = app.state.displayedItems.find(entry => entry.id === id)
    app.state.openFilePreview(item); await app.flush()
    assert.equal(app.state.previewItem?.id, id)
    assert.equal(app.state.ownerDerivedPreview, true,
      'verified 4K derivative must be enabled for eligible Owner stills')
    assert.equal(typeof app.state.quickLookPreviewURLLoader, 'function',
      'a thumbnail-only flag must not hide the authenticated derivative loader')
    assert.equal(app.viewerLoads.length,
      [[9, 'image'], [10, 'image'], [11, 'image'], [13, 'live_photo']]
        .findIndex(([candidate]) => candidate === id),
      'opening a Viewer must not eagerly read the high-res resource')
    assert.equal(await app.state.quickLookPreviewURLLoader(item, kind), 'blob:verified-4k')
    assert.equal(app.viewerLoads.at(-1)?.item?.id, id)
    assert.equal(app.viewerLoads.at(-1)?.item?.revision, item.revision)
  }
  assert.deepEqual(app.viewerLoads.map(({ item }) => [item.id, item.name]),
    [[9, 'cloud.heic'], [10, 'raw.dng'], [11, 'large.png'], [13, 'live.livp']])
  // Legacy unsupported original with no derivative stays thumbnail-only; do
  // not accidentally route BMP or another binary through the original reader.
  const bmp = app.state.displayedItems.find(entry => entry.id === 12)
  app.state.openFilePreview(bmp); await app.flush()
  assert.equal(app.state.thumbnailOnlyPreview, true)
  assert.equal(app.state.ownerDerivedPreview, false)
  assert.equal(app.state.quickLookPreviewURLLoader, null)
  assert.equal(app.viewerLoads.length, 4)
  // Small JPEG retains its bounded complete-SHA original path.
  const jpeg = app.state.displayedItems.find(entry => entry.id === 4)
  app.state.openFilePreview(jpeg); await app.flush()
  assert.equal(app.state.thumbnailOnlyPreview, false)
  assert.equal(app.state.ownerDerivedPreview, false)
  assert.equal(typeof app.state.quickLookPreviewURLLoader, 'function')
  assert.equal(app.viewerLoads.length, 4)
  // Unsupported binary cannot replace the current, authenticated selection.
  app.state.openFilePreview(app.state.displayedItems.find(entry => entry.id === 14))
  await app.flush()
  assert.equal(app.state.previewItem?.id, jpeg.id)
  assert.equal(app.viewerLoads.length, 4)
  app.unmount()
})

test('DSM image fallbacks and LIVP candidate selection preserve verified Owner media boundaries', async () => {
  const app = await mount([
    node(9, 'cloud.heic', 24 << 20), node(10, 'raw.dng', 64 << 20),
    node(11, 'old.mov', 40 << 20), node(12, 'archive.livp', 16 << 20),
    node(13, 'massive.png', 128 << 20), node(14, 'evil.exe', 16 << 20),
  ])
  for (const id of [5, 9, 10, 13]) {
    app.state.openFilePreview(app.state.displayedItems.find(item => item.id === id))
    await app.flush()
    assert.equal(app.state.previewItem?.id, id, 'thumbnail-compatible image must remain previewable')
    assert.equal(app.state.thumbnailOnlyPreview, true)
    // A 24 MiB HEIC may still be downloaded intact: preview compatibility
    // does not tighten or broaden the independent 32 MiB download policy.
    assert.equal(app.state.previewActions[0].disabled, id !== 9,
      'derivative-only Viewer must preserve existing original download admission')
    assert.equal(Boolean(app.state.getDownloadDisabledReason([app.state.previewItem])), id !== 9)
  }
  // A .livp filename may open a read-only Viewer candidate so that the
  // actual Owner/revision-scoped 4K still reader can verify the indexed LIVP
  // resource. Selection itself must not invent image/motion bytes or download.
  app.state.openFilePreview(app.state.displayedItems.find(item => item.id === 12))
  await app.flush()
  assert.equal(app.state.previewItem?.id, 12, 'LIVP candidate uses the shared Viewer')
  assert.equal(app.requests.length, 0, 'LIVP selection must not synthesize a media read')
  app.state.openFilePreview(app.state.displayedItems.find(item => item.id === 13))
  await app.flush()
  // Unrelated MOV and executable files still cannot replace that Viewer.
  for (const id of [11, 14]) {
    app.state.openFilePreview(app.state.displayedItems.find(item => item.id === id))
    await app.flush()
    assert.equal(app.state.previewItem?.id, 13,
      'an unsupported callback must not displace the already verified Viewer')
  }
  app.state.openFilePreview(app.state.displayedItems.find(item => item.id === 4))
  await app.flush()
  assert.equal(app.state.thumbnailOnlyPreview, false, 'supported image still uses verified original')
  app.unmount()
})

test('DSM large PDF opens the same shared Viewer without broadening download limits', async () => {
  const app = await mount([node(9, 'manual.pdf', (32 << 20) + 1)])
  const item = app.state.displayedItems.find(row => row.id === 9)
  assert.ok(item)
  app.state.openFilePreview(item); await app.flush()
  assert.equal(app.state.previewItem?.id, 9)
  assert.equal(app.state.previewActions[0].disabled, true)
  app.state.movePreview(-1); await app.flush()
  assert.notEqual(app.state.previewItem?.id, 9)
  app.unmount()
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
