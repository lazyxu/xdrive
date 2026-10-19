const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const explorer = read('ui/shared/src/mui/FileExplorer.tsx')
const mobile = read('web/src/MobileFiles.tsx')
const web = read('web/src/WebFileExplorer.tsx')
const desktop = read('desktop/src/renderer/DesktopFileExplorer.tsx')
const gallery = read('ui/shared/src/mui/MediaGallery.tsx')

test('Web/Desktop shared cold first Range reserves one silent slot through a slow GET', () => {
  const begin = explorer.indexOf(') : loading && logicalItemCount === 0 && !keepAcceptedEmpty ? (')
  const end = explorer.indexOf(') : logicalItemCount === 0 ? (', begin)
  assert.ok(begin >= 0 && end > begin, 'retain original authoritative cold read gate')
  const cold = explorer.slice(begin, end)
  for (const token of [
    'data-xdrive-file-explorer-cold-first-range',
    'aria-busy="true"',
    "minHeight: 180, display: 'grid', placeItems: 'center'",
  ]) assert.ok(cold.includes(token), token)
  assert.equal(cold.includes('showDelayedLoading'), false)
  assert.equal(cold.includes('XDriveStatePanel'), false,
    'cold directory transition must not paint an intermediate spinner or caption')
  assert.ok(explorer.includes("import { useXDriveDeferredLoading } from './useDeferredLoading'"),
    'shared original generation-fenced delay owns the populated refresh bar')
  assert.ok(explorer.includes('refreshFeedbackCycleRef.current.pending !== refreshFeedbackPending') &&
    explorer.includes('refreshFeedbackCycleRef.current.scope !== interactionScopeKey') &&
    explorer.includes('generation: refreshFeedbackCycleRef.current.generation + 1'),
    'pending and scope must advance their visual generation DURING render, not after paint')
  assert.equal(explorer.includes('setDelayedLoadingScope'), false,
    'old scope-string visual state could be reused by a second same-folder refresh')
  assert.ok(explorer.includes('refreshFeedbackPending = loading && logicalItemCount > 0'),
    'cold zero-item read must not schedule an unused visual timer')
  assert.ok(explorer.includes('showDelayedLoading = useXDriveDeferredLoading(') &&
    explorer.includes('refreshFeedbackPending, refreshFeedbackCycleRef.current.generation'),
    'only current populated refresh may show its subtle bar after the scoped delay')
  assert.ok(explorer.includes('keepAcceptedEmpty'), 'accepted empty remains visible')
  assert.ok(explorer.includes('data-xdrive-file-explorer-unverified-first-read'))
  assert.ok(explorer.includes('data-xdrive-file-explorer-empty-read-error'))
})

test('same shared Explorer and Mobile cold slot retain original Range, virtual scroll and media progress', () => {
  for (const [name, src] of [['Web', web], ['Desktop', desktop]]) {
    assert.ok(src.includes('<XDriveFileExplorer'), name + ' must use the shared virtual Explorer')
    assert.ok(src.includes('virtualCollection='), name + ' must retain sparse Range')
  }
  assert.ok(mobile.includes('data-mobile-files-cold-read-slot={coldUnconfirmedBrowse || undefined}'))
  assert.ok(mobile.includes("minHeight: 180, display: 'grid', placeItems: 'center'"))
  assert.ok(explorer.includes('XDriveFileExplorerThumbnail'))
  assert.ok(gallery.includes('XDriveMediaAsyncThumbnail'))
  assert.ok(gallery.includes('XDriveMediaAsyncVideoPoster'))
})

test('P91 populated FileExplorer refresh display may not reuse prior scope or pending cycle', () => {
  const from = explorer.indexOf('  const refreshFeedbackPending =')
  const to = explorer.indexOf('  const groupIndex =', from)
  assert.ok(from > 0 && to > from)
  const feedback = explorer.slice(from, to)
  assert.ok(feedback.includes('loading && logicalItemCount > 0'))
  assert.ok(feedback.includes('refreshFeedbackCycleRef.current.pending !== refreshFeedbackPending'))
  assert.ok(feedback.includes('refreshFeedbackCycleRef.current.scope !== interactionScopeKey'))
  assert.ok(feedback.includes('useXDriveDeferredLoading('))
  assert.equal(feedback.includes('setDelayedLoadingScope'), false)
  assert.equal(feedback.includes('globalThis.setTimeout'), false,
    'the original mounted shared deferred hook owns its timer and cleanup')
  assert.ok(explorer.includes('{showDelayedLoading && logicalItemCount > 0 ? ('))
  assert.ok(explorer.includes('XDriveFileExplorerThumbnail'),
    'independent network thumbnails stay intact')
})
